# API Reference

Complete documentation of all HTTP REST API endpoints. For real-time voice communication, see [WEBSOCKET.md](./WEBSOCKET.md).

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: `https://api.example.com` (or your configured `BACKEND_URL`)

## Authentication

All protected endpoints require a **JWT Bearer Token** in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

Tokens are issued by the `/api/auth/login` and `/api/auth/verify-otp` endpoints after successful authentication. Store the token in browser localStorage and include it with every authenticated request.

**Example request**:
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  http://localhost:3000/api/interview/start
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error description message"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| 400 | Bad Request - Invalid input or validation failed |
| 401 | Unauthorized - Invalid or missing JWT token |
| 403 | Forbidden - Not allowed (email not verified, etc.) |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Invalid state transition (e.g., interview already complete) |
| 429 | Too Many Requests - Rate limit exceeded |
| 502 | Bad Gateway - Gemini API unavailable |
| 503 | Service Unavailable - MongoDB not configured (auth endpoints only) |
| 500 | Internal Server Error - Server-side error |

## Rate Limiting

Rate limits are applied per IP address. When exceeded, responses include rate limit headers:

```
RateLimit-Limit: 100
RateLimit-Remaining: 45
RateLimit-Reset: 1694510400
```

See [SETUP.md - Rate Limiting](./SETUP.md#rate-limiting) for limits by endpoint.

---

# Authentication Endpoints

All authentication endpoints are **unauthenticated** (no JWT required) but may be **rate-limited**.

## POST /api/auth/signup

Create a new user account. Sends a verification code (OTP) via email or logs it to console.

**Rate Limit**: Global API limiter (100 req/15 min per IP)

**Request Body**:
```json
{
  "name": "string (1-80 characters)",
  "email": "string (valid email)",
  "password": "string (minimum 8 characters)"
}
```

**Response (Success - 200)**:
```json
{
  "needsVerification": true,
  "email": "user@example.com",
  "devCode": "123456"
}
```

**Response (Already Verified - 200)**:
If email already verified, auto-login:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

**Error Responses**:
- `400` - Missing fields, email invalid, or password too short
- `409` - Email already registered
- `503` - MongoDB not configured

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@example.com",
    "password": "SecurePassword123"
  }'
```

**Notes**:
- Password minimum length: 8 characters
- Name maximum length: 80 characters
- Verification code expires in 10 minutes
- `devCode` in response is for development testing (shows OTP sent)
- If EmailJS not configured, code is logged to backend console

---

## POST /api/auth/verify-otp

Verify the OTP sent via email during signup or login.

**Rate Limit**: 10 attempts per 15 minutes per IP

**Request Body**:
```json
{
  "email": "string (email address)",
  "code": "string (6-digit OTP)"
}
```

**Response (Success - 200)**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "Jane Smith"
  }
}
```

**Error Responses**:
- `400` - Missing email/code or code invalid/expired
- `404` - User not found
- `500` - Server error
- `503` - MongoDB not configured

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "code": "123456"
  }'
```

---

## POST /api/auth/resend-otp

Resend verification OTP to user's email.

**Rate Limit**: 5 attempts per 15 minutes per IP

**Request Body**:
```json
{
  "email": "string (email address)"
}
```

**Response (Success - 200)**:
```json
{
  "success": true,
  "message": "New verification code sent.",
  "devCode": "654321"
}
```

**Error Responses**:
- `400` - Email missing or already verified
- `404` - User not found
- `503` - MongoDB not configured

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/auth/resend-otp \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com"
  }'
```

---

## POST /api/auth/login

Sign in with email and password.

**Rate Limit**: Global API limiter (100 req/15 min per IP)

**Request Body**:
```json
{
  "email": "string (email address)",
  "password": "string (password)"
}
```

