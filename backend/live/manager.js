const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { getSession } = require('../interview/engine');
const prompts = require('../interview/prompts');
const LiveVoice = require('../gemini/live');
const { verifyToken } = require('../auth/token');

function safeSend(ws, obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function initLiveServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const match = req.url.match(/^\/live\/([\w-]+)(\?.*)?$/);
    if (!match) {
      socket.destroy();
      return;
    }
    const interviewId = decodeURIComponent(match[1]);
    const query = match[2] ? match[2].slice(1) : '';
    const token = new URLSearchParams(query).get('token');
    let authed = false;
    if (token) {
      try { authed = Boolean(verifyToken(token)); } catch (e) { authed = false; }
    }
    if (!authed) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, interviewId);
    });
  });

  wss.on('connection', (ws, interviewId) => {
    attachVoice(ws, interviewId).catch((err) => {
      console.error('Voice attach failed:', err && err.message);
      safeSend(ws, {
        type: 'error',
        message: 'The voice session could not start. Please try text mode.',
      });
      ws.close();
    });
  });

  return wss;
}

async function attachVoice(ws, interviewId) {
  const session = await getSession(interviewId);
  if (!session || session.status === 'completed') {
    safeSend(ws, { type: 'error', message: 'Interview not found or already finished.' });
    ws.close();
    return null;
  }
  if (session.config.mode !== 'voice') {
    safeSend(ws, {
      type: 'error',
      message: 'This interview is not configured for voice.',
    });
    ws.close();
    return null;
  }
  if (session.startedAt !== null) {
    safeSend(ws, { type: 'error', message: 'A voice session is already active for this interview.' });
    ws.close();
    return null;
  }

  const voice = new LiveVoice();
  let currentModelText = '';
  let currentCandidateText = '';
  let modelTurns = 0;
  let completed = false;
  let assessmentPromptSent = false;
  let candidateAnswers = 0;
  let candidateAnswerStart = Date.now();

  const COMPLETE_MIME = 'audio/pcm;rate=24000';
  const FIXED_CLOSE_TEXT = 'That concludes our interview. Thank you for your time. Interview complete.';
  let COMPLETE_AUDIO_B64 = null;
  try {
    const pcmPath = path.join(__dirname, '..', 'assets', 'interview-complete.pcm');
    COMPLETE_AUDIO_B64 = fs.readFileSync(pcmPath).toString('base64');
  } catch (e) {
    console.warn('No closing chime asset; falling back to model-generated close.');
  }

  const complete = async (opts) => {
    if (completed) return;
    completed = true;
    session.status = 'completed';
    session.completedAt = Date.now();
    if (!opts || !opts.skipEval) {
      await session.evaluate();
    } else {
      await persistSession();
    }
    safeSend(ws, { type: 'complete', questionCount: session.config.questionCount });
  };

  const sendAssessmentPrompt = () => {
    if (assessmentPromptSent || completed) return;
    assessmentPromptSent = true;
    
    if (COMPLETE_AUDIO_B64) {
      safeSend(ws, { type: 'audio', data: COMPLETE_AUDIO_B64, mimeType: COMPLETE_MIME });
    }
    session.transcript.push({ role: 'interviewer', text: FIXED_CLOSE_TEXT });
    
    safeSend(ws, {
      type: 'assessmentPrompt',
      questionCount: session.config.questionCount,
    });
  };

  const commitCandidate = () => {
    const fullText = currentCandidateText.trim();
    if (fullText) {
      session.transcript.push({ role: 'candidate', text: fullText });
      safeSend(ws, { type: 'candidateText', text: fullText, final: true });

      const wordCount = fullText.split(/\s+/).filter(Boolean).length;
      const elapsedMs = Math.max(0, Date.now() - candidateAnswerStart);
      const qNum = session.questions.length || 1;
      const lastAns = session.answers[session.answers.length - 1];
      if (lastAns && lastAns.questionNumber === qNum) {
        lastAns.answer = `${lastAns.answer} ${fullText}`.trim();
        lastAns.wordCount = lastAns.answer.split(/\s+/).filter(Boolean).length;
        lastAns.elapsedMs += elapsedMs;
      } else {
        session.answers.push({
          questionNumber: qNum,
          answer: fullText,
          wordCount,
          elapsedMs,
          difficulty: session.lastDifficulty,
          eval: null,
        });
      }
      candidateAnswers = session.answers.length;
      finalizeIfDone();
    }
    currentCandidateText = '';
  };

  const log = (cat, msg) => console.log(`[${new Date().toISOString()}] [${cat}] ${msg}`);
  const err = (cat, msg) => console.error(`[${new Date().toISOString()}] [${cat}] ${msg}`);
  
  const persistSession = () => {
    if (session._persist) session._persist();
  };

  const finalizeIfDone = () => {
    // Only finalize if the AI has already reached the final turn (modelTurns >= session.config.questionCount)
    // AND the candidate has provided an answer for that final turn (candidateAnswers >= session.config.questionCount)
    if (session.config.questionCount >= 1 && modelTurns >= session.config.questionCount && candidateAnswers >= session.config.questionCount) {
      sendAssessmentPrompt();
    }
  };

  const accumulateCandidate = (prev, next) => {
    if (!prev) return next;
    if (next.startsWith(prev)) return next;
    const max = Math.min(prev.length, next.length);
    for (let i = max; i >= 1; i--) {
      const tail = prev.slice(-i);
      if (next.startsWith(tail)) return prev + next.slice(i);
    }
    return prev + next;
  };

  const handleServerMessage = (msg) => {
    if (completed) return;
    if (assessmentPromptSent) return;

    const serverContent = msg && msg.serverContent;
    if (!serverContent) {
      if (msg && msg.setupComplete) {
        voice.sendBegin();
        return;
      }
      return;
    }

    if (serverContent.modelTurn && Array.isArray(serverContent.modelTurn.parts)) {
      for (const part of serverContent.modelTurn.parts) {
        if (part && part.inlineData && part.inlineData.data) {
          safeSend(ws, {
            type: 'audio',
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
          });
        }
      }
    }

    if (serverContent.outputTranscription && serverContent.outputTranscription.text) {
      currentModelText += serverContent.outputTranscription.text;
      safeSend(ws, {
        type: 'modelText',
        text: currentModelText,
        final: false,
      });
    }

    if (serverContent.inputTranscription) {
      const candidateTranscription = serverContent.inputTranscription;
      if (candidateTranscription.text) {
        currentCandidateText = accumulateCandidate(
          currentCandidateText,
          candidateTranscription.text
        );
        safeSend(ws, {
          type: 'candidateText',
          text: currentCandidateText,
          final: false,
        });
      }
      if (candidateTranscription.finished) {
        commitCandidate();
        persistSession();
        candidateAnswers += 1;
        finalizeIfDone();
      }
    }

    const isModelSpeech = serverContent.modelTurn &&
      Array.isArray(serverContent.modelTurn.parts) &&
      serverContent.modelTurn.parts.some((p) => p && p.inlineData && p.inlineData.data);
    if (isModelSpeech) {
      commitCandidate();
    }

    if (serverContent.interrupted) {
      currentModelText = '';
      commitCandidate();
      safeSend(ws, { type: 'interrupted' });
    }

    if (serverContent.turnComplete) {
      modelTurns += 1;
      const text = currentModelText.trim();
      const isComplete = text.includes('INTERVIEW COMPLETE') || modelTurns > session.config.questionCount;
      const displayText = text.replace(/\s*INTERVIEW COMPLETE\.?\s*$/i, '').trim();
      safeSend(ws, { type: 'modelText', text: displayText, final: true });
      if (displayText) {
        session.transcript.push({ role: 'interviewer', text: displayText });
        if (modelTurns <= session.config.questionCount) {
          session.questions.push({
            number: modelTurns,
            text,
            isFollowUp: modelTurns > 1,
            difficulty: session.lastDifficulty,
          });
        }
      }
      currentModelText = '';
      commitCandidate();
      persistSession();
      candidateAnswerStart = Date.now();

      if (isComplete && candidateAnswers >= session.config.questionCount) {
        log('SESSION', 'Interview automatically completing after candidate answer.');
        sendAssessmentPrompt();
      } else {
        safeSend(ws, {
          type: 'turnComplete',
          questionNumber: Math.min(modelTurns, session.config.questionCount),
        });
      }
    }

    if (serverContent.generationComplete) {
      safeSend(ws, { type: 'generationComplete' });
    }
  };

  voice.onOpen = () => {};
  voice.onError = (e) => {
    logEvent('VOICE_SESSION_ERROR', e && e.message);
    if (!completed && !assessmentPromptSent) {
      safeSend(ws, { type: 'error', message: 'The voice connection failed. Please try text mode.' });
    }
  };
  voice.onClose = () => {
    logEvent('VOICE_SESSION', 'Voice connection closed.');
    if (!completed && !assessmentPromptSent) {
      safeSend(ws, { type: 'closed', reason: 'The voice connection was closed.' });
    }
  };

  voice
    .connect({
      systemInstruction: prompts.liveInterviewerSystemPrompt(session.config),
      onMessage: handleServerMessage,
    })
    .then(() => {
      session.startedAt = Date.now();
      safeSend(ws, {
        type: 'ready',
        startedAt: session.startedAt,
        position: session.config.position,
        questionCount: session.config.questionCount,
      });
    })
    .catch((err) => {
      console.error('Live connect failed:', err.message);
      safeSend(ws, {
        type: 'error',
        message: 'The AI voice session could not start. Please try text mode.',
      });
      ws.close();
    });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg) return;
    if (msg.type === 'audio' && msg.data) {
      voice.sendAudio(msg.data, Number(msg.sampleRate) || 16000);
    } else if (msg.type === 'audioEnd') {
      voice.sendAudioStreamEnd();
    } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
      voice.sendText(msg.text.trim());
    } else if (msg.type === 'ping') {
      safeSend(ws, { type: 'pong' });
    } else if (msg.type === 'assessmentChoice') {
      if (!assessmentPromptSent) return;
      if (msg.value === 'no') {
        complete({ skipEval: true });
      } else if (msg.value === 'yes') {
        complete();
      }
    }
  });

  ws.on('close', () => {
    persistSession();
    voice.close();
  });
  ws.on('error', () => {});
}

module.exports = { initLiveServer };