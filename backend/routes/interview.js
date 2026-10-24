const express = require('express');
const rateLimit = require('express-rate-limit');
const { accountDailyLimit, accountStartLimit } = require('../security/quotas');
const {
  RequestError,
  validateConfig,
  createSession,
  getSession,
} = require('../interview/engine');

const router = express.Router();

// An account remains limited when its owner changes IP addresses.
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: req => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many practice requests. Please wait a minute.' },
}));
router.use(accountDailyLimit);

router.param('id', async (req, res, next, id) => {
  try {
    const session = await getSession(id);
    if (!session || String(session.userId) !== String(req.user.id)) {
      return res.status(404).json({ error: 'Interview not found.' });
    }
    req.interviewSession = session;
    next();
  } catch (error) { next(error); }
});

function acquireSession(req, res) {
  const session = req.interviewSession;
  if (!session) return true;
  if (session._httpBusy || (session._voiceActive && req.method === 'POST')) {
    res.status(409).json({ error: 'This interview is processing another request or voice session. Please wait.' });
    return false;
  }
  session._httpBusy = true;
  return true;
}

function sendQuotaError(res, error) {
  if (!['QUOTA_EXCEEDED', 'QUOTA_UNAVAILABLE', 'AI_INPUT_TOO_LARGE'].includes(error.code)) return false;
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  res.status(error.status).json({ error: error.message });
  return true;
}

const interviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Max 20 interview creations per IP per hour
  message: { error: 'Too many interview sessions created. Please try again later.' },
});

const answerLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Max 30 answers/hints per minute
  message: { error: 'Too many requests. Please slow down.' },
});

router.post('/start', interviewLimiter, accountStartLimit, async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const config = validateConfig(req.body);
    const session = await createSession(config, {
      userId: req.user ? req.user.id : null,
    });
    console.log(`[INTERVIEW] Started new session: ${session.id} (Mode: ${config.mode}, Position: ${config.position})`);
    let result = {};
    if (config.mode === 'voice') {
      result = {
        interviewId: session.id,
        mode: 'voice',
        questionCount: session.config.questionCount,
        summary: session.summary(),
      };
    } else {
      const { opening, question } = await session.start();
      result = {
        interviewId: session.id,
        mode: 'text',
        opening,
        question,
        questionNumber: 1,
        questionCount: session.config.questionCount,
        summary: session.summary(),
      };
    }
    res.json(result);
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Interview start failed:', err.message);
    res.status(502).json({ error: 'The AI interviewer is temporarily unavailable. Please try again.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

router.post('/:id/text-start', interviewLimiter, async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const session = req.interviewSession;
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    if (session.startedAt !== null) {
      return res
        .status(409)
        .json({ error: 'This interview has already started.' });
    }
    const { opening, question } = await session.start();
    res.json({
      interviewId: session.id,
      mode: 'text',
      opening,
      question,
      questionNumber: 1,
      questionCount: session.config.questionCount,
      summary: session.summary(),
    });
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Text start failed:', err.message);
    res.status(502).json({ error: 'The AI interviewer is temporarily unavailable. Please try again.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

router.post('/:id/answer', answerLimiter, async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const session = req.interviewSession;
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    const result = await session.answer(req.body && req.body.answer);
    return res.json({ ...result, summary: session.summary() });
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Interview answer failed:', err.message);
    res.status(502).json({ error: 'The AI interviewer is temporarily unavailable. Please try again.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

router.get('/:id', async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const session = req.interviewSession;
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      await session.evaluate();
    }
    res.json(session.summary());
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    console.error('Interview summary failed:', err.message);
    res.status(502).json({ error: 'Could not load the interview summary.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

router.post('/:id/hint', answerLimiter, async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const session = req.interviewSession;
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    const { hint } = await session.hint();
    res.json({ hint });
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Hint failed:', err.message);
    res.status(502).json({ error: 'The AI could not generate a hint right now. Please try again.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

router.post('/:id/finalize', async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const session = req.interviewSession;
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    console.log(`[ASSESSMENT] Generating assessment and finalizing session: ${session.id}`);
    await session.evaluate();
    session.status = 'completed';
    session.completedAt = Date.now();
    await session._persist();
    res.json({ success: true });
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    console.error('Finalize failed:', err.message);
    res.status(502).json({ error: 'Could not finalize the interview.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

router.get('/:id/rating', async (req, res) => {
  if (!acquireSession(req, res)) return;
  try {
    const session = req.interviewSession;
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    const rating = await session.rating();
    res.json(rating);
  } catch (err) {
    if (sendQuotaError(res, err)) return;
    console.error('Rating failed:', err.message);
    res.status(502).json({ error: 'Could not generate your rating right now. Please try again.' });
  } finally {
    if (req.interviewSession) req.interviewSession._httpBusy = false;
  }
});

module.exports = router;
