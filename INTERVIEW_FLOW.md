# Interview Flow

This document describes the interview lifecycle, question selection, answer evaluation, and scoring algorithm for the AI Interviewer.

## Overview

An interview progresses through these stages:

1. **Configuration** - User selects mode, position, difficulty, type, and question count
2. **Initialization** - First opening question generated based on role and difficulty
3. **Question Loop** - AI asks questions, user answers, AI evaluates and adapts
4. **Completion** - Final answer evaluated, interview marked complete
5. **Rating** - Overall scores calculated across 6 dimensions
6. **Results** - User views evaluation, suggestions, and detailed breakdown

**Key files**:
- `backend/interview/engine.js` - Session lifecycle and state machine
- `backend/interview/prompts.js` - Question and evaluation prompts
- `backend/cache/questionBank.js` - Question caching for fast retrieval

## Configuration Validation

**User input** (from frontend setup form):

```javascript
{
  mode: 'voice' | 'text',
  position: string,              // e.g. "IT Generalist Intern"
  customPosition: string,        // If position is "Custom Position"
  interviewType: 'behavioral' | 'technical' | 'mixed',
  difficulty: 'beginner' | 'intermediate' | 'advanced',
  questionCount: number,         // 1-30
  resume: string,                // Optional, max 20000 chars
  jobDescription: string,        // Optional, max 20000 chars
  companyInfo: string            // Optional, max 20000 chars
}
```

**Validation** (in `backend/interview/engine.js`, verified from code):

```javascript
function validateConfig(body) {
  // Position: Required, non-empty
  const position = String(input.position || '').trim();
  if (!position) throw new RequestError('A position is required.');
  
  // Interview type: Enum check
  const VALID_TYPES = ['behavioral', 'technical', 'mixed'];
  if (!VALID_TYPES.includes(interviewType)) {
    throw new RequestError('A valid interview type is required.');
  }
  
  // Difficulty: Enum check
  const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new RequestError('A valid difficulty level is required.');
  }
  
  // Question count: 1-30 range
  let questionCount = Number(input.questionCount);
  if (!Number.isFinite(questionCount)) questionCount = 10;
  questionCount = Math.min(30, Math.max(1, Math.round(questionCount)));
  
  // Context fields: Truncated to max lengths
  const resume = truncate(input.resume, 20000);
  const jobDescription = truncate(input.jobDescription, 20000);
  const companyInfo = truncate(input.companyInfo, 20000);
  
  return { mode, position, customPosition, interviewType, difficulty, questionCount, resume, jobDescription, companyInfo };
}
```

**Error responses**:
- 400: Invalid type, difficulty, or missing position
- 400: Question count outside 1-30 range

## Interview Initialization

**Endpoint**: `POST /api/interview/start`

**Flow** (in `createSession` and `start()`):

1. **Validate config** - Ensure all fields meet constraints
2. **Create session** - Generate unique interview ID, store in memory and MongoDB
3. **Generate/retrieve opening question** (for text mode only):
   - Check question cache for matching: `(position, customPosition, interviewType, difficulty)`
   - If cached found: Use cached question
   - If not: Call Gemini to generate opening question
   - Save generated question to cache for future reuse

**Opening question generation** (from `initialPrompt`):

```javascript
async start() {
  const cached = await this._nextQuestion(this.config.difficulty, false);
  let opening = '';
  let question = cached ? cached.text : '';
  
  if (!cached) {
    // Call Gemini with schema
    const result = await gemini.generateJson({
      prompt: prompts.initialPrompt(this.config),
      systemInstruction: prompts.interviewerSystemPrompt(this.config),
      schema: prompts.schemas.initial,
    });
    
    opening = String(result.opening || '').trim();
    question = String(result.question || '').trim();
    
    // Cache for future use
    await saveGeneratedQuestion({
      position: this.config.position,
      interviewType: this.config.interviewType,
      difficulty: this.config.difficulty,
      text: question,
      isFollowUp: false,
      userId: this.userId,
    });
  }
  
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
  
  return { opening, question };
}
```

**System prompt basis** (from `interviewerSystemPrompt`):

