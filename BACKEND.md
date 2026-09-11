# Backend

This document describes the Express.js backend architecture, middleware stack, request handling, authentication flow, and integration with external services.

## Overview

The AI Interviewer backend is a **single Node.js Express server** that handles:

1. **REST API** - Authentication, interview management, session history
2. **WebSocket Server** - Real-time voice interview streaming
3. **Gemini Integration** - Question generation, answer evaluation, audio streaming
4. **MongoDB Persistence** - User accounts, interview history, question caching

**Entry point**: `backend/index.js`  
**Configuration**: `backend/config.js`  
**Database**: `backend/db.js`

## Project Structure

```
backend/
├── index.js                 # Express app setup, middleware, error handling
├── config.js               # Environment configuration (verified from .env)
├── db.js                   # MongoDB connection
├── routes/
│   ├── auth.js            # Auth endpoints (signup, login, verify-otp, etc.)
│   └── interview.js        # Interview endpoints (start, answer, finalize, etc.)
├── auth/
│   ├── middleware.js       # JWT verification middleware
│   ├── token.js            # JWT signing/verification
│   ├── passwords.js        # Password hashing (bcryptjs)
│   └── email.js            # Email sending (EmailJS)
├── interview/
│   ├── engine.js           # Session lifecycle and evaluation logic
│   ├── store.js            # MongoDB persistence layer
│   └── prompts.js          # System prompts for Gemini
├── gemini/
│   ├── client.js           # Gemini API client (text + streaming)
│   └── live.js             # Gemini Live API client (voice)
├── cache/
│   └── questions.js        # Question caching and retrieval
├── models/
│   ├── User.js             # User schema
│   ├── Session.js          # Interview session schema
│   └── Question.js         # Question cache schema
└── assets/
    └── interview-complete.pcm  # Closing chime audio file
```

## Express App Setup

**Location**: `backend/index.js`

### Middleware Stack

Applied in order (verified from code):

```javascript
// 1. Crash protection
process.on('uncaughtException', ...)
process.on('unhandledRejection', ...)

// 2. Global security (Helmet)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}))

// 3. Bot detection & blocking
app.use((req, res, next) => { /* Check user-agent */ })

// 4. Rate limiting (global API limiter)
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '...' }
}))

// 5. CORS
app.use(cors({ origin: config.webUrl, credentials: true }))

// 6. JSON parsing
app.use(express.json())

// 7. Static file serving
app.use(express.static('public'))

// 8. Route handlers
app.use('/api/auth', authRoutes)
app.use('/api/interview', requireAuth, interviewRoutes)
app.get('/api/me/sessions', requireAuth, ...)
app.delete('/api/me/sessions', requireAuth, ...)
app.get('/api/status', ...)
app.get('/api/health', ...)

// 9. 404 handler
app.use((req, res) => { ... })

// 10. Error handler
app.use((err, req, res, next) => { ... })
```

### Proxy Configuration

```javascript
app.set('trust proxy', 1);
```

**Purpose**: Trust X-Forwarded-* headers from reverse proxy (needed for rate limiting to work correctly behind nginx/Apache)

### Static Files

```javascript
app.use(express.static('public'));
```

Serves built frontend from `backend/public/` directory (should symlink to `frontend/public/dist/` after build).

## Authentication

### JWT Token Structure

**Location**: `backend/auth/token.js`

```javascript
function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, name: user.name },
    config.jwtSecret,
    { expiresIn: '30d' }  // 30-day expiration
  );
}
```

**Payload**:
- `sub` - Subject (user ID as string)
- `email` - User email
- `name` - User display name
- `iat` - Issued at (auto)
- `exp` - Expiration (30 days from issue)

**Signing**: HMAC-SHA256 with `JWT_SECRET` from environment

**Token lifetime**: 30 days

### Authentication Middleware

**Location**: `backend/auth/middleware.js`

#### `requireAuth(req, res, next)`

Strict authentication - rejects if missing or invalid.

