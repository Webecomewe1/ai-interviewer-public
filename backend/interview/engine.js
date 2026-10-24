const { randomUUID } = require('crypto');
const gemini = require('../gemini/client');
const prompts = require('./prompts');
const store = require('./store');
const { findCachedQuestion, saveGeneratedQuestion } = require('../cache/questionBank');

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
  if (position === 'Custom Position' && !String(input.customPosition || '').trim()) {
    throw new RequestError('Enter the role you want to practice for.');
  }

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
    return Number.isFinite(v) ? Math.min(10, Math.max(0, Math.round(v))) : 7;
  };
  let suggestions = Array.isArray(e.suggestions)
    ? e.suggestions
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];
  if (suggestions.length === 0) {
    suggestions = [
      'Incorporate more specific technical details and practical examples from past projects.',
      'Structure behavioral responses using the STAR method (Situation, Task, Action, Result) for clarity.',
      'Elaborate further on troubleshooting methodology and technical trade-offs.'
    ];
  }
  return {
    technical: clamp(e.technical),
    problemSolving: clamp(e.problemSolving),
    communication: clamp(e.communication),
    clarity: clamp(e.clarity),
    confidence: clamp(e.confidence),
    adaptability: clamp(e.adaptability),
    note: String(e.note || '').trim() || 'The candidate participated actively and communicated their experience clearly throughout the interview.',
    suggestions,
  };
}

class InterviewSession {
  constructor(config, opts = {}) {
    this.id = opts.id || randomUUID();
    this._id = opts.mongoId || null;
    this.userId = opts.userId || null;
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
    // Shared role questions cannot account for private candidate or job context.
    // Keep personalized prompts out of both cache reads and shared cache writes.
    const hasContext = Boolean(config.resume || config.jobDescription || config.companyInfo);
    this._cacheEnabled = !hasContext && (opts.cacheEnabled !== undefined ? opts.cacheEnabled : true);
  }

  _persist() {
    return store.upsertSession(this);
  }

  async _nextQuestion(difficulty, followUpAllowed) {
    if (!this._cacheEnabled) return null;
    const cached = await findCachedQuestion({
      position: this.config.position,
      customPosition: this.config.customPosition,
      interviewType: this.config.interviewType,
      difficulty,
      usedTexts: this.questions.map((q) => q.text),
    });
    if (cached) return cached;
    return null;
  }

  async start() {
    const cached = await this._nextQuestion(this.config.difficulty, false);
    let opening = '';
    let question = cached ? cached.text : '';

    if (!cached) {
      const result = await gemini.generateJson({
        prompt: prompts.initialPrompt(this.config),
        systemInstruction: prompts.interviewerSystemPrompt(this.config),
        schema: prompts.schemas.initial,
      });
      opening = String(result.opening || '').trim();
      question = String(result.question || '').trim();
      if (this._cacheEnabled) await saveGeneratedQuestion({
        position: this.config.position,
        customPosition: this.config.customPosition,
        interviewType: this.config.interviewType,
        difficulty: this.config.difficulty,
        text: question,
        isFollowUp: false,
        userId: this.userId,
      });
    }
    if (!question) throw new Error('AI returned an empty opening question.');

    this.startedAt = Date.now();
    this.questions.push({
      number: 1,
      text: question,
      isFollowUp: false,
      difficulty: this.config.difficulty,
      source: cached ? 'cache' : 'generated',
    });
    this.transcript.push({
      role: 'interviewer',
      text: opening ? `${opening} ${question}` : question,
    });
    await this._persist();

    return { opening, question };
  }

