# AI Interviewer

A web-based AI voice and text interviewer powered by Google's Gemini API. Conduct realistic technical and behavioral interviews with real-time evaluation and feedback.

## Overview

AI Interviewer provides two modes of conducting interviews:

- **Text Mode**: Traditional question-and-answer format with request-response evaluation
- **Voice Mode**: Real-time voice conversation with live audio streaming via WebSocket

The system generates interview questions based on position, difficulty level, and interview type (behavioral, technical, or mixed), evaluates responses using Gemini, and provides detailed scoring and feedback.

## Features

- **Dual Interview Modes**: Text (REST API) and voice (WebSocket real-time streaming)
- **Customizable Interview Configuration**: Position, interview type, difficulty, question count
- **Real-time Evaluation**: Scoring on technical skills, communication, problem-solving, adaptability, and more
- **Interview History**: Save and review past interviews (requires MongoDB and user account)
- **User Accounts**: Email-based registration with verification and password reset
- **Question Caching**: Efficient question retrieval and reuse across interviews
- **Security**: Rate limiting, CORS protection, helmet security headers, JWT authentication, bot detection

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Runtime** | Node.js | 18+ |
| **Backend** | Express | 5.2.1 |
| **Database** | MongoDB (optional) | Mongoose 9.9.5 |
| **AI/LLM** | Google Gemini API | @google/genai 2.19.0 |
| **Frontend Build** | Vite | 5.4.0 |
| **Real-time** | WebSockets | ws 8.21.3 |
| **Security** | Helmet, bcryptjs, JWT | Various |
| **Email** | EmailJS (optional) | For verification codes |

## Quick Start

### Prerequisites

- **Node.js** 18 or higher
- **npm** (comes with Node.js)
- **MongoDB** (local or MongoDB Atlas account)
- **Google Gemini API Key** (free tier available at https://aistudio.google.com)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd "Ai Interviewer"
   ```

2. **Install dependencies**
   ```bash
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```

3. **Configure environment variables**
   
   Create `backend/.env` based on `backend/.env.example`:
   ```bash
   cp backend/.env.example backend/.env
   ```
   
   Edit `backend/.env` and set the required variables:
   - `GEMINI_API_KEY` - Your Gemini API key (required)
   - `MONGO_URI` - MongoDB connection string (optional, app works without)
   - `JWT_SECRET` - A long random string for token signing (required for auth)
   - Other variables have sensible defaults

4. **Start the application**
   ```bash
   npm run dev
   ```
   
   This starts both backend (port 3000) and frontend (port 5173) concurrently.

5. **Access the application**
   
   Open your browser to: `http://localhost:5173`

## Project Structure

```
Ai Interviewer/
├── backend/                 # Express REST API + WebSocket server
│   ├── routes/             # API endpoints (auth, interview)
│   ├── models/             # MongoDB schemas (User, Session, Question)
│   ├── auth/               # Authentication middleware and logic
│   ├── interview/          # Interview session and evaluation logic
│   ├── live/               # WebSocket server for voice interviews
│   ├── gemini/             # Gemini API client
│   ├── cache/              # Question caching
│   ├── config.js           # Configuration management
│   ├── db.js               # MongoDB connection
│   ├── index.js            # Express app entry point
│   └── package.json
│
├── frontend/               # Vite-built frontend application
│   ├── public/             # Static assets and HTML pages
│   │   ├── js/            # JavaScript modules (auth, interview, audio, etc.)
│   │   ├── css/           # Stylesheets
│   │   ├── images/        # Static images
│   │   ├── worklets/      # Web Audio worklets
│   │   ├── index.html     # Home page
│   │   ├── login.html     # Login page
│   │   ├── register.html  # Registration page
│   │   ├── interview.html # Interview interface
│   │   └── results.html   # Results display
│   ├── vite.config.js
│   └── package.json
│
├── scripts/                # Utility scripts
│   ├── seed-questions.js  # Populate question database
│   └── test-cli-flow.js   # CLI testing utility
│
└── package.json            # Root workspace
```

## Available Commands

### Root-level
- `npm run dev` - Start both backend and frontend concurrently
- `npm run dev:backend` - Start backend only
- `npm run dev:frontend` - Start frontend only
- `npm start` - Start backend in production mode
- `npm run build` - Build frontend for production
- `npm run seed` - Populate database with sample questions

### Backend (in `backend/` directory)
- `npm start` - Start server
- `npm run dev` - Start with auto-reload on file changes

### Frontend (in `frontend/` directory)
- `npm run dev` - Start Vite dev server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Key Concepts

### Interview Modes

**Text Mode**: Users receive questions one at a time via HTTP requests and submit answers. The backend evaluates each answer and generates follow-up questions if needed.

**Voice Mode**: Users connect via WebSocket and conduct a real-time conversation. Audio is streamed to Gemini for live transcription and evaluation, with responses streamed back as audio.

### Session Management

Each interview creates a session with:
- Configuration (position, difficulty, question count, interview type)
- Array of questions asked
- Array of answers submitted with evaluation data
- Final overall evaluation score
- Transcript of the conversation

Sessions are stored in MongoDB if configured, otherwise held in memory.

### Authentication

The system supports optional user accounts with:
- Email-based registration with OTP verification
- Login with email and password
- JWT-based authentication for protected endpoints
- Password reset via email
- Interview history tied to user accounts

## Graceful Degradation

The application is designed to work with minimal configuration:

- **Without MongoDB**: Interviews work in voice/text mode without persistence. User accounts and history are disabled.
- **Without EmailJS**: Email verification falls back to console logging (development mode). Users must manually enter OTP codes.
- **Without Gemini API Key**: The application warns on startup but still runs. Question generation and evaluation will fail until the key is configured.

## Documentation

For detailed information, see:

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - System design, components, and data flows
- **[SETUP.md](./SETUP.md)** - Detailed setup instructions and troubleshooting
- **[API.md](./API.md)** - REST API endpoint reference with examples
- **[WEBSOCKET.md](./WEBSOCKET.md)** - WebSocket protocol and real-time communication
- **[DATABASE.md](./DATABASE.md)** - MongoDB schemas and data models
- **[BACKEND.md](./BACKEND.md)** - Backend architecture and implementation details
- **[FRONTEND.md](./FRONTEND.md)** - Frontend structure and module organization
- **[SECURITY.md](./SECURITY.md)** - Security features and hardening recommendations

## Development

The project uses:
- **Concurrently** for running multiple dev servers in parallel
- **Hot reloading** in backend (Node.js `--watch` flag)
- **Hot module replacement (HMR)** in frontend (Vite)

Run `npm run dev` from the root directory for full development experience.

## License

MIT

## Support

For issues, questions, or contributions, refer to CONTRIBUTING.md (when available).