```javascript
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub).select('emailVerified email name').lean();
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please sign in again.' });
    }
    if (!user.emailVerified) {
      return res.status(403).json({ 
        error: 'Email not verified. Please verify your email address.',
        needsVerification: true, 
        email: user.email 
      });
    }
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }
}
```

**Checks**:
1. Bearer token present in `Authorization` header
2. Token is valid and not expired
3. User still exists in database
4. User's email is verified

**On failure**: Returns 401 or 403 with error message

#### `optionalAuth(req, res, next)`

Soft authentication - continues even if missing or invalid.

```javascript
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
  } catch (err) {
    req.user = null;
  }
  return next();
}
```

**Usage**: `/api/auth/me` endpoint - returns different responses based on whether user is authenticated

### Password Hashing

**Location**: `backend/auth/passwords.js`

Uses **bcryptjs** for password hashing:

```javascript
const bcrypt = require('bcryptjs');

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
```

**Security**:
- Salt rounds: 10 (balances security and performance)
- Never stores plain text passwords
- Comparison timing is resistant to timing attacks

### Email Verification

**Location**: `backend/auth/email.js`

Sends verification and password reset codes via EmailJS (or logs to console in dev).

```javascript
async function sendVerificationEmail(email, code) {
  if (!config.emailjs.serviceId) {
    // Development mode: log to console
    console.log(`[DEV] Verification code for ${email}: ${code}`);
    return { devCode: code };
  }
  // Production: send via EmailJS
  return emailjs.send({
    service_id: config.emailjs.serviceId,
    template_id: config.emailjs.templateId,
    user_id: config.emailjs.publicKey,
    template_params: {
      to_email: email,
      verification_code: code,
      // ... other params
    }
  }, {
    publicKey: config.emailjs.publicKey,
    privateKey: config.emailjs.privateKey
  });
}
```

**OTP Code**:
- 6 random digits (100,000 - 999,999)
- Expires in 10 minutes
- Used for email verification and password reset

## Request Handling

### Error Handling Pattern

All routes wrap logic in try-catch:

```javascript
router.post('/endpoint', async (req, res) => {
  try {
    // Business logic
    res.json({ result: data });
  } catch (err) {
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Operation failed:', err.message);
    res.status(502).json({ error: 'Service temporarily unavailable. Please try again.' });
  }
});
```

**Pattern**:
- Custom `RequestError` for validation/business logic errors (specific status codes)
- Generic errors mapped to 502 (Bad Gateway) or 500 (Internal Server Error)
- Always log errors to console for debugging

### RequestError Class

**Location**: `backend/interview/engine.js:14-19`

```javascript
class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
```

