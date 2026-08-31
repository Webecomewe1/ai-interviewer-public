const { randomUUID } = require('crypto');
const gemini = require('../gemini/client');
const prompts = require('./prompts');

const MAX_ANSWER_LENGTH = 10000;
const MAX_RICH_CONTEXT_LENGTH = 20000;
const MAX_CUSTOM_LENGTH = 500;
const VALID_TYPES = ['behavioral', 'technical', 'mixed'];
const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'advanced'];

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function truncate(value, max) {
  const s = String(value || '').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function validateConfig(body) {
  const input = body || {};
  const position = String(input.position || '').trim();
  if (!position) throw new RequestError('A position is required.');

  const interviewType = String(input.interviewType || '').trim();
  if (!VALID_TYPES.includes(interviewType)) {
    throw new RequestError('A valid interview type is required.');
  }

  const difficulty = String(input.difficulty || '').trim();
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new RequestError('A valid difficulty level is required.');
  }

  let questionCount = Number(input.questionCount);
  if (!Number.isFinite(questionCount)) questionCount = 10;
  questionCount = Math.min(30, Math.max(1, Math.round(questionCount)));

  return {
    mode: String(input.mode || 'text'),
    position,
    customPosition: truncate(input.customPosition, MAX_CUSTOM_LENGTH),
    interviewType,
    difficulty,
    questionCount,
    resume: truncate(input.resume, MAX_RICH_CONTEXT_LENGTH),
    jobDescription: truncate(input.jobDescription, MAX_RICH_CONTEXT_LENGTH),
    companyInfo: truncate(input.companyInfo, MAX_RICH_CONTEXT_LENGTH),
  };
}

function normalizeEval(value) {
  const e = value || {};
  const clamp = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(10, Math.max(0, Math.round(v))) : 0;
  };
  const suggestions = Array.isArray(e.suggestions)
    ? e.suggestions
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    technical: clamp(e.technical),
    problemSolving: clamp(e.problemSolving),
    communication: clamp(e.communication),
    clarity: clamp(e.clarity),
    confidence: clamp(e.confidence),
    adaptability: clamp(e.adaptability),
    note: String(e.note || '').trim(),
    suggestions,
  };
}

class InterviewSession {
  constructor(config) {
    this.id = randomUUID();
    this.config = config;
    this.status = 'in_progress';
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.questions = [];
    this.answers = [];
    this.transcript = [];
    this.lastDifficulty = config.difficulty;
    this.evaluation = null;
    this.evaluationPromise = null;
  }

  async start() {
    const result = await gemini.generateJson({
      prompt: prompts.initialPrompt(this.config),
      systemInstruction: prompts.interviewerSystemPrompt(this.config),
      schema: prompts.schemas.initial,
    });

    const opening = String(result.opening || '').trim();
    const question = String(result.question || '').trim();
    if (!question) throw new Error('AI returned an empty opening question.');

    this.startedAt = Date.now();
    this.questions.push({
      number: 1,
      text: question,
      isFollowUp: false,
      difficulty: this.config.difficulty,
    });
    this.transcript.push({
      role: 'interviewer',
      text: opening ? `${opening} ${question}` : question,
    });

    return { opening, question };
  }

  async answer(text) {
    const answer = String(text || '').trim();
    if (!answer) throw new RequestError('Please provide an answer before continuing.');
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new RequestError('That answer is too long. Please shorten it.');
    }

    this.transcript.push({ role: 'candidate', text: answer });
    const currentNumber = this.questions.length;
    const isLast = currentNumber >= this.config.questionCount;

    if (isLast) {
      const result = await gemini.generateJson({
        prompt: prompts.closingPrompt(this),
        systemInstruction: prompts.interviewerSystemPrompt(this.config),
        schema: prompts.schemas.closing,
      });
      this.answers.push({
        questionNumber: currentNumber,
        answer,
        eval: normalizeEval(result.internalEval),
      });
      const closing = String(result.closing || '').trim();
      if (closing) {
        this.transcript.push({ role: 'interviewer', text: closing });
      }
      this.completedAt = Date.now();
      this.status = 'completed';
      await this.evaluate();
      return { kind: 'complete', closing, questionNumber: currentNumber };
    }

    const result = await gemini.generateJson({
      prompt: prompts.nextQuestionPrompt(this),
      systemInstruction: prompts.interviewerSystemPrompt(this.config),
      schema: prompts.schemas.step,
    });
    this.answers.push({
      questionNumber: currentNumber,
      answer,
      eval: normalizeEval(result.internalEval),
    });

    const questionData = result.question || {};
    const questionText = String(questionData.text || '').trim();
    if (!questionText) throw new Error('AI returned an empty question.');
    const difficulty = DIFFICULTY_ORDER.includes(questionData.difficulty)
      ? questionData.difficulty
      : this.lastDifficulty;
    const nextNumber = currentNumber + 1;

    this.questions.push({
      number: nextNumber,
      text: questionText,
      isFollowUp: Boolean(questionData.isFollowUp),
      difficulty,
    });
    this.transcript.push({ role: 'interviewer', text: questionText });
    this.lastDifficulty = difficulty;

    return {
      kind: 'question',
      question: { number: nextNumber, text: questionText },
    };
  }

  async evaluate() {
    if (this.evaluation) return this.evaluation;
    if (!this.evaluationPromise) {
      this.evaluationPromise = (async () => {
        try {
          const dims = [
            'technical',
            'problemSolving',
            'communication',
            'clarity',
            'confidence',
            'adaptability',
          ];
          let result;
          if (this.answers.length) {
            const sums = {};
            for (const d of dims) sums[d] = 0;
            for (const a of this.answers) {
              if (!a.eval) continue;
              for (const d of dims) sums[d] += Number(a.eval[d]) || 0;
            }
            result = {};
            for (const d of dims) {
              result[d] = Math.round(sums[d] / this.answers.length);
            }
            result.note = '';
            result.suggestions = [];
          } else {
            result = await gemini.generateJson({
              prompt: prompts.evaluationPrompt(this),
              systemInstruction: prompts.interviewerSystemPrompt(this.config),
              schema: prompts.schemas.eval,
            });
          }
          const ev = normalizeEval(result);
          const average = dims.reduce((acc, d) => acc + ev[d], 0) / dims.length;
          this.evaluation = { ...ev, overall: Math.round(average * 2) / 2 };
        } catch (err) {
          console.error('Evaluation failed:', err && err.message);
        }
        return this.evaluation;
      })();
    }
    return this.evaluationPromise;
  }

  summary() {
    return {
      interviewId: this.id,
      position: this.config.position,
      customPosition: this.config.customPosition || null,
      interviewType: this.config.interviewType,
      difficulty: this.config.difficulty,
      questionCount: this.config.questionCount,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      questions: this.questions.map((q) => ({ number: q.number, text: q.text })),
      transcript: this.transcript,
      lastQuestion: this.questions[this.questions.length - 1] || null,
      evaluation: this.evaluation,
    };
  }
}

const sessions = new Map();

function createSession(config) {
  const session = new InterviewSession(config);
  sessions.set(session.id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id);
}

module.exports = {
  RequestError,
  validateConfig,
  createSession,
  getSession,
};