  async answer(text) {
    const answer = String(text || '').trim();
    if (!answer) throw new RequestError('Please provide an answer before continuing.');
    if (answer.length > MAX_ANSWER_LENGTH) {
      throw new RequestError('That answer is too long. Please shorten it.');
    }

    const wordCount = answer.split(/\s+/).filter(Boolean).length;
    const answerStartMs = Date.now();
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
        wordCount,
        elapsedMs: Date.now() - answerStartMs,
        difficulty: this.lastDifficulty,
        eval: normalizeEval(result.internalEval),
      });
      const closing = String(result.closing || '').trim();
      if (closing) {
        this.transcript.push({ role: 'interviewer', text: closing });
      }
      this.completedAt = Date.now();
      this.status = 'completed';
      await this.evaluate();
      await this._persist();
      return { kind: 'complete', closing, questionNumber: currentNumber };
    }

    const nextDifficulty = this.lastDifficulty;
    const cached = await this._nextQuestion(nextDifficulty, true);

    let questionData;
    let questionSource = 'cache';
    let generatedResult = null;
    if (cached) {
      questionData = { text: cached.text, isFollowUp: cached.isFollowUp, difficulty: nextDifficulty };
    } else {
      generatedResult = await gemini.generateJson({
        prompt: prompts.nextQuestionPrompt(this),
        systemInstruction: prompts.interviewerSystemPrompt(this.config),
        schema: prompts.schemas.step,
      });
      questionData = generatedResult.question || {};
      questionSource = 'generated';
      if (this._cacheEnabled) await saveGeneratedQuestion({
        position: this.config.position,
        customPosition: this.config.customPosition,
        interviewType: this.config.interviewType,
        difficulty: nextDifficulty,
        text: String(questionData.text || '').trim(),
        isFollowUp: Boolean(questionData.isFollowUp),
        userId: this.userId,
      });
    }

    this.answers.push({
      questionNumber: currentNumber,
      answer,
      wordCount,
      elapsedMs: Date.now() - answerStartMs,
      difficulty: this.lastDifficulty,
      eval: cached ? null : normalizeEval(generatedResult.internalEval),
    });
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
      source: questionSource,
    });
    this.transcript.push({ role: 'interviewer', text: questionText });
    this.lastDifficulty = difficulty;
    await this._persist();

    return {
      kind: 'question',
      question: { number: nextNumber, text: questionText },
    };
  }

  async hint() {
    if (this.status === 'completed') {
      throw new RequestError('This interview is already finished.', 409);
    }
    const result = await gemini.generateJson({
      prompt: prompts.hintPrompt(this),
      systemInstruction: prompts.interviewerSystemPrompt(this.config),
      schema: prompts.schemas.hint,
    });
    const hint = String(result.hint || '').trim();
    if (!hint) throw new Error('AI returned an empty hint.');
    return { hint };
  }

  async rating() {
    return this.evaluate();
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
          const ansWithEval = this.answers.filter((a) => a && a.eval);
          const fullEval = await gemini.generateJson({
            prompt: prompts.evaluationPrompt(this),
            systemInstruction: prompts.interviewerSystemPrompt(this.config),
            schema: prompts.schemas.eval,
          });

          if (ansWithEval.length) {
            const sums = {};
            for (const d of dims) sums[d] = 0;
            for (const a of ansWithEval) {
              for (const d of dims) sums[d] += Number(a.eval[d]) || 0;
            }
            result = fullEval;
            for (const d of dims) {
              const turnAvg = Math.round(sums[d] / ansWithEval.length);
              result[d] = Math.round((turnAvg + (Number(result[d]) || turnAvg)) / 2);
            }
          } else {
            result = fullEval;
          }
          const ev = normalizeEval(result);
          const average = dims.reduce((acc, d) => acc + ev[d], 0) / dims.length;
          this.evaluation = { ...ev, overall: Math.round(average * 2) / 2 };
          await this._persist();
        } catch (err) {
          // Preserve quota/service errors; never invent a score on failure.
          throw err;
        }
        return this.evaluation;
      })().catch((error) => {
        this.evaluationPromise = null;
        throw error;
      });
    }
    return this.evaluationPromise;
  }

  summary() {
    const stats = this._buildStats();
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
      questions: this.questions.map((q) => ({
        number: q.number,
        text: q.text,
        difficulty: q.difficulty,
        isFollowUp: q.isFollowUp,
        source: q.source || 'generated',
      })),
      transcript: this.transcript,
      lastQuestion: this.questions[this.questions.length - 1] || null,
      evaluation: this.evaluation,
      stats,
      questionTiming: this._buildQuestionTiming(),
    };
  }

  _buildStats() {
    let answers = this.answers.filter((a) => a && a.wordCount != null);
    if (!answers.length) {
      answers = this.transcript
        .filter((t) => t.role === 'candidate')
        .map((t) => ({
          wordCount: (t.text || '').trim().split(/\s+/).filter(Boolean).length,
        }));
    }
    if (!answers.length) return null;
    const words = answers.map((a) => a.wordCount || 0);
    const times = answers
      .filter((a) => a.elapsedMs != null)
      .map((a) => a.elapsedMs || 0);
    const sum = (arr) => arr.reduce((acc, n) => acc + n, 0);
    const totalWords = sum(words);
    return {
      totalWords,
      answeredQuestions: answers.length,
      avgWordsPerAnswer: Math.round((totalWords / answers.length) * 10) / 10,
      avgMsPerAnswer: times.length ? Math.round(sum(times) / times.length) : 0,
      totalMs: times.length ? sum(times) : 0,
      longestAnswerWords: words.length ? Math.max(...words) : 0,
      shortestAnswerWords: words.length ? Math.min(...words) : 0,
    };
  }

  _buildQuestionTiming() {
    const fromAnswers = this.answers
      .map((a) => ({
        number: a.questionNumber,
        difficulty: a.difficulty || this.config.difficulty,
        wordCount: a.wordCount || 0,
        elapsedMs: a.elapsedMs || 0,
      }))
      .filter((a) => a.number != null);
    if (fromAnswers.length) return fromAnswers;
    return this.questions.map((q) => ({
      number: q.number,
      difficulty: q.difficulty || this.config.difficulty,
      wordCount: 0,
      elapsedMs: 0,
    }));
  }
}

