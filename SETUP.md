# Setup Guide

This guide walks you through setting up the AI Interviewer for local development or deployment.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** - Download from https://nodejs.org/
  - Verify: `node --version` (should show v18 or higher)
  - npm is included with Node.js
  
- **MongoDB** (optional but recommended for persistence)
  - Local: Download from https://www.mongodb.com/try/download/community
  - Or: Create a free cluster at https://www.mongodb.com/cloud/atlas
  
- **Google Gemini API Key** (required for AI functionality)
  - Free tier available at https://aistudio.google.com/
  - Sign in with your Google account
  - Create an API key
  
- **Git** (optional, for cloning the repository)

## Installation Steps

### 1. Clone the Repository

```bash
git clone <repository-url>
cd "Ai Interviewer"
```

Or download and extract the ZIP file.

### 2. Install Dependencies

Install dependencies for the root, backend, and frontend:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

This installs:
- Root: `concurrently` (for running both servers), `ws` (WebSocket library)
- Backend: Express, Mongoose, Gemini SDK, security libraries
- Frontend: Vite (build tool only)

### 3. Configure Environment Variables

The backend requires a `.env` file with configuration. Create it from the example:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and configure the variables below. Start with the **required** variables, then optionally configure others.

#### Backend Environment Variables

**Required Variables** (app won't work without these):

| Variable | Example Value | Description |
|----------|---------------|-------------|
| `GEMINI_API_KEY` | `AIzaSy...` | Your Google Gemini API key from https://aistudio.google.com/ |
| `JWT_SECRET` | `my-super-secret-key-12345` | Long random string for signing JWT tokens. Generate one with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Optional Variables** (have sensible defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | None | MongoDB connection string. Without this, user accounts and history are disabled. See [Database Setup](#database-setup) below. |
| `PORT` | `3000` | Backend server port |
| `WEB_URL` | `http://localhost:5173` | Frontend origin for CORS. Must match your frontend URL. |
| `BACKEND_URL` | `http://localhost:3000` | Backend public URL for redirects/logs |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Model for text questions and evaluation |
| `GEMINI_LIVE_MODEL` | (none) | Model for real-time voice interviews. Example: `gemini-2.5-flash-native-audio-latest` |
| `GEMINI_LIVE_SILENCE_MS` | `5000` | Milliseconds of silence before committing end-of-speech |
| `GEMINI_LIVE_END_SENSITIVITY` | `low` | End-of-speech detection: `low` (tolerant of pauses) or `high` |
| `EMAILJS_SERVICE_ID` | (empty) | EmailJS service ID for email verification. Leave empty to log codes to console. |
| `EMAILJS_TEMPLATE_ID` | (empty) | EmailJS template ID |
| `EMAILJS_PUBLIC_KEY` | (empty) | EmailJS public key (safe to expose in frontend) |
| `EMAILJS_PRIVATE_KEY` | (empty) | EmailJS private key (backend-only secret) |

**Example `.env` for local development:**

```bash
# Gemini API
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
GEMINI_LIVE_SILENCE_MS=5000
GEMINI_LIVE_END_SENSITIVITY=low

# Server
PORT=3000
WEB_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000

# MongoDB (optional)
MONGO_URI=mongodb://127.0.0.1:27017/ai-interviewer

# JWT
JWT_SECRET=super-secret-jwt-key-change-this-to-random-string

# Email (optional, leave empty for development)
EMAILJS_SERVICE_ID=
EMAILJS_TEMPLATE_ID=
EMAILJS_PUBLIC_KEY=
EMAILJS_PRIVATE_KEY=
```

**Example `.env` for MongoDB Atlas:**

```bash
MONGO_URI=mongodb+srv://username:password@cluster-name.mongodb.net/ai-interviewer?retryWrites=true&w=majority
```

### 4. Database Setup (Optional but Recommended)

Without MongoDB, the app works but user accounts and interview history are disabled.

#### Option A: Local MongoDB

**On Windows:**

1. Download MongoDB Community Server from https://www.mongodb.com/try/download/community
2. Run the installer and follow prompts
3. MongoDB will start as a service
4. Verify it's running:
   ```bash
   mongosh  # or `mongo` for older versions
   ```
   You should see a `>` prompt. Type `exit` to quit.

5. Set `MONGO_URI` in `.env`:
   ```
   MONGO_URI=mongodb://127.0.0.1:27017/ai-interviewer
   ```

**On Mac:**

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
mongosh  # verify connection
```

**On Linux:**

Follow instructions at https://docs.mongodb.com/manual/installation/

#### Option B: MongoDB Atlas (Cloud)

1. Go to https://www.mongodb.com/cloud/atlas
2. Sign up for a free account
3. Create a new project
4. Build a cluster (free tier available)
5. Create a database user with a password
6. Get the connection string (shown in "Connect" dialog)
7. The string looks like:
   ```
   mongodb+srv://username:password@cluster0.abcde.mongodb.net/ai-interviewer?retryWrites=true&w=majority
   ```
8. Set `MONGO_URI` in `.env`:
   ```
   MONGO_URI=mongodb+srv://username:password@cluster0.abcde.mongodb.net/ai-interviewer?retryWrites=true&w=majority
   ```

#### Seeding Questions (Optional)

Populate the database with sample questions:

```bash
npm run seed
```

This runs `scripts/seed-questions.js`, which creates questions for various positions, difficulties, and interview types. Without seeding, questions are generated on-the-fly by Gemini.

### 5. Start the Application

#### Development Mode (Recommended)

From the root directory, start both backend and frontend with hot-reload:

```bash
npm run dev
```

This starts:
- **Backend** on `http://localhost:3000` (Node.js with `--watch` for auto-reload)
- **Frontend** on `http://localhost:5173` (Vite with HMR)

Output:
```
> concurrently -k -n backend,frontend ...
[backend] AI Interviewer running at http://localhost:3000
[frontend] VITE v5.4.0  ready in 123 ms
[frontend] ➜  local:   http://localhost:5173/
```

#### Backend Only

```bash
npm run dev:backend
```

Runs on `http://localhost:3000`. Frontend dev server not started.

#### Frontend Only

```bash
npm run dev:frontend
```

Runs on `http://localhost:5173`. Backend dev server not started.

#### Production Mode

Build frontend:
```bash
npm run build
```

Start backend:
```bash
npm start
```

Frontend static files are served from `backend/public` (symlinked or copied from `frontend/public/dist`).

### 6. Verify Installation

#### Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{ "ok": true }
```

#### System Status

```bash
curl http://localhost:3000/api/status
```

Expected response:
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

#### Frontend Access

Open your browser to: **http://localhost:5173**

You should see the home page with login/register options.

## Configuration Details

### Gemini API Models

The project uses two different Gemini models:

**1. Text Model** (`GEMINI_MODEL`, default: `gemini-3.6-flash`)
- Used for generating interview questions
- Used for evaluating text-based answers
- Specified in API calls explicitly

**2. Live Audio Model** (`GEMINI_LIVE_MODEL`, no default)
- Used for real-time voice interviews
- Must support native audio input/output
- Example: `gemini-2.5-flash-native-audio-latest`
- Requires: WebSocket connection, PCM audio streaming
- If not set, voice interviews are disabled

To enable voice interviews, set `GEMINI_LIVE_MODEL` to a model that supports native audio:

```bash
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
```

### Voice Interview Settings

**Silence Detection** (`GEMINI_LIVE_SILENCE_MS`, default: `5000`)
- Time in milliseconds of silence before end-of-speech is detected
- Lower value = faster detection but may cut off pauses
- Higher value = more tolerant of natural pauses
- Typical range: 3000-7000 ms

**End-of-Speech Sensitivity** (`GEMINI_LIVE_END_SENSITIVITY`)
- `low` (default) - Tolerant of pauses, good for natural speech
- `high` - Aggressive detection, may cut off hesitations
- Maps to `END_SENSITIVITY_LOW` or `END_SENSITIVITY_HIGH` in Gemini API

Example for aggressive voice detection:
```bash
GEMINI_LIVE_SILENCE_MS=3000
GEMINI_LIVE_END_SENSITIVITY=high
```

### CORS Configuration

The backend allows requests only from the frontend origin specified in `WEB_URL`:

```bash
WEB_URL=http://localhost:5173  # Frontend origin
```

In production, update this to your actual frontend domain:

```bash
WEB_URL=https://interview.example.com
```

Requests from other origins will be rejected with a CORS error.

### Rate Limiting

The backend enforces rate limits to prevent abuse:

| Endpoint/Type | Limit | Window | HTTP Status |
|---------------|-------|--------|------------|
| Global API | 100 requests | 15 minutes per IP | 429 |
| Interview creation | 20 sessions | 1 hour per IP | 429 |
| Answer submission | 30 requests | 1 minute per IP | 429 |
| Email verification | 10 attempts | 15 minutes per IP | 429 |
| OTP resend | 5 attempts | 15 minutes per IP | 429 |

Rate limits are per IP address. For local development, this usually isn't a concern.

### Bot Detection

The backend blocks requests from automated tools and scrapers. If you're testing with tools, you may see:

```
403 Forbidden: Access denied: automated requests are prohibited.
```

Blocked user-agents include: python, curl, wget, scrapy, postman, headless, phantomjs, selenium, puppeteer, beautifulsoup.

To test the API locally, use a tool that doesn't appear like automation (e.g., browser Dev Tools, Postman with a real user-agent, or a custom Node.js script).

## EmailJS Setup (Optional)

EmailJS is used for sending email verification codes and password reset codes. Without it, codes are logged to the console during development.

### Setup Steps

1. Go to https://www.emailjs.com/
2. Sign up for a free account
3. Add an email service:
   - Choose your email provider (Gmail, Outlook, etc.)
   - Follow authentication steps
4. Create an email template:
   - Use template variables: `verification_code`, `reset_code`, `user_email`, `to_email`
   - Example template:
     ```
     Your verification code is: {{verification_code}}
     ```
5. Get your credentials from EmailJS dashboard:
   - Service ID
   - Template ID
   - Public Key
   - Private Key (for backend, keep secret!)
6. Add to `backend/.env`:
   ```bash
   EMAILJS_SERVICE_ID=service_xxxxx
   EMAILJS_TEMPLATE_ID=template_xxxxx
   EMAILJS_PUBLIC_KEY=xxxxx
   EMAILJS_PRIVATE_KEY=xxxxx
   ```

### Development Mode (Without EmailJS)

Leave EmailJS variables empty in `.env`:

```bash
EMAILJS_SERVICE_ID=
EMAILJS_TEMPLATE_ID=
EMAILJS_PUBLIC_KEY=
EMAILJS_PRIVATE_KEY=
```

Verification codes and reset codes will be logged to the backend console:

```
[AUTH] OTP for user@example.com: 123456 (expires in 10 minutes)
[AUTH] Reset code for user@example.com: 654321 (expires in 10 minutes)
```

The frontend will also show `devCode` in signup/login responses for testing.

## Troubleshooting

### Node.js Version Issues

**Error**: `npm ERR! The engine "node" is incompatible`

**Solution**: Upgrade Node.js to version 18+
```bash
node --version  # Check current version
# Visit https://nodejs.org/ and download 18 LTS or higher
```

### MongoDB Connection Fails

**Error**: `MongoDB connection failed: connect ECONNREFUSED 127.0.0.1:27017`

**Solutions**:
1. Check MongoDB is running:
   - Windows: MongoDB should run as a service
   - Mac: `brew services start mongodb-community`
   - Linux: `sudo systemctl start mongod`
2. Verify connection string in `.env`:
   - Local: `mongodb://127.0.0.1:27017/ai-interviewer`
   - Atlas: Check your cluster connection string
3. Test connection:
   ```bash
   mongosh "mongodb://127.0.0.1:27017/ai-interviewer"
   ```

**Without MongoDB**: Leave `MONGO_URI` empty. The app will warn but continue. User accounts and history won't work.

### Gemini API Key Issues

**Error**: `FATAL: GEMINI_API_KEY is not set`

**Solution**:
1. Go to https://aistudio.google.com/
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key
5. Add to `backend/.env`:
   ```bash
   GEMINI_API_KEY=AIzaSyA1B2C3D4E5F...
   ```

**Error**: `401 Unauthorized` when making API calls

**Solutions**:
1. Verify the API key is correct (no extra spaces)
2. Check the key hasn't expired or been revoked
3. Ensure Gemini API is enabled in your Google Cloud project
4. Wait a few seconds after creating the key (may take time to propagate)

### Port Already in Use

**Error**: `EADDRINUSE: address already in use :::3000`

**Solutions**:
1. Kill the process on port 3000:
   - Windows: `netstat -ano | findstr :3000` then `taskkill /PID <PID> /F`
   - Mac/Linux: `lsof -i :3000` then `kill -9 <PID>`
2. Or change the port in `.env`:
   ```bash
   PORT=3001
   ```

### CORS Errors

**Error**: `Access to XMLHttpRequest blocked by CORS policy`

**Solution**: Verify `WEB_URL` in `backend/.env` matches your frontend URL:
- Development: `WEB_URL=http://localhost:5173`
- Production: `WEB_URL=https://yourdomain.com`

### Microphone Not Working (Voice Mode)

**Error**: `NotAllowedError: Permission denied` or no audio captured

**Solutions**:
1. Grant microphone permission in browser:
   - Check your browser's permission settings for localhost:5173
   - Revoke and re-grant permission
2. Use HTTPS (required in production):
   - Some browsers require HTTPS for microphone access
3. Check `GEMINI_LIVE_MODEL` is configured:
   ```bash
   GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
   ```
4. Verify WebSocket connection:
   - Open browser Dev Tools → Network → WS filter
   - Look for `/live/...` connection
   - If not present, check backend logs

### WebSocket Connection Fails

**Error**: `WebSocket is closed before the connection is established` or connection timeout

**Solutions**:
1. Verify backend is running on the configured port
2. Check firewall isn't blocking WebSocket connections
3. Verify JWT token is valid:
   - Should be included in query string: `/live/:interviewId?token=<JWT>`
4. Check backend logs for errors

### Authentication Not Working

**Error**: `"Accounts are unavailable until MongoDB is configured"` or `403 Forbidden`

**Solutions**:
1. For user accounts, MongoDB must be configured:
   ```bash
   MONGO_URI=mongodb://127.0.0.1:27017/ai-interviewer
   ```
2. Verify `JWT_SECRET` is set:
   ```bash
   JWT_SECRET=your-secret-key
   ```
3. Check MongoDB is running and accessible
4. Check browser console for auth errors

## Production Deployment

### Environment Configuration

For production deployment, update `.env` with production values:

```bash
# Production Gemini
GEMINI_API_KEY=AIzaSy...  # Your production API key
GEMINI_MODEL=gemini-3.6-flash
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest

# Production Server
PORT=3000
WEB_URL=https://interview.example.com
BACKEND_URL=https://api.example.com

# Production MongoDB
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/ai-interviewer

# Production JWT
JWT_SECRET=<long-random-secret-from-secure-generation>

# Production Email
EMAILJS_SERVICE_ID=service_xxx
EMAILJS_TEMPLATE_ID=template_xxx
EMAILJS_PUBLIC_KEY=pub_xxx
EMAILJS_PRIVATE_KEY=priv_xxx
```

### Building for Production

1. Build frontend:
   ```bash
   npm run build
   ```
   Creates optimized build in `frontend/public/dist/`

2. Ensure backend can serve frontend:
   - Copy frontend build to `backend/public` or symlink
   - Backend serves static files from `backend/public`

3. Start backend:
   ```bash
   npm start --prefix backend
   ```

### Running Behind a Reverse Proxy

If using nginx or Apache as a reverse proxy:

**nginx.conf example**:
```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Key settings for WebSocket support:
- `proxy_http_version 1.1`
- `Upgrade` and `Connection` headers
- Trust `X-Forwarded-*` headers

### SSL/TLS (HTTPS)

In production, always use HTTPS. Options:

1. **Let's Encrypt (free)**:
   ```bash
   sudo apt-get install certbot
   certbot certonly --standalone -d api.example.com
   ```

2. **Reverse proxy with SSL**:
   - Set up nginx or Apache with SSL
   - Proxy to backend on localhost:3000

3. **Cloud provider**:
   - AWS: Use ACM + CloudFront/ALB
   - Google Cloud: Use Cloud Armor + Cloud Load Balancing
   - Azure: Use Application Gateway with SSL

## Getting Help

If you encounter issues:

1. **Check logs**: Backend logs to console with `[TAG]` prefixes
2. **Verify environment**: `curl http://localhost:3000/api/status`
3. **Test endpoints**: Use curl or Postman to test API directly
4. **Review docs**: See ARCHITECTURE.md for system overview, API.md for endpoints
5. **Check source code**: Relevant files are indicated in documentation with `file:line` references