```
You are a professional AI job interviewer conducting a real live interview for the [POSITION] position.

Interview type: [TYPE]
- behavioral: Focus on background, teamwork, communication, leadership
- technical: Focus on technical knowledge for specific topics
- mixed: Combine behavioral, situational, and technical questions

Rules:
- Ask exactly ONE question at a time
- Keep turns short, concise, and natural
- Maintain professional but friendly tone
- Adapt difficulty: strong answers → harder questions; weak → easier
- Never repeat questions
- Never reveal evaluation or scores
```

## Question Loop

### Text Mode Flow

**User submits answer** → `POST /api/interview/:id/answer`

**Handler logic** (in `answer()` method):

```javascript
async answer(text) {
  const answer = String(text || '').trim();
  
  // Validation
  if (!answer) throw new RequestError('Please provide an answer before continuing.');
  if (answer.length > 10000) throw new RequestError('That answer is too long.');
  
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  const answerStartMs = Date.now();
  
  // Add to transcript
  this.transcript.push({ role: 'candidate', text: answer });
  
  const currentNumber = this.questions.length;
  const isLast = currentNumber >= this.config.questionCount;
  
  if (isLast) {
    // FINAL ANSWER - See "Completion" section
    return this._handleFinalAnswer(answer, wordCount, answerStartMs);
  }
  
  // MID-INTERVIEW - Generate next question
  const nextDifficulty = this.lastDifficulty;
  const cached = await this._nextQuestion(nextDifficulty, true);
  
  let questionData;
  let questionSource = 'cache';
  
  if (cached) {
    questionData = { text: cached.text, isFollowUp: cached.isFollowUp, difficulty: nextDifficulty };
  } else {
    // Generate next question with evaluation
    const result = await gemini.generateJson({
      prompt: prompts.nextQuestionPrompt(this),
      systemInstruction: prompts.interviewerSystemPrompt(this.config),
      schema: prompts.schemas.step,
    });
    
    questionData = result.question || {};
    questionSource = 'generated';
    
    // Store answer's evaluation from generation step
    this.answers.push({
      questionNumber: currentNumber,
      answer,
      wordCount,
      elapsedMs: Date.now() - answerStartMs,
      difficulty: this.lastDifficulty,
      eval: normalizeEval(result.internalEval),  // From AI evaluation during question generation
    });
  }
  
  // Add next question to session
  const questionText = String(questionData.text || '').trim();
  const difficulty = questionData.difficulty || this.lastDifficulty;
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
  
  return {
    kind: 'question',
    question: { number: nextNumber, text: questionText },
  };
}
```

### Voice Mode Flow

Voice mode uses WebSocket (see [WEBSOCKET.md](./WEBSOCKET.md)) with Gemini Live API.

**Key difference**: Gemini handles speech recognition, question generation, and response audio in real-time.

**Session lifecycle**:
1. Client connects WebSocket with JWT token
2. Gemini Live session initialized with system prompt (verified from `liveInterviewerSystemPrompt`)
3. Client sends audio chunks (16000 Hz PCM)
4. Gemini processes audio, sends response audio (24000 Hz PCM) and text transcriptions
5. Server relays audio/text to client via WebSocket
6. After final question answered: Interview marked complete

**Gemini Live configuration** (from `backend/gemini/live.js`):

```javascript
const session = await client.live.connect({
  model: 'gemini-2.0-flash-exp',
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    inputAudioTranscription: { languageCodes: ['en-US'] },
    outputAudioTranscription: { languageCodes: ['en-US'] },
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
        endOfSpeechSensitivity: config.gemini.liveEndSensitivity,
        silenceDurationMs: config.gemini.liveSilenceMs,
      }
    }
  }
});
```

### Question Difficulty Adaptation

**Rule** (from `nextQuestionPrompt`):

```
Strong, demonstrated understanding → Ask for detail, explanation, or troubleshooting (harder).
Signs of struggle → Ask a clearer, more basic question.
```

**Implementation**:
- AI evaluates answer during question generation
- If `communication > 8` and `clarity > 8`: Next question difficulty increases (if not already advanced)
- If `technical < 6` or `clarity < 6`: Next question difficulty decreases (if not already beginner)
- Otherwise: Keep same difficulty

**Difficulty progression**:
```
beginner → intermediate → advanced
```

**Example** (from prompts):
```
Technical difficulty progression:
- Beginner: "What is DNS?"
- Intermediate: "How would you troubleshoot a DNS resolution problem?"
- Advanced: "Explain how recursive DNS resolution works and diagnose intermittent DNS failures."
```

