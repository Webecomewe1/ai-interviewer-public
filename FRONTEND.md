# Frontend

This document describes the frontend architecture, HTML pages, JavaScript modules, and state management for the AI Interviewer user interface.

## Overview

The frontend is a **multi-page application** built with **Vite** and vanilla JavaScript (no framework). It consists of:

- **5 HTML pages** for different user flows
- **9 JavaScript modules** for core functionality
- **Responsive design** with light/dark theme support
- **Client-side state** managed via localStorage and in-memory variables

**Entry point**: `frontend/public/index.html`  
**Build tool**: `frontend/vite.config.js`  
**Development server**: Port 5173 (Vite default)

## Project Structure

```
frontend/public/
├── index.html              # Home/setup page (interview configuration)
├── login.html              # Login form
├── register.html           # Signup/registration form
├── interview.html          # Interview interface (text or voice)
├── results.html            # Results and evaluation display
├── js/
│   ├── auth.js            # Token management and auth endpoints
│   ├── authform.js        # Login/register form handling
│   ├── common.js          # Shared utilities, global state, UI helpers
│   ├── setup.js           # Interview configuration and form logic
│   ├── interview.js        # Interview UI and text mode handling
│   ├── audio.js           # Audio recording and playback
│   ├── results.js         # Results page display logic
│   ├── charts.js          # Score visualization
│   └── pcm.js             # PCM audio encoding/decoding
├── css/
│   ├── style.css          # Main stylesheet (variables, layout, components)
│   └── [theme stylesheets]
├── images/                # Static images and icons
├── worklets/              # Web Audio worklets for real-time processing
└── dist/                  # Built output (Vite)
```

## HTML Pages

### index.html - Home / Setup Page

**Purpose**: Interview configuration and mode selection

**Key sections**:
1. **Topbar** - Navigation, connection status, auth buttons, theme toggle
2. **Hero section** - Project description and features
3. **History card** - List of recent past interviews (if logged in)
4. **Setup form** - Interview configuration with fields:
   - Mode picker (voice/text)
   - Position selector (predefined + custom)
   - Interview type (behavioral/technical/mixed)
   - Difficulty (beginner/intermediate/advanced)
   - Question count (5/10/15/custom)
   - Optional context (resume, job description, company info)
5. **Status banner** - Server connection status and error messages

**Key elements** (verified from code):
```html
<form id="setup-form">
  <div class="mode-picker" id="mode-picker">
    <button id="mode-voice">Voice interview</button>
    <button id="mode-text">Text interview</button>
  </div>
  <div id="position-chips">
    <!-- Predefined positions + custom input -->
  </div>
  <select id="interview-type">
    <option value="behavioral">Behavioral</option>
    <option value="mixed">Mixed</option>
    <option value="technical">Technical</option>
  </select>
  <select id="difficulty">
    <option value="beginner">Beginner</option>
    <option value="intermediate">Intermediate</option>
    <option value="advanced">Advanced</option>
  </select>
  <input type="number" id="question-count" min="1" max="30" />
  <textarea id="resume" placeholder="Resume / experience"></textarea>
  <textarea id="job-description" placeholder="Job description"></textarea>
  <textarea id="company-info" placeholder="Company info"></textarea>
  <button type="submit" id="start-btn">Start interview</button>
</form>
```

**Validation** (in `setup.js`):
- Position: Required, non-empty
- Interview type: One of ['behavioral', 'technical', 'mixed']
- Difficulty: One of ['beginner', 'intermediate', 'advanced']
- Question count: 1-30
- Resume/job/company: Max 20,000 chars each

**Interactions**:
- Mode toggle updates UI (shows/hides voice-specific elements)
- Position "Custom" shows text input for custom position
- "Advanced options" expands/collapses extra fields
- Form auto-saves to localStorage (draft preservation)
- "New Session" button clears draft and resets form
- History list loaded from `/api/me/sessions`

### login.html - Login Page

**Purpose**: User login with email and password

**Key form**:
```html
<form id="login-form">
  <input type="email" id="email" required />
  <input type="password" id="password" required />
  <button type="submit">Sign in</button>
</form>
<p id="verification-prompt"><!-- Shows if email not verified --></p>
<input type="text" id="verification-code" placeholder="Enter OTP" />
<button id="verify-btn">Verify</button>
```

**Flow** (in `authform.js`):
1. User enters email/password
2. `POST /api/auth/login` called
3. If `response.needsVerification === true`:
   - Show verification code input
   - User enters OTP (from email or console in dev)
   - `POST /api/auth/verify-otp` called with code
