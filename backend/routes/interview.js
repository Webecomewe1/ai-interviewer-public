const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  RequestError,
  validateConfig,
  createSession,
  getSession,
} = require('../interview/engine');

const router = express.Router();

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

router.post('/start', interviewLimiter, async (req, res) => {
  try {
    const config = validateConfig(req.body);
    const session = await createSession(config, {
      userId: req.user ? req.user.id : null,
    });
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
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Interview start failed:', err.message);
    res.status(502).json({ error: 'The AI interviewer is temporarily unavailable. Please try again.' });
  }
});

router.post('/:id/text-start', interviewLimiter, async (req, res) => {
  try {
    const session = await getSession(req.params.id);
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
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Text start failed:', err.message);
    res.status(502).json({ error: 'The AI interviewer is temporarily unavailable. Please try again.' });
  }
});

router.post('/:id/answer', answerLimiter, async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    const result = await session.answer(req.body && req.body.answer);
    return res.json({ ...result, summary: session.summary() });
  } catch (err) {
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Interview answer failed:', err.message);
    res.status(502).json({ error: 'The AI interviewer is temporarily unavailable. Please try again.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      await session.evaluate();
    }
    res.json(session.summary());
  } catch (err) {
    console.error('Interview summary failed:', err.message);
    res.status(502).json({ error: 'Could not load the interview summary.' });
  }
});

router.post('/:id/hint', answerLimiter, async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    const { hint } = await session.hint();
    res.json({ hint });
  } catch (err) {
    if (err instanceof RequestError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Hint failed:', err.message);
    res.status(502).json({ error: 'The AI could not generate a hint right now. Please try again.' });
  }
});

router.post('/:id/finalize', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    await session.evaluate();
    session.status = 'completed';
    session.completedAt = Date.now();
    await session._persist();
    res.json({ success: true });
  } catch (err) {
    console.error('Finalize failed:', err.message);
    res.status(502).json({ error: 'Could not finalize the interview.' });
  }
});

router.get('/:id/rating', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Interview not found.' });
    if (session.status === 'completed') {
      return res.status(409).json({ error: 'This interview is already finished.' });
    }
    const rating = await session.rating();
    res.json(rating);
  } catch (err) {
    console.error('Rating failed:', err.message);
    res.status(502).json({ error: 'Could not generate your rating right now. Please try again.' });
  }
});

module.exports = router;