**Response (Success - 200)**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jane@example.com",
    "name": "Jane Smith"
  }
}
```

**Response (Email Not Verified - 403)**:
```json
{
  "error": "Please verify your email address to continue.",
  "needsVerification": true,
  "email": "jane@example.com",
  "devCode": "123456"
}
```

**Error Responses**:
- `400` - Missing email or password
- `401` - Incorrect email or password
- `403` - Email not verified (see above)
- `503` - MongoDB not configured

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "password": "SecurePassword123"
  }'
```

---

## POST /api/auth/forgot-password

Request a password reset code via email.

**Rate Limit**: 5 attempts per 15 minutes per IP

**Request Body**:
```json
{
  "email": "string (email address)"
}
```

**Response (Success - 200)**:
```json
{
  "success": true,
  "message": "If an account exists for that email, a reset code has been sent.",
  "devCode": "789456"
}
```

**Notes**:
- Always returns the same success response (doesn't reveal if account exists)
- Reset code expires in 10 minutes
- `devCode` in response is for development testing

**Error Responses**:
- `400` - Email missing or invalid
- `503` - MongoDB not configured

---

## POST /api/auth/verify-reset-otp

Verify the password reset OTP. Must be called before `/api/auth/reset-password`.

**Rate Limit**: 10 attempts per 15 minutes per IP

**Request Body**:
```json
{
  "email": "string (email address)",
  "code": "string (6-digit OTP)"
}
```

**Response (Success - 200)**:
```json
{
  "success": true,
  "message": "Code verified. You may now set a new password."
}
```

**Error Responses**:
- `400` - Missing email/code, invalid code, or expired code
- `503` - MongoDB not configured

---

## POST /api/auth/reset-password

Set a new password after verifying the reset code.

**Rate Limit**: 10 attempts per 15 minutes per IP

**Request Body**:
```json
{
  "email": "string (email address)",
  "password": "string (new password, minimum 8 chars)"
}
```

**Response (Success - 200)**:
```json
{
  "success": true,
  "message": "Password updated. You can now sign in."
}
```

**Error Responses**:
- `400` - Email missing or password too short
- `403` - Reset code not verified (must call `/verify-reset-otp` first)
- `503` - MongoDB not configured

---

## GET /api/auth/me

Get current authenticated user's information. Does not require authentication (returns `authenticated: false` if not logged in).

**Authentication**: Optional

**Response (Authenticated - 200)**:
```json
{
  "authenticated": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "jane@example.com",
    "name": "Jane Smith"
  }
}
```

**Response (Not Authenticated - 200)**:
```json
{
  "authenticated": false
}
```

**Example Request**:
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  http://localhost:3000/api/auth/me
```

---

# Interview Endpoints

All interview endpoints require **authentication** (JWT token) except where noted.

## POST /api/interview/start

Create a new interview session. For voice mode, use `/live/:interviewId` WebSocket after this.

**Authentication**: Required

**Rate Limit**: 20 per hour per IP

**Request Body**:
```json
{
  "mode": "text | voice",
  "position": "string (job position, e.g., 'Software Engineer')",
  "customPosition": "string (optional, custom position if provided)",
  "interviewType": "behavioral | technical | mixed",
  "difficulty": "beginner | intermediate | advanced",
  "questionCount": "number (1-10, default 5)"
}
```

**Response (Text Mode - 200)**:
```json
{
  "interviewId": "interview-uuid-123",
  "mode": "text",
  "opening": "Hello! Thank you for taking the time to interview with us today. I'm looking forward to learning more about your experience and skills.",
  "question": "Tell me about your most recent project. What was your role, and what were the main challenges you faced?",
  "questionNumber": 1,
  "questionCount": 5,
  "summary": {
    "position": "Software Engineer",
    "mode": "text",
    "difficulty": "intermediate",
    "questionCount": 5,
    "currentQuestion": 1,
    "status": "in_progress"
  }
}
```

**Response (Voice Mode - 200)**:
```json
{
  "interviewId": "interview-uuid-456",
  "mode": "voice",
  "questionCount": 5,
  "summary": {
    "position": "Software Engineer",
    "mode": "voice",
    "difficulty": "intermediate",
    "questionCount": 5,
    "currentQuestion": 0,
    "status": "in_progress"
  }
}
```

**Error Responses**:
- `400` - Invalid config (missing fields, invalid values)
- `401` - Unauthorized (invalid token)
- `502` - Gemini API unavailable

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/interview/start \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "text",
    "position": "Frontend Engineer",
    "interviewType": "technical",
    "difficulty": "intermediate",
    "questionCount": 5
  }'
```

**Notes**:
- `mode: "voice"` requires WebSocket connection to `/live/:interviewId?token=<JWT>`
- `mode: "text"` allows immediate question submission via `/api/interview/:id/answer`
- Returned `opening` is interviewer's greeting
- `questionNumber: 1` in text mode means first question is ready immediately

---

## POST /api/interview/:id/text-start

Explicitly start text interview (alternative to combining start + immediate answer).

**Authentication**: Required

**Rate Limit**: 20 per hour per IP

**URL Parameters**:
- `:id` - Interview ID from `/start` response

**Request Body**: Empty (`{}`)

**Response (Success - 200)**:
```json
{
  "interviewId": "interview-uuid-123",
  "mode": "text",
  "opening": "Hello! Thank you for taking the time to interview with us today...",
  "question": "Tell me about your most recent project...",
  "questionNumber": 1,
  "questionCount": 5,
  "summary": { ... }
}
```

**Error Responses**:
- `404` - Interview not found
- `409` - Interview already started or already complete
- `502` - AI unavailable

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/interview/interview-uuid-123/text-start \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## POST /api/interview/:id/answer

Submit an answer to the current interview question (text mode only).

**Authentication**: Required

**Rate Limit**: 30 per minute per IP

**URL Parameters**:
- `:id` - Interview ID

**Request Body**:
```json
{
  "answer": "string (user's answer to the question)"
}
```

**Response (More Questions - 200)**:
```json
{
  "question": "That's a great approach. Can you walk me through how you handled the technical challenges?",
  "questionNumber": 2,
  "isFollowUp": true,
  "feedback": "Good explanation of the project scope and your role.",
  "eval": {
    "technical": 7.5,
    "clarity": 8,
    "relevance": 8.5
  },
  "summary": {
    "position": "Frontend Engineer",
    "mode": "text",
    "difficulty": "intermediate",
    "questionCount": 5,
    "currentQuestion": 2,
    "status": "in_progress"
  }
}
```

**Response (Interview Complete - 200)**:
```json
{
  "complete": true,
  "feedback": "Excellent comprehensive answer. We have enough information to evaluate your candidacy.",
  "eval": {
    "technical": 7.8,
    "clarity": 8.2,
    "relevance": 8.5,
    "communication": 8,
    "problemSolving": 7.5
  },
  "summary": {
    "position": "Frontend Engineer",
    "mode": "text",
    "difficulty": "intermediate",
    "questionCount": 5,
    "currentQuestion": 5,
    "status": "in_progress"
  }
}
```

**Error Responses**:
- `400` - Invalid answer (missing)
- `404` - Interview not found
- `409` - Interview already complete
- `502` - AI unavailable

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/interview/interview-uuid-123/answer \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "answer": "I led a team of 3 engineers on a React-based dashboard project. The main challenge was optimizing performance with large datasets..."
  }'