4. On success: Token stored in localStorage, redirect to index.html
5. On error: Display error message

### register.html - Signup Page

**Purpose**: User registration / account creation

**Key form**:
```html
<form id="signup-form">
  <input type="text" id="name" placeholder="Your name" required />
  <input type="email" id="email" required />
  <input type="password" id="password" placeholder="Min. 8 characters" required />
  <button type="submit">Create account</button>
</form>
```

**Flow** (in `authform.js`):
1. User enters name, email, password
2. `POST /api/auth/signup` called
3. Backend sends verification email (or logs OTP in dev)
4. Show OTP input screen
5. User enters code
6. `POST /api/auth/verify-otp` called
7. On success: Account created, token stored, redirect to index.html

**Validation**:
- Email: Valid format
- Password: Minimum 8 characters
- Name: Max 80 characters

### interview.html - Interview Interface

**Purpose**: Conduct interview in text or voice mode

**Sections** (dynamically shown/hidden):
1. **Welcome screen** - Interview summary and start button
2. **Text mode screen** - Question display, answer textarea, submit button
3. **Voice mode screen** - Real-time audio visualization, transcript display, stop button
4. **Results screen** - Scores and evaluation (shown after completion)

**Key elements**:
```html
<div id="interview-screen">
  <!-- Welcome section -->
  <div id="welcome-section">
    <h1>Interview: <span id="summary-position"></span></h1>
    <p>Questions: <span id="summary-count"></span></p>
    <button id="start-btn">Start</button>
  </div>
  
  <!-- Text mode section -->
  <div id="text-section" class="hidden">
    <div id="question-display">
      <p id="current-question"></p>
      <p id="question-number"></p>
    </div>
    <textarea id="answer-input" placeholder="Type your answer..."></textarea>
    <button id="submit-answer-btn">Submit answer</button>
    <button id="get-hint-btn">Get hint</button>
  </div>
  
  <!-- Voice mode section -->
  <div id="voice-section" class="hidden">
    <div id="audio-visualizer"></div>
    <p id="microphone-status">Allow microphone access</p>
    <div id="transcript">
      <p id="interviewer-text"></p>
      <p id="candidate-text"></p>
    </div>
    <button id="stop-recording-btn">Stop interview</button>
  </div>
</div>
```

**Session state** (stored in memory during interview):
- `currentInterviewId` - Interview ID
- `currentMode` - 'text' or 'voice'
- `questionNumber` - Current question index
- `totalQuestions` - Total questions planned
- `websocket` - WebSocket connection (voice mode only)
- `mediaRecorder` - Audio recorder (voice mode only)

### results.html - Results and Evaluation

**Purpose**: Display interview scores and feedback

**Key sections**:
1. **Overall score** - Large numerical display
2. **Score breakdown** - Individual scores for:
   - Technical
   - Problem-solving
   - Communication
   - Clarity
   - Confidence
   - Adaptability
3. **Evaluation note** - Text summary
4. **Suggestions** - List of improvement areas
5. **Action buttons** - New interview, view transcript, download results

**Key elements**:
```html
<div id="results-screen">
  <h1>Your Interview Results</h1>
  
  <div id="overall-score">
    <span id="score-value">8.5</span>
    <span class="score-label">Overall</span>
  </div>
  
  <div id="scores-grid">
    <!-- Dynamically populated -->
    <div class="score-card">
      <span class="score-name">Technical</span>
      <span class="score-number" id="score-technical">7.8</span>
      <div class="score-bar" style="width: 78%"></div>
    </div>
    <!-- More score cards -->
  </div>
  
  <div id="evaluation-note"></div>
  <ul id="suggestions-list"></ul>
  <button id="new-interview-btn">New interview</button>
  <button id="view-transcript-btn">View transcript</button>
</div>
```

## JavaScript Modules

### auth.js - Authentication & Token Management

**Purpose**: Manage JWT tokens, handle auth API calls

**Exports** (global `window.Auth`):

```javascript
window.Auth = {
  // Token management
  getToken(): string | null,
  storeToken(token): void,
  logout(): void,
  isLoggedIn(): boolean,
  
  // Token parsing
  parseUser(token): { id, email, name } | null,
  
  // API calls
  authRequest(path, body): Promise<response>,
  
  // Auth flows
  login(email, password): Promise<data>,
  signup(name, email, password): Promise<data>,
  verifyOtp(email, code): Promise<data>,
  resendOtp(email): Promise<data>,
  forgotPassword(email): Promise<data>,
  verifyResetOtp(email, code): Promise<data>,
  resetPassword(email, newPassword): Promise<data>
}
```

