const { WebSocketServer } = require('ws');
const { getSession } = require('../interview/engine');
const prompts = require('../interview/prompts');
const LiveVoice = require('../gemini/live');

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
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, interviewId);
    });
  });

  wss.on('connection', (ws, interviewId) => {
    const cleanup = attachVoice(ws, interviewId);
    if (cleanup) {
      ws.on('close', cleanup);
      ws.on('error', () => {});
    }
  });

  return wss;
}

function attachVoice(ws, interviewId) {
  const session = getSession(interviewId);
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
  let closingKicked = false;
  let proceedQuestionAsked = false;

  const COMPLETE_LIKE = /INTERVIEW COMPLETE/i;

  const isQuestionLike = (text) => {
    const t = (text || '').trim();
    if (!t) return false;
    if (COMPLETE_LIKE.test(t)) return false;
    if (/[?¿？]/.test(t)) return true;
    return /^(who|what|when|where|why|how|can|could|would|will|do|does|did|tell me|describe|elaborate|walk me)/i.test(
      t
    );
  };

  const complete = () => {
    if (completed) return;
    completed = true;
    session.status = 'completed';
    session.completedAt = Date.now();
    session.evaluate();
    safeSend(ws, { type: 'complete', questionCount: session.config.questionCount });
  };

  const commitCandidate = () => {
    const fullText = currentCandidateText.trim();
    if (fullText) {
      session.transcript.push({ role: 'candidate', text: fullText });
      safeSend(ws, { type: 'candidateText', text: fullText, final: true });
    }
    currentCandidateText = '';
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
      safeSend(ws, {
        type: 'turnComplete',
        questionNumber: Math.min(modelTurns, session.config.questionCount),
      });

      if (session.config.questionCount < 1 || modelTurns > session.config.questionCount) {
        complete();
      } else if (modelTurns > session.config.questionCount) {
        // Turns 1..N are the interview questions. Turn N+1 is the "would you
        // like to proceed?" transition question after the final answer; the
        // candidate answers it, and the following turn is the closing.
        if (!proceedQuestionAsked) {
          proceedQuestionAsked = true;
        } else if (!closingKicked && isQuestionLike(text)) {
          closingKicked = true;
          voice.sendText(
            'The interview is now over. Respond with ONLY a brief, warm closing ' +
              'statement. Thank the candidate for their time. Do not ask any new ' +
              'questions. End your message with the exact phrase: INTERVIEW COMPLETE'
          );
        } else {
          complete();
        }
      }
    }

    if (serverContent.generationComplete) {
      safeSend(ws, { type: 'generationComplete' });
    }
  };

  voice.onOpen = () => {};
  voice.onError = (e) => {
    console.error('Live voice error:', e && e.message);
    if (!completed) {
      safeSend(ws, { type: 'error', message: 'The voice connection failed. Please try text mode.' });
    }
  };
  voice.onClose = () => {
    if (!completed) {
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
    }
  });

  return () => voice.close();
}

module.exports = { initLiveServer };