```

---

## POST /api/interview/:id/hint

Get a hint for the current question (text mode).

**Authentication**: Required

**Rate Limit**: 30 per minute per IP

**URL Parameters**:
- `:id` - Interview ID

**Request Body**: Empty (`{}`)

**Response (Success - 200)**:
```json
{
  "hint": "Think about how you approached debugging this issue. What tools did you use? What was your thought process?"
}
```

**Error Responses**:
- `404` - Interview not found
- `409` - Interview already complete
- `502` - AI unavailable

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/interview/interview-uuid-123/hint \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## GET /api/interview/:id

Get current interview status and summary. If interview is complete, triggers evaluation.

**Authentication**: Required

**URL Parameters**:
- `:id` - Interview ID

**Response (In Progress - 200)**:
```json
{
  "position": "Frontend Engineer",
  "mode": "text",
  "difficulty": "intermediate",
  "questionCount": 5,
  "currentQuestion": 3,
  "status": "in_progress",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

**Response (Completed - 200)**:
```json
{
  "position": "Frontend Engineer",
  "mode": "text",
  "difficulty": "intermediate",
  "questionCount": 5,
  "currentQuestion": 5,
  "status": "completed",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "completedAt": "2024-01-15T10:45:00.000Z",
  "evaluation": {
    "technical": 7.8,
    "problemSolving": 7.5,
    "communication": 8.2,
    "clarity": 8.0,
    "confidence": 7.5,
    "adaptability": 8.0,
    "note": "Strong technical fundamentals with good communication. Areas to improve: deeper system design thinking.",
    "suggestions": [
      "Study advanced system design patterns",
      "Practice whiteboarding sessions",
      "Work on explaining complex concepts in simpler terms"
    ],
    "overall": 7.85
  }
}
```

**Error Responses**:
- `404` - Interview not found
- `502` - AI unavailable (during evaluation)

**Example Request**:
```bash
curl http://localhost:3000/api/interview/interview-uuid-123 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## POST /api/interview/:id/finalize

Explicitly mark interview as complete and trigger evaluation.

**Authentication**: Required

**URL Parameters**:
- `:id` - Interview ID

**Request Body**: Empty (`{}`)

**Response (Success - 200)**:
```json
{
  "success": true
}
```

**Error Responses**:
- `404` - Interview not found
- `409` - Interview already complete
- `502` - AI unavailable

**Example Request**:
```bash
curl -X POST http://localhost:3000/api/interview/interview-uuid-123/finalize \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Notes**:
- Text interviews auto-complete after all questions answered
- Voice interviews need explicit finalization when user clicks "Finish"
- Triggers Gemini evaluation if not already done
- Saves session to MongoDB (if configured)

---

## GET /api/interview/:id/rating

Get interim rating (before finalization).

**Authentication**: Required

**URL Parameters**:
- `:id` - Interview ID

**Response (Success - 200)**:
```json
{
  "interim": true,
  "overall": 7.8,
  "technical": 7.5,
  "communication": 8.2,
  "problemSolving": 7.6
}
```

**Error Responses**:
- `404` - Interview not found
- `409` - Interview already complete
- `502` - AI unavailable

**Example Request**:
```bash
curl http://localhost:3000/api/interview/interview-uuid-123/rating \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

# Session & History Endpoints

## GET /api/me/sessions

Get list of all past interviews for the authenticated user.

**Authentication**: Required

**Query Parameters** (optional):
- `limit` - Number of sessions to return (default: 20)

**Response (Success - 200)**:
```json
{
  "sessions": [
    {
      "interviewId": "interview-uuid-123",
      "position": "Frontend Engineer",
      "date": "2024-01-15T10:45:00.000Z",
      "status": "completed",
      "score": 7.85
    },
    {
      "interviewId": "interview-uuid-456",
      "position": "Backend Engineer",
      "date": "2024-01-14T14:20:00.000Z",
      "status": "completed",
      "score": 8.2
    },
    {
      "interviewId": "interview-uuid-789",
      "position": "Full Stack Developer",
      "date": "2024-01-13T09:15:00.000Z",
      "status": "in_progress",
      "score": null
    }
  ]
}
```

**Error Responses**:
- `401` - Unauthorized
- `500` - Server error

**Example Request**:
```bash
curl http://localhost:3000/api/me/sessions?limit=10 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Notes**:
- Sessions sorted by date (newest first)
- `score` is null for in-progress interviews
- Custom position shown if applicable

---

## DELETE /api/me/sessions

Clear all interview history for the authenticated user. **This action is irreversible.**

**Authentication**: Required

**Request Body**: Empty (`{}`)

**Response (Success - 200)**:
```json
{
  "cleared": 5
}
```

**Error Responses**:
- `401` - Unauthorized
- `500` - Server error

**Example Request**:
```bash
curl -X DELETE http://localhost:3000/api/me/sessions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Caution**: Permanently deletes all associated sessions and cannot be undone.

---

# System Endpoints

## GET /api/status

Get system status and feature availability.

**Authentication**: Not required

**Response (Success - 200)**:
```json
{
  "ok": true,
  "gemini": {
    "configured": true,
    "model": "gemini-3.6-flash",
    "liveModel": "gemini-2.5-flash-native-audio-latest",
    "voiceAvailable": true
  },
  "auth": {
    "configured": true
  }
}
```

**Response (Degraded - 200)**:
```json
{
  "ok": true,
  "gemini": {
    "configured": false,
    "model": null,
    "liveModel": null,
    "voiceAvailable": false
  },
  "auth": {
    "configured": false
  }
}
```

**Example Request**:
```bash
curl http://localhost:3000/api/status
```

**Notes**:
- Always returns 200 even if services unavailable
- Use this to detect which features are enabled
- `voiceAvailable: true` means voice interviews are available
- `auth.configured: false` means authentication is disabled (all users anonymous)

---

## GET /api/health

Simple health check endpoint.

**Authentication**: Not required

**Response (Success - 200)**:
```json
{
  "ok": true
}
```

**Example Request**:
```bash
curl http://localhost:3000/api/health
```

---

# Common Patterns

## Using Tokens in Requests

After login/signup, store the JWT token:

```javascript
// After POST /api/auth/login
const response = await fetch('http://localhost:3000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'user@example.com', password: 'password' })
});
const data = await response.json();
localStorage.setItem('token', data.token);
```

Use token in authenticated requests:

```javascript
const token = localStorage.getItem('token');
const response = await fetch('http://localhost:3000/api/interview/start', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ mode: 'text', position: 'Engineer', ... })
});
```

## Interview Lifecycle Example

### Text Mode
1. `POST /api/interview/start` (mode: 'text') → Get session ID & first question
2. `POST /api/interview/:id/answer` → Submit answer, get next question or completion
3. Repeat step 2 until all questions answered
4. `POST /api/interview/:id/finalize` → Trigger evaluation
5. `GET /api/interview/:id` → Get results with evaluation scores

### Voice Mode
1. `POST /api/interview/start` (mode: 'voice') → Get session ID
2. Establish WebSocket connection to `/live/:id?token=<JWT>`
3. Send/receive audio frames via WebSocket
4. WebSocket sends `complete` when interview finished
5. `GET /api/interview/:id` → Get results with evaluation scores

## Handling Errors

```javascript
async function apiCall(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API request failed');
  }

  return response.json();
}
```

---

# Testing Endpoints

### With curl

```bash
# Create interview
curl -X POST http://localhost:3000/api/interview/start \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"text","position":"Engineer","interviewType":"technical","difficulty":"intermediate","questionCount":3}'
```

### With Postman

1. Set `Authorization` header: Type = "Bearer Token", Value = your JWT
2. Set `Content-Type`: application/json
3. Use POST method for endpoints that require it
4. Paste request body as JSON

### With JavaScript (fetch API)

```javascript
const token = 'your-jwt-token';
const response = await fetch('http://localhost:3000/api/interview/start', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    mode: 'text',
    position: 'Software Engineer',
    interviewType: 'technical',
    difficulty: 'intermediate',
    questionCount: 5
  })
});
const data = await response.json();
console.log(data);
```

---

# Rate Limit Headers

All responses include rate limit information:

```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1705329600
```

- `RateLimit-Limit`: Maximum requests in current window
- `RateLimit-Remaining`: Requests remaining before limit
- `RateLimit-Reset`: Unix timestamp when limit resets
