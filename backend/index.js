const express = require('express');

// Crash protection & logging
process.on('uncaughtException', (err) => {
  console.error('FATAL EXCEPTION:', err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason.stack || reason);
});

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const gemini = require('./gemini/client');
const interviewRoutes = require('./routes/interview');
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./auth/middleware');
const { connectDB } = require('./db');
const { initLiveServer } = require('./live/manager');
const store = require('./interview/store');

const app = express();
app.set('trust proxy', 1);
const PORT = config.port;

// Global Security Hardening: Helmet protection against clickjacking, XSS, and general exploits
app.use(helmet({
  contentSecurityPolicy: false, // Keeping disabled for now to allow local loading / CDNs if any
  crossOriginEmbedderPolicy: false,
}));

// Bot Mitigation: Anti-Scraper & Crawl Blocker Middleware
app.use((req, res, next) => {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const scrapers = ['python', 'curl', 'wget', 'scrapy', 'postman', 'headless', 'phantomjs', 'selenium', 'puppeteer', 'beautifulsoup'];
  if (scrapers.some(bot => ua.includes(bot))) {
    return res.status(403).json({ error: 'Access denied: automated requests are prohibited.' });
  }
  next();
});

// Bot Mitigation: Global API and Abuse rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
});
app.use('/api/', apiLimiter);

app.use(cors({ origin: config.webUrl, credentials: true }));
app.use(express.json());

app.use(express.static('public'));

app.use('/api/auth', authRoutes);
app.use('/api/interview', requireAuth, interviewRoutes);

app.get('/api/me/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await store.listUserSessions(req.user.id, 20);
    const items = sessions.map((s) => ({
      interviewId: String(s._id),
      position: s.config && s.config.customPosition && s.config.position === 'Custom Position'
        ? s.config.customPosition
        : (s.config && s.config.position) || 'Interview',
      date: s.completedAt || s.createdAt,
      status: s.status,
      score: s.evaluation ? Number(s.evaluation.overall) : null,
    }));
    res.json({ sessions: items });
  } catch (err) {
    console.error('List sessions failed:', err.message);
    res.status(500).json({ error: 'Could not load your history.' });
  }
});

app.delete('/api/me/sessions', requireAuth, async (req, res) => {
  try {
    const deleted = await store.clearUserSessions(req.user.id);
    res.json({ cleared: deleted });
  } catch (err) {
    console.error('Clear sessions failed:', err.message);
    res.status(500).json({ error: 'Could not clear your history.' });
  }
});

app.get('/api/status', async (req, res) => {
  const liveModel = await gemini.resolveLiveModel();
  res.json({
    ok: true,
    gemini: {
      configured: gemini.isConfigured(),
      model: gemini.getModel(),
      liveModel,
      voiceAvailable: Boolean(liveModel),
    },
    auth: {
      configured: config.isAuthConfigured,
    },
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: err.message || 'Internal server error', 
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack 
  });
});

connectDB()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`AI Interviewer running at ${config.backendUrl || `http://localhost:${PORT}`}`);
      if (!gemini.isConfigured()) {
        console.warn('Warning: GEMINI_API_KEY is not set. Add it to the .env file.');
      }
      if (!config.mongoUri) {
        console.warn('Warning: MONGO_URI is not set. Question cache and history persistence are disabled.');
      }
    });
    initLiveServer(server);
  })
  .catch((err) => {
    console.error('FATAL: Failed to start server:', err.stack || err.message);
    process.exit(1);
  });