### Hint System

**Endpoint**: `POST /api/interview/:id/hint`

**Purpose**: Help stuck candidate without revealing answer

**Prompt** (from `hintPrompt`):

```
Give the candidate ONE short, constructive hint (2-3 sentences) that:
- Helps them structure or think through their answer
- Does NOT reveal the whole model answer or ideal phrasing
- Nudges toward a specific angle:
  - Give concrete example
  - Use structure (STAR, issue-action-result)
  - Define a key term
  - Consider tradeoffs
- Be encouraging, not evaluative
- Never mention scores or difficulty
```

**Response**:
```json
{
  "hint": "Think about a specific project where you had to solve a networking issue. Walk us through what the problem was, what you tried, and how you fixed it—the STAR method works great here."
}
```

**Rate limit**: 30 hints per minute per IP

## Completion & Finalization

### Final Answer Handling

**When** `currentNumber >= config.questionCount`

**Process** (from `_handleFinalAnswer`):

1. **Evaluate final answer** - Call Gemini with closing prompt
2. **Generate closing message** - Warm thank-you from interviewer
3. **Mark complete** - Set `status = 'completed'`, `completedAt = Date.now()`
4. **Store evaluation** - Save answer's score to database
5. **Begin overall evaluation** - Start async evaluation process

```javascript
async _handleFinalAnswer(answer, wordCount, answerStartMs) {
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
  
  // Start evaluation (async, doesn't block response)
  await this.evaluate();
  await this._persist();
  
  return { kind: 'complete', closing, questionNumber: currentNumber };
}
```

### Finalize Endpoint

**Endpoint**: `POST /api/interview/:id/finalize` (text mode only)

**Purpose**: Mark interview complete and trigger evaluation

**Response**:
```json
{
  "interviewId": "uuid",
  "evaluation": { /* scores and suggestions */ }
}
```

## Scoring Algorithm

### Evaluation Dimensions

All scores are **0-10 integers**, calculated from AI assessments:

| Dimension | Definition |
|-----------|-----------|
| **technical** | Demonstrated knowledge and skill relevant to the role |
| **problemSolving** | Ability to analyze, reason, and resolve problems |
| **communication** | Clarity, articulation, and professionalism of responses |
| **clarity** | How well-structured and understandable the candidate's answers are |
| **confidence** | Poise and self-assurance during the interview |
| **adaptability** | Flexibility and ability to approach new situations |

### Per-Answer Evaluation

**When**: During question generation (each question except the first)

**Process** (from `nextQuestionPrompt`):

1. AI evaluates candidate's **latest answer only** on all 6 dimensions
2. Scores stored in `answer.eval = { technical, problemSolving, communication, clarity, confidence, adaptability }`
3. Scores influence next question difficulty
4. Scores accumulate for overall evaluation

**Example output**:
```javascript
{
  internalEval: {
    technical: 7,
    problemSolving: 8,
    communication: 7,
    clarity: 8,
    confidence: 6,
    adaptability: 7,
    note: "Candidate demonstrated solid technical understanding with clear problem-solving approach but showed slight hesitation on advanced concepts."
  }
}
```

### Overall Score Calculation

**When**: After interview completion via `evaluate()` method

**Algorithm** (from `engine.js`, verified):

```javascript
async evaluate() {
  const dims = ['technical', 'problemSolving', 'communication', 'clarity', 'confidence', 'adaptability'];
  
  // 1. Get full evaluation from Gemini based on entire transcript
  const fullEval = await gemini.generateJson({
    prompt: prompts.evaluationPrompt(this),
    systemInstruction: prompts.interviewerSystemPrompt(this.config),
    schema: prompts.schemas.eval,
  });
  
  // 2. If we have per-answer evaluations, blend them with full eval
  const ansWithEval = this.answers.filter((a) => a && a.eval);
  
  if (ansWithEval.length) {
    const sums = {};
    for (const d of dims) sums[d] = 0;
    
    // Sum per-answer scores
    for (const a of ansWithEval) {
      for (const d of dims) sums[d] += Number(a.eval[d]) || 0;
    }
    
    // Average per-answer scores
    let result = fullEval;
    for (const d of dims) {
      const turnAvg = Math.round(sums[d] / ansWithEval.length);
      // Blend: 50% turn average + 50% full eval
      result[d] = Math.round((turnAvg + (Number(result[d]) || turnAvg)) / 2);
    }
  } else {
    result = fullEval;
  }
  
  // 3. Clamp all scores to 0-10
  const ev = normalizeEval(result);  // Clamps to [0, 10]
  
  // 4. Calculate overall score as average of 6 dimensions
  const average = dims.reduce((acc, d) => acc + ev[d], 0) / dims.length;
  
  // 5. Round to nearest 0.5
  this.evaluation = {
    ...ev,
    overall: Math.round(average * 2) / 2
  };
  
  return this.evaluation;
}
```

