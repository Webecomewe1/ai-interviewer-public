const express = require('express');
const {
  RequestError,
  validateConfig,
  createSession,
  getSession,
} = require('../interview/engine');

const router = express.Router();

router.post('/start', async (req, res) => {
  try {
    const config = validateConfig(req.body);
    const session = createSession(config);
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

router.post('/:id/text-start', async (req, res) => {
  try {
    const session = getSession(req.params.id);
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

router.post('/:id/answer', async (req, res) => {
  try {
    const session = getSession(req.params.id);
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
    const session = getSession(req.params.id);
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

module.exports = router;