**Token storage**: `localStorage['ai-interviewer:auth']`

**Token structure**: JWT with payload:
```json
{
  "sub": "user-id",
  "email": "user@example.com",
  "name": "User Name"
}
```

**Token decoding** (client-side, for display only):
```javascript
function parseUser(token) {
  // Decodes JWT payload without verification
  // Used to get user info for display
  return { id, email, name };
}
```

### authform.js - Login/Register Form Handling

**Purpose**: Form submission, validation, error display

**Key functions**:
```javascript
function handleLoginSubmit(event)
function handleSignupSubmit(event)
function handleVerifyOtpSubmit(event)
function showVerificationPrompt(email, devCode)
function displayError(message)
```

**Flow**:
1. User submits form
2. Validate inputs locally
3. Call `Auth.login()` or `Auth.signup()`
4. If success: Redirect to index.html
5. If needs verification: Show OTP input
6. If error: Display message in red banner

**Error handling**: Shows error message below form with details from server

### common.js - Shared Utilities

**Purpose**: Global state, localStorage helpers, UI utilities, API wrappers

**Exports** (global `window` namespace):

```javascript
// LocalStorage management
const THEME_KEY = 'ai-interviewer:theme'
const HISTORY_KEY = 'ai-interviewer:history'
const SESSION_KEY = 'ai-interviewer:session'

// Server API wrappers
async apiRequest(path, method, body)
async getServerStatus()  // GET /api/status
async fetchUserSessions()  // GET /api/me/sessions
async startInterview(config)  // POST /api/interview/start
async submitAnswer(interviewId, answer)  // POST /api/interview/:id/answer
async finalizeInterview(interviewId)  // POST /api/interview/:id/finalize

// UI helpers
setConnection(status, message)  // Update connection indicator
showPage(pageName)  // Show/hide sections
setUser(user)  // Update user display
```

**Global state** (in memory):
```javascript
window.currentUser = { id, email, name } | null
window.currentSession = { interviewId, mode, ... } | null
window.serverStatus = { ok, gemini, auth }
```

**API request pattern**:
```javascript
async apiRequest(path, method = 'GET', body = null) {
  const token = Auth.getToken();
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    }
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(__API_BASE__ + path, options);
  if (!res.ok) throw new Error(data.error);
  return res.json();
}
```

### setup.js - Interview Configuration Form

**Purpose**: Handle interview setup form, mode selection, validation

**Key functions**:
```javascript
function initSetupForm()
function getFormConfig(): config
function validateConfig(config): errors | null
function handleModeChange(mode)
function handlePositionChange(position)
function saveFormDraft()
function loadFormDraft()
function handleSubmit(event)
```

**Form auto-save**:
- Saves form state to localStorage every time user changes a field
- On page load, restores previous draft
- "New Session" button clears draft

**Mode switching**:
- Voice mode: Shows audio setup UI, WebSocket info
- Text mode: Shows text input preparation

**Form submission**:
1. Validate all required fields
2. Collect config object
3. Call `startInterview(config)` → `POST /api/interview/start`
4. On success: Redirect to interview.html with session ID
5. On error: Show error message

### interview.js - Interview UI & Text Mode

**Purpose**: Display questions, handle answer submission (text mode), show results

**Key functions**:
```javascript
async function initInterview()
async function loadSession(interviewId)
function displayQuestion(question, number, total)
async function handleAnswerSubmit()
async function handleHint()
function displayFeedback(eval)
function showCompletionPrompt()
async function handleFinalizeClick()
```

**Text interview flow**:
1. Page loads with `?id=<interviewId>` query param
2. Fetch session via `GET /api/interview/:id`
3. If not started: Display question from start response
4. User enters answer, clicks submit
5. Call `POST /api/interview/:id/answer`
6. Display response:
   - If more questions: Show next question
   - If complete: Show completion prompt
7. User clicks "Finalize" → `POST /api/interview/:id/finalize`
8. Redirect to results.html with session ID

**Hint handling**:
- Click "Get hint"
- Call `POST /api/interview/:id/hint`
- Display hint text

**State tracking**:
```javascript
{
  interviewId,
  mode,
  currentQuestion,
  questionNumber,
  totalQuestions,
  sessionStatus  // 'in_progress' or 'completed'
}
```

### audio.js - Audio Recording and Playback

**Purpose**: Capture microphone input, play audio responses (voice mode)