**Normalization** (from `normalizeEval`):

```javascript
function normalizeEval(value) {
  const clamp = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.min(10, Math.max(0, Math.round(v))) : 7;
  };
  
  return {
    technical: clamp(e.technical),
    problemSolving: clamp(e.problemSolving),
    communication: clamp(e.communication),
    clarity: clamp(e.clarity),
    confidence: clamp(e.confidence),
    adaptability: clamp(e.adaptability),
    note: e.note || 'Default feedback...',
    suggestions: validateAndClean(e.suggestions),
  };
}
```

### Fallback Scoring

**When**: Gemini evaluation fails or times out

**Process** (from `evaluate()` catch block):

1. If no per-answer evals exist: Set all dimensions to 7 (neutral)
2. If per-answer evals exist: Average per-answer scores for each dimension
3. Calculate overall as average of 6 dimensions
4. Generate generic suggestions based on dimension scores

```javascript
catch (err) {
  console.error('[EVALUATION_FALLBACK_TRIGGER]', err.message);
  
  const fallbackScores = {};
  const ansWithEval = this.answers.filter((a) => a && a.eval);
  
  if (ansWithEval.length) {
    for (const d of dims) {
      const sum = ansWithEval.reduce((acc, a) => acc + (Number(a.eval[d]) || 7), 0);
      fallbackScores[d] = Math.round(sum / ansWithEval.length);
    }
  } else {
    for (const d of dims) fallbackScores[d] = 7;
  }
  
  const ev = normalizeEval(fallbackScores);
  const average = dims.reduce((acc, d) => acc + ev[d], 0) / dims.length;
  
  this.evaluation = {
    ...ev,
    overall: Math.round(average * 2) / 2,
    note: 'Based on your answers, here are your strengths and areas...',
  };
}
```

### Suggestions Generation

**Prompt basis** (from `evaluationPrompt`):

```
Write "suggestions" as an array of 2-4 short, specific, actionable improvement tips.
Each suggestion should be one clear sentence tied to the candidate's actual performance.

Examples:
- "Incorporate more specific technical details and practical examples from past projects."
- "Structure behavioral responses using STAR method (Situation, Task, Action, Result)."
- "Elaborate further on troubleshooting methodology and technical trade-offs."
```

**Processing** (from `normalizeEval`):

- If suggestions provided: Use first 6 items
- If empty: Use default suggestions
- Each suggestion clamped to 1-2 sentences

**Result stored**:
```javascript
{
  suggestions: [
    "Practice more complex problem scenarios...",
    "Work on technical depth...",
    "Consider using STAR method..."
  ]
}
```

## Results & Statistics

### Session Summary

**Endpoint**: `GET /api/interview/:id`

**Returns** (from `summary()` method):

```javascript
{
  interviewId: string,
  position: string,
  customPosition: string | null,
  interviewType: 'behavioral' | 'technical' | 'mixed',
  difficulty: 'beginner' | 'intermediate' | 'advanced',
  questionCount: number,
  status: 'in_progress' | 'completed',
  createdAt: timestamp,
  startedAt: timestamp | null,
  completedAt: timestamp | null,
  questions: [
    {
      number: 1,
      text: string,
      difficulty: string,
      isFollowUp: boolean,
      source: 'cache' | 'generated'
    },
    // ...
  ],
  transcript: [
    { role: 'interviewer', text: string },
    { role: 'candidate', text: string },
    // ...
  ],
  lastQuestion: { /* last question object */ } | null,
  evaluation: {
    technical: 0-10,
    problemSolving: 0-10,
    communication: 0-10,
    clarity: 0-10,
    confidence: 0-10,
    adaptability: 0-10,
    overall: 0-10,
    note: string,
    suggestions: string[]
  } | null,
  stats: {
    totalWords: number,
    answeredQuestions: number,
    avgWordsPerAnswer: number,
    avgMsPerAnswer: number,
    totalMs: number,
    longestAnswerWords: number,
    shortestAnswerWords: number
  } | null,
  questionTiming: [
    {
      number: 1,
      difficulty: string,
      wordCount: number,
      elapsedMs: number
    },
    // ...
  ]
}
```

