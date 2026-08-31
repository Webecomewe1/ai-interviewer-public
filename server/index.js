const path = require('path');
const express = require('express');
const config = require('./config');
const gemini = require('./gemini/client');
const interviewRoutes = require('./routes/interview');
const { initLiveServer } = require('./live/manager');

const app = express();
const PORT = config.port;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/interview', interviewRoutes);

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
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`AI Interviewer running at http://localhost:${PORT}`);
  if (!gemini.isConfigured()) {
    console.warn('Warning: GEMINI_API_KEY is not set. Add it to the .env file.');
  }
});

initLiveServer(server);