**Key classes/functions**:
```javascript
class AudioRecorder {
  start(): Promise<void>
  stop(): Uint8Array
  on(event, callback)
}

class AudioPlayer {
  play(base64PCM, sampleRate = 24000): Promise<void>
}

function requestMicrophonePermission(): Promise<MediaStream>
```

**Audio recording flow** (voice mode):
1. Request microphone permission
2. Create MediaRecorder with microphone stream
3. Buffer audio in chunks (~4096 bytes)
4. On each chunk: Encode PCM to base64, send via WebSocket
5. On stop: Return final audio buffer

**Audio playback flow**:
1. Receive base64-encoded PCM from server
2. Decode base64 to binary
3. Create AudioBuffer from binary PCM
4. Play via Web Audio API

**Permission handling**:
- If denied: Show error "Microphone permission required"
- If granted: Start recording
- If revoked during session: Show "Microphone disconnected"

### results.js - Results Page Display

**Purpose**: Fetch and display interview evaluation

**Key functions**:
```javascript
async function loadResults(interviewId)
function displayEvaluation(evaluation)
function displayScoreCard(name, score)
function displaySuggestions(suggestions)
function handleNewInterview()
function handleViewTranscript()
```

**Results flow**:
1. Page loads with `?id=<interviewId>` query param
2. Fetch session via `GET /api/interview/:id`
3. Display results from `evaluation` object:
   - Overall score (average of 6 criteria)
   - Individual scores (technical, problem-solving, etc.)
   - Evaluation note
   - Suggestions list
4. Display visual score bars (percentage width)
5. "New interview" redirects to index.html
6. "View transcript" shows full conversation

**Evaluation data structure** (from database):
```javascript
{
  technical: 7.5,
  problemSolving: 7.8,
  communication: 8.0,
  clarity: 8.2,
  confidence: 7.5,
  adaptability: 7.8,
  note: "Strong technical fundamentals...",
  suggestions: ["Study system design...", "Practice..."],
  overall: 7.85
}
```

### charts.js - Score Visualization

**Purpose**: Render score charts and visual feedback

**Key functions**:
```javascript
function drawScoreBar(container, score)
function drawScoreRadar(container, scores)
function drawScoreTimeline(questions)
```

**Visualizations**:
- Score bars (horizontal, percentage-based width)
- Radar chart (hexagon, 6 criteria)
- Timeline (question difficulty vs performance)

### pcm.js - PCM Audio Encoding/Decoding

**Purpose**: Convert between PCM and base64 formats

**Key functions**:
```javascript
function pcmToBase64(pcmBuffer: Uint8Array): string
function base64ToPcm(base64String: string): Uint8Array

function pcmToWav(pcmBuffer: Uint8Array, sampleRate = 16000): Uint8Array
function wavToPcm(wavBuffer: Uint8Array): Uint8Array
```

**PCM format** (from backend):
- 16-bit signed PCM
- Sample rate: 24000 Hz (for voice mode)
- Mono (1 channel)
- Little-endian byte order

**Encoding for transmission**:
- Raw PCM → base64 string
- Reduces size by ~33% vs hex encoding
- Easier to transmit via JSON

**Decoding on receive**:
- base64 string → Uint8Array
- PCM → AudioBuffer (via Web Audio API)
- Play with AudioContext

## State Management

### Local Storage

Persistent data stored in browser localStorage:

| Key | Value | Purpose |
|-----|-------|---------|
| `ai-interviewer:auth` | JWT token | User authentication |
| `ai-interviewer:theme` | 'light' or 'dark' | Theme preference |
| `ai-interviewer:session` | Interview config object | Form draft |
| `ai-interviewer:history` | Interview history array | Recent sessions (local cache) |

**Lifecycle**:
- Auth token: Persists until logout or expiration
- Theme: Persists across sessions
- Session draft: Cleared on form submit or "New Session" click
- History: Can be synced with server on page load

### In-Memory State

Transient data held during page session:

| Variable | Scope | Lifetime |
|----------|-------|----------|
| `window.currentUser` | Global | Until logout |
| `window.currentSession` | Global | Until interview completes |
| `window.serverStatus` | Global | Until refresh/refetch |
| WebSocket connection | Interview page | Until completion |
| MediaRecorder | Interview page | Until stop/page unload |

### Page Navigation

Single-page navigation (no full page reloads):

- `index.html` (setup) → Start interview → `interview.html` (conduct)
- `interview.html` → Complete → Redirect to `results.html`
- `results.html` → New interview → Redirect to `index.html`
- Auth required: All pages except login/register
- If not authenticated: Redirects to `login.html`

## Styling & Theming