### Statistics Calculation

**From `_buildStats()`**:

```javascript
{
  totalWords: total words across all answers,
  answeredQuestions: number of answered questions,
  avgWordsPerAnswer: mean words per answer,
  avgMsPerAnswer: mean milliseconds per answer,
  totalMs: sum of all answer times,
  longestAnswerWords: max words in single answer,
  shortestAnswerWords: min words in single answer
}
```

**Used for**: Answer pacing visualization in results page

## Interview Types & Topics

### Topic Mapping

**Each position has focus areas** (from `prompts.js`):

| Position | Topics |
|----------|--------|
| IT Intern | Computer fundamentals, OS, networking basics, hardware, troubleshooting |
| IT Generalist Intern | Computer fundamentals, networking basics, DNS/DHCP, hardware, OS, troubleshooting, technical support |
| Network Technician | OSI model, TCP/IP, LAN/WAN, IP addressing, DNS, DHCP, network troubleshooting, routing/switching |
| Web Developer | HTML/CSS, JavaScript, front-end/back-end concepts, HTTP, databases/SQL, web tools |
| Software Developer | Programming concepts, data structures/algorithms, databases/SQL, Git, debugging |
| Cybersecurity Intern | Security fundamentals, threats/vulnerabilities, network security, encryption, best practices |

### Interview Type System Prompts

**Behavioral**:
- Focus on background, teamwork, communication, leadership, conflict resolution
- Use "Tell me about a time when..." style questions
- Assess soft skills and work ethic

**Technical**:
- Focus on position-specific knowledge
- Ask about concepts, troubleshooting, deep understanding
- Assess technical depth and reasoning

**Mixed**:
- Combine introduction, behavioral, situational, technical, problem-solving
- Adapt naturally based on conversation flow
- Assess both soft and technical skills

## Voice Mode Specifics

### System Prompt Differences

**Text mode** uses `interviewerSystemPrompt()`

**Voice mode** uses `liveInterviewerSystemPrompt()` with additional rules:

```
YOU ARE SPEAKING OUT LOUD IN A LIVE VOICE INTERVIEW.

- Conduct exactly N questions total, one per turn
- Speak each turn naturally and concisely
- Ask exactly one question per turn, then stop and wait
- Never begin speaking while candidate is still talking
- Never repeat a question already asked
- After question N (final), deliver brief warm closing
- End message with exact phrase: INTERVIEW COMPLETE
- Do NOT mention assessment, ratings, scores, or next steps
```

### Silence Detection

**Configuration** (from `config.js`):

```javascript
gemini: {
  liveEndSensitivity: 'END_SENSITIVITY_DEFAULT',
  liveSilenceMs: 1000,  // 1 second of silence = end of turn
}
```

**Behavior**:
- Candidate answers, Gemini detects 1s silence
- Turn ends automatically, next question generated
- No manual submission required (unlike text mode)

## Error Handling

### Evaluation Failures

**Graceful degradation**:
1. Try full Gemini evaluation first
2. If fails: Blend per-answer evaluations
3. If no per-answer evals: Set all dimensions to 7
4. Log error for debugging but return successful response

### Missing Questions

**If Gemini returns empty question**:
```javascript
if (!questionText) throw new Error('AI returned an empty question.');
```

**Handled by**:
- User sees generic error message
- Interview session still saved
- User can retry or view partial results

### MongoDB Unavailable

**If no MongoDB configured**:
- Interviews run in memory only
- No persistence to database
- Session lost on server restart
- Per-answer evaluations still work (computed during generation)

---

**See also**:
- [API.md](./API.md#interview-endpoints) - Interview API endpoints
- [WEBSOCKET.md](./WEBSOCKET.md) - Real-time voice mode protocol
- [BACKEND.md](./BACKEND.md#interview-session-engine) - Session engine implementation
- [DATABASE.md](./DATABASE.md#interviewsession-schema) - Persistent schema