Used for user-facing validation errors:
- 400 - Bad Request (invalid input)
- 404 - Not Found (resource doesn't exist)
- 409 - Conflict (invalid state transition)

## Interview Session Engine

**Location**: `backend/interview/engine.js`

### Session Lifecycle

Interview sessions are created, updated, and persisted through a single `InterviewSession` class.

#### Session Creation

```javascript
async function createSession(config, opts = {}) {
  const session = new InterviewSession(config, {
    id: randomUUID(),
    mongoId: opts.mongoId,
    userId: opts.userId
  });
  
  // Persist to MongoDB if configured
  const doc = await store.createSessionDoc({
    _id: session.id,
    user: opts.userId || null,
    mode: config.mode,
    config,
    status: 'in_progress'
  });
  
  return session;
}
```

**Initial state**:
- `status: 'in_progress'`
- `startedAt: null` (not started until first question)
- `questions: []`, `answers: []` (empty arrays)

#### Text Interview Flow

1. **Start** (`POST /api/interview/start`, mode: 'text')
   - Create session
   - Generate first question via Gemini
   - Return question to client

2. **Answer** (`POST /api/interview/:id/answer`)
   - Receive answer
   - Evaluate via Gemini
   - Decide if more questions needed
   - If more: generate follow-up question
   - If done: return `complete: true`

3. **Finalize** (`POST /api/interview/:id/finalize`)
   - Mark `status: 'completed'`
   - Run final evaluation
   - Persist to MongoDB

#### Voice Interview Flow

1. **Start** (`POST /api/interview/start`, mode: 'voice')
   - Create session
   - Return session ID (don't generate question yet)

2. **WebSocket Connect** (`/live/:id?token=JWT`)
   - Backend connects to Gemini Live API
   - Sends system prompt with interview configuration
   - Begins streaming audio

3. **Complete** (automatic when question count reached)
   - Backend marks complete
   - Sends evaluation to client
   - Persists to MongoDB

### Configuration Validation

**Location**: `backend/interview/engine.js:26-56`

```javascript
function validateConfig(body) {
  // Position (required)
  const position = String(input.position || '').trim();
  if (!position) throw new RequestError('A position is required.');
  
  // Interview type (required, enum)
  const interviewType = String(input.interviewType || '').trim();
  if (!VALID_TYPES.includes(interviewType)) {
    throw new RequestError('A valid interview type is required.');
  }
  // VALID_TYPES = ['behavioral', 'technical', 'mixed']
  
  // Difficulty (required, enum)
  const difficulty = String(input.difficulty || '').trim();
  if (!VALID_DIFFICULTIES.includes(difficulty)) {
    throw new RequestError('A valid difficulty level is required.');
  }
  // VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced']
  
  // Question count (optional, default 10, range 1-30)
  let questionCount = Number(input.questionCount);
  if (!Number.isFinite(questionCount)) questionCount = 10;
  questionCount = Math.min(30, Math.max(1, Math.round(questionCount)));
  
  return {
    mode: String(input.mode || 'text'),
    position,
    customPosition: truncate(input.customPosition, 500),
    interviewType,
    difficulty,
    questionCount
  };
}
```

**Constraints**:
- `position`: Required, non-empty string
- `interviewType`: Must be 'behavioral', 'technical', or 'mixed'
- `difficulty`: Must be 'beginner', 'intermediate', or 'advanced'
- `questionCount`: 1-30 questions (clamped)
- `customPosition`: Max 500 characters
- `resume`, `jobDescription`, `companyInfo`: Max 20,000 characters each

## Gemini Integration

### Text/REST Client

**Location**: `backend/gemini/client.js`

```javascript
async function generateText({ prompt, systemInstruction, temperature = 0.7 }) {
  const request = {
    model: getModel(),  // Default: gemini-3.6-flash
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  if (systemInstruction) {
    request.config.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  request.config.temperature = temperature;  // 0.0-1.0 (creativity)
  
  const response = await getClient().models.generateContent(request);
  return response && response.text ? response.text() : '';
}

async function generateJson({ prompt, systemInstruction, schema, temperature = 0.6 }) {
  // Similar to generateText but sets responseMimeType: 'application/json'
  // Constrains response to valid JSON
}
```

**Usage**:
- Question generation: `generateText()` to get natural question
- Answer evaluation: `generateJson()` to parse structured scores

### Live Voice Client

**Location**: `backend/gemini/live.js`

Connects to Gemini Live API for real-time audio streaming:

```javascript
class LiveVoice {
  async connect({ systemInstruction, onMessage }) {
    const liveModel = await geminiClient.resolveLiveModel();
    if (!liveModel) {
      throw new Error('No live-capable Gemini model is available for voice.');
    }
    
    this.session = await client.live.connect({
      model: liveModel,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        inputAudioTranscription: { languageCodes: ['en-US'] },
        outputAudioTranscription: { languageCodes: ['en-US'] },
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: config.gemini.liveEndSensitivity,
            silenceDurationMs: config.gemini.liveSilenceMs,
          },
        },
      },
      callbacks: {
        onopen: () => this.onOpen && this.onOpen(),
        onmessage: onMessage,
        onerror: (e) => this.onError && this.onError(e),
        onclose: (e) => this.onClose && this.onClose(e),
      },
    });
  }
  
  sendAudio(dataBase64, sampleRate = 16000) {
    this.session.sendRealtimeInput({
      audio: { data: dataBase64, mimeType: `audio/pcm;rate=${sampleRate}` }
    });
  }
}
```

**Configuration**:
- `responseModalities: [Modality.AUDIO]` - Get audio responses
- `inputAudioTranscription` - Transcribe user speech
- `outputAudioTranscription` - Transcribe AI speech
- `automaticActivityDetection` - Silence detection for end-of-speech

## Question Generation & Caching

### Question Bank

**Location**: `backend/cache/questions.js`

```javascript
async function findCachedQuestion(position, interviewType, difficulty, isFollowUp = false) {
  // Query MongoDB for cached questions
  const query = {
    position: new RegExp(`^${escapeRegex(position)}$`, 'i'),
    interviewType,
    difficulty,
    isFollowUp,
    quality: { $gte: 0 }
  };
  
  const question = await Question.findOne(query)
    .select('text difficulty source')
    .lean();
  
  return question ? question.text : null;
}

async function saveGeneratedQuestion(position, interviewType, difficulty, questionText, isFollowUp = false) {
  try {
    return await Question.create({
      position,
      interviewType,
      difficulty,
      text: questionText,
      isFollowUp,
      quality: 0,
      uses: 1,
      selectedCount: 1
    });
  } catch (err) {
    return null;
  }
}
```

**Question Selection**:
1. Try to find cached question matching criteria
2. If found: Return cached question (faster)
3. If not found: Generate via Gemini and cache for next time

### Prompts

**Location**: `backend/interview/prompts.js`

System prompts for Gemini tailored to interview type and difficulty:

```javascript
function liveInterviewerSystemPrompt(config) {
  return `You are an expert technical interviewer for the position of ${config.position}.
  
  Your task:
  - Ask ${config.questionCount} interview questions
  - Difficulty level: ${config.difficulty}
  - Interview type: ${config.interviewType}
  - Listen actively and ask follow-ups
  - End with: "INTERVIEW COMPLETE" when done
  
  Be conversational and professional.`;
}
```

Different prompts for:
- Question generation (text mode)
- Live interviewing (voice mode)
- Answer evaluation (structured JSON)
- Follow-up question generation

## Rate Limiting

**Location**: `backend/index.js`

### Global API Limiter

```javascript
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});
app.use('/api/', apiLimiter);
```

### Per-Endpoint Limiters

```javascript
const interviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 20,                    // 20 sessions per IP per hour
  message: { error: 'Too many interview sessions created. Please try again later.' }
});

const answerLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 30,                    // 30 answers per IP per minute
  message: { error: 'Too many requests. Please slow down.' }
});
```

**Response headers** (RateLimit-*) included in all responses.

## Bot Detection

**Location**: `backend/index.js:34-42`

Blocks requests from automated tools:

```javascript
app.use((req, res, next) => {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const scrapers = [
    'python', 'curl', 'wget', 'scrapy', 'postman', 
    'headless', 'phantomjs', 'selenium', 'puppeteer', 'beautifulsoup'
  ];
  if (scrapers.some(bot => ua.includes(bot))) {
    return res.status(403).json({ error: 'Access denied: automated requests are prohibited.' });
  }
  next();
});
```

**Blocked tools**: curl, Postman, Python requests, Selenium, Puppeteer, etc.

**Rationale**: Prevents scraping, automated testing, and abuse

## CORS Configuration

**Location**: `backend/index.js:54`

```javascript
app.use(cors({ 
  origin: config.webUrl,  // Only frontend origin allowed
  credentials: true       // Allow cookies/credentials
}));
```

**Effect**: 
- Only requests from `config.webUrl` (default: http://localhost:5173) are allowed
- Cross-origin requests from other domains rejected
- Must be updated in production to match frontend domain

## Security Headers (Helmet)

**Location**: `backend/index.js:29-32`

```javascript
app.use(helmet({
  contentSecurityPolicy: false,  // Disabled for dev flexibility
  crossOriginEmbedderPolicy: false
}));
```

**Enabled** (default Helmet):
- `X-Content-Type-Options: nosniff` - Prevent MIME sniffing
- `X-Frame-Options: DENY` - Clickjacking protection
- `Strict-Transport-Security` - HTTPS enforcement (prod)
- `X-XSS-Protection` - XSS protection headers

## Error Handling

### Global Error Handler

```javascript
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: err.message || 'Internal server error', 
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack 
  });
});
```

**Behavior**:
- Logs full error (including stack) to console
- Returns 500 status
- Includes stack trace only in development (not production)

### 404 Handler

```javascript
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
```

Any unmatched routes return 404.

## Service Dependencies

### MongoDB

- Required for: User accounts, interview history, question caching
- Optional: App works without (graceful degradation)
- Connection: `backend/db.js`
- Fallback: In-memory storage, sessions lost on restart

### Google Gemini API

- Required for: Question generation, answer evaluation, voice streaming
- Optional: App warns on startup but continues
- Without: `/api/status` shows `"configured": false`, interview creation fails with 502

### EmailJS

- Optional: Email verification and password reset
- Without: Codes logged to console (development mode)
- Fallback: Users cannot verify email/reset password without it

## Development Mode

### Auto-reload

```javascript
npm run dev
```

Uses Node.js `--watch` flag for automatic restart on file changes.

### Debugging

```bash
npm run dev:backend

# Enable verbose logging
DEBUG=* npm run dev:backend
```

Common logs:
- `[AUTH] User logged in successfully: ...`
- `[INTERVIEW] Started new session: ...`
- `[ASSESSMENT] Generating assessment...`
- `[VOICE_SESSION] Voice connection closed.`

### Testing Endpoints

Use curl, Postman, or browser Dev Tools:

```bash
# Health check
curl http://localhost:3000/api/health

# System status
curl http://localhost:3000/api/status

# Signup (no auth needed)
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"Password123"}'
```

## Production Deployment

### Environment Setup

Create `.env` with production values:

```bash
GEMINI_API_KEY=your-production-key
GEMINI_MODEL=gemini-3.6-flash
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/ai-interviewer
JWT_SECRET=<long-random-secret>
PORT=3000
WEB_URL=https://interview.example.com
BACKEND_URL=https://api.example.com
```

### Running Production

```bash
npm start --prefix backend
```

Starts server without auto-reload.

### Process Management

Use PM2, systemd, or Docker:

```bash
# PM2 example
pm2 start backend/index.js --name "ai-interviewer" --env production
```

### HTTPS/SSL

Behind reverse proxy (nginx/Apache) with SSL certificate.

### Monitoring

- Monitor logs for errors
- Set up alerts for 502 errors (Gemini API issues)
- Track API error rates
- Monitor database connection status

## Code Organization

### Separation of Concerns

| Module | Responsibility |
|--------|-----------------|
| `routes/*` | HTTP endpoints, validation, response formatting |
| `auth/*` | JWT, passwords, email verification |
| `interview/*` | Session lifecycle, question generation, evaluation |
| `gemini/*` | Gemini API client and integration |
| `models/*` | MongoDB schemas and validation |
| `cache/*` | Question caching logic |

### Request Flow Example

```
POST /api/interview/start
  ↓
requireAuth middleware (verify JWT)
  ↓
interviewLimiter (rate limit check)
  ↓
validateConfig (validate input)
  ↓
createSession (create in-memory session)
  ↓
gemini.generateText() (get first question)
  ↓
store.createSessionDoc() (persist to MongoDB)
  ↓
return { interviewId, question, ... }
```

---

**See also**:
- [API.md](./API.md) - Endpoint specifications
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System design
- [DATABASE.md](./DATABASE.md) - MongoDB schemas
- [SECURITY.md](./SECURITY.md) - Security details