### CSS Architecture

**Location**: `frontend/public/css/style.css`

**Design system**:
```css
/* Color variables */
--bg-primary: #07090d  (dark mode)
--bg-secondary: #f6f7fb (light mode)
--text-primary: #ffffff
--text-muted: #8a8b8f

/* Typography */
font-family: Inter, Sora
--font-lg, --font-base, --font-sm, --font-xs

/* Spacing */
--spacing-xs: 0.25rem
--spacing-sm: 0.5rem
--spacing-md: 1rem
--spacing-lg: 2rem
--spacing-xl: 4rem

/* Components */
.btn (primary, secondary, ghost)
.input, .textarea, .select
.card, .panel
.hidden, .visually-hidden (accessibility)
```

### Theme Toggle

Light/dark mode switching:
```javascript
// User clicks theme toggle button
// Toggles <html data-theme="dark|light">
// CSS uses :root[data-theme="dark"] selectors
// Preference saved to localStorage
```

**Accessibility**:
- Respects `prefers-color-scheme` media query on first visit
- Remembers user choice in localStorage
- Smooth transitions between themes

## Accessibility

**Features**:
- Semantic HTML (`<button>`, `<form>`, `<label>`)
- ARIA labels and descriptions
- Keyboard navigation (Tab, Enter, Escape)
- Focus indicators visible
- Skip link (top of page)
- Color contrast meets WCAG AA
- Dark mode support

**Examples** (from code):
```html
<div class="mode-picker" role="radiogroup" aria-label="Interview mode">
  <button role="radio" aria-checked="true">Voice</button>
</div>
<form aria-label="Interview setup">
  <label for="email">Email</label>
  <input id="email" required aria-required="true" />
</form>
```

## API Integration

### Base URL Configuration

Frontend detects backend URL:
```javascript
// From window.__API_BASE__ (set in vite.config.js)
// or environment variable VITE_API_URL
// Defaults to same origin if not set

const apiBase = typeof __API_BASE__ !== 'undefined' 
  ? __API_BASE__ 
  : '/api'
```

**Development**: Vite proxy (see vite.config.js)

**Production**: Same domain or configured backend URL

### API Request Pattern

All requests include JWT token:
```javascript
async function apiRequest(path, method = 'GET', body = null) {
  const token = Auth.getToken();
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    },
    body: body ? JSON.stringify(body) : null
  });
  
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
```

## WebSocket Communication (Voice Mode)

**Connection**:
```javascript
const token = Auth.getToken();
const ws = new WebSocket(`ws://localhost:3000/live/${interviewId}?token=${token}`);
```

**Message types** (see [WEBSOCKET.md](./WEBSOCKET.md)):
- Client sends: `{ type: 'audio', data: base64PCM, sampleRate: 24000 }`
- Server sends: `{ type: 'audio', data: ..., mimeType: '...' }`
- Server sends: `{ type: 'modelText', text: '...', final: true }`
- Server sends: `{ type: 'candidateText', text: '...', final: true }`
- Server sends: `{ type: 'complete', questionCount: 5 }`

**Error handling**:
```javascript
ws.addEventListener('error', (event) => {
  console.error('WebSocket error');
  fallbackToTextMode();
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'error') {
    displayError(msg.message);
  }
});
```

## Development

### Running Locally

```bash
npm run dev:frontend
```

Starts Vite dev server on `http://localhost:5173` with HMR (hot module replacement).

### Building for Production

```bash
npm run build
```

Outputs optimized build to `frontend/public/dist/`.

### Debugging

Browser DevTools:
- **Console**: JS errors, logs from modules
- **Network**: API requests and WebSocket frames
- **Application**: LocalStorage inspection
- **Elements**: DOM inspection and CSS debugging

## Performance Considerations

### Bundle Size

- No framework (Vue, React) overhead
- Vanilla JavaScript modules
- CSS-in-JS styles (not separate stylesheet)
- Typical bundle: ~100-150 KB (gzipped)

### Load Time

- Critical path: HTML → auth.js → common.js
- Setup form renders immediately (no data fetch needed)
- Session history fetched asynchronously
- Server status checked in background

### Memory Usage

- WebSocket connection: ~1-2 MB (streaming audio)
- Interview session state: ~100-200 KB
- Typical total: <50 MB during interview

---

**See also**:
- [API.md](./API.md) - Backend endpoints called from frontend
- [WEBSOCKET.md](./WEBSOCKET.md) - Real-time communication protocol
- [SETUP.md](./SETUP.md#frontend-environment-variables) - Frontend environment setup