const sessions = new Map();

async function createSession(config, opts = {}) {
  const session = new InterviewSession(config, opts);
  const mongo = await store.createSessionDoc({
    _id: session.id,
    user: opts.userId || null,
    mode: config.mode,
    config,
    status: 'in_progress',
    startedAt: null,
    completedAt: null,
    questions: [],
    answers: [],
    transcript: [],
    evaluation: null,
    stats: null,
    questionTiming: [],
  });
  if (mongo) {
    session._id = session.id;
  }
  sessions.set(session.id, session);
  return session;
}

async function getSession(id) {
  const cached = sessions.get(id);
  if (cached) {
    return cached;
  }
  const doc = await store.loadSessionDoc(id);
  if (!doc) return null;
  const config = {
    mode: doc.mode,
    position: doc.config.position,
    customPosition: doc.config.customPosition || '',
    interviewType: doc.config.interviewType,
    difficulty: doc.config.difficulty,
    questionCount: doc.config.questionCount,
    resume: doc.config.resume || '',
    jobDescription: doc.config.jobDescription || '',
    companyInfo: doc.config.companyInfo || '',
  };
  const session = new InterviewSession(config, {
    id: doc._id.toString(),
    mongoId: String(doc._id),
    userId: doc.user ? String(doc.user) : null,
  });
  session.status = doc.status;
  session.startedAt = doc.startedAt ? new Date(doc.startedAt).getTime() : null;
  session.completedAt = doc.completedAt ? new Date(doc.completedAt).getTime() : null;
  session.questions = doc.questions.map((q) => ({
    number: q.number,
    text: q.text,
    isFollowUp: q.isFollowUp,
    difficulty: q.difficulty,
    source: q.source || 'generated',
  }));
  session.answers = doc.answers || [];
  session.transcript = doc.transcript || [];
  session.evaluation = doc.evaluation || null;
  for (const q of session.questions) {
    if (q.difficulty) session.lastDifficulty = q.difficulty;
  }
  sessions.set(session.id, session);
  return session;
}

module.exports = {
  RequestError,
  validateConfig,
  createSession,
  getSession,
};
