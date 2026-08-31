(function () {
  'use strict';

  var STORAGE_KEY = 'ai-interviewer:session';
  var VOICE_READY_TIMEOUT = 25000;

  var els = {
    setupScreen: document.getElementById('setup-screen'),
    interviewScreen: document.getElementById('interview-screen'),
    completeScreen: document.getElementById('complete-screen'),
    serverStatus: document.getElementById('server-status'),
    setupForm: document.getElementById('setup-form'),
    startBtn: document.getElementById('start-btn'),
    textBtn: document.getElementById('text-btn'),
    position: document.getElementById('position'),
    customPositionField: document.getElementById('custom-position-field'),
    questionCount: document.getElementById('question-count'),
    customCountField: document.getElementById('custom-count-field'),
    interviewStatus: document.getElementById('interview-status'),
    aiMessage: document.getElementById('ai-message'),
    progress: document.getElementById('progress'),
    timer: document.getElementById('timer'),
    transcript: document.getElementById('transcript'),
    answerInput: document.getElementById('answer-input'),
    sendBtn: document.getElementById('send-btn'),
    closingMessage: document.getElementById('closing-message'),
    completeTranscript: document.getElementById('complete-transcript'),
    newInterviewBtn: document.getElementById('new-interview-btn'),
    returnSetupBtn: document.getElementById('return-setup-btn'),
    toggleRatingBtn: document.getElementById('toggle-rating-btn'),
    ratingCard: document.getElementById('rating-card'),
    ratingOverall: document.getElementById('rating-overall'),
    ratingDims: document.getElementById('rating-dims'),
    ratingNote: document.getElementById('rating-note'),
    voiceCard: document.getElementById('voice-card'),
    talkBtn: document.getElementById('talk-btn'),
    voiceBtn: document.getElementById('voice-btn'),
    chipAi: document.getElementById('chip-ai'),
    chipCand: document.getElementById('chip-cand'),
    chipConn: document.getElementById('chip-conn'),
    voiceHint: document.getElementById('voice-hint'),
    countdown: document.getElementById('countdown'),
    candidateMessage: document.getElementById('candidate-message'),
    candidateMessageText: document.getElementById('candidate-message-text'),
    restartBtn: document.getElementById('restart-btn'),
  };

  var timerInterval = null;
  var voice = null;
  var voiceReady = false;
  var voiceDone = false;
  var voiceSummaryQuestionCount = null;
  var appVoiceAvailable = false;

  var countdownTimer = null;
  var countdownToken = 0;

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () {
        return {};
      }).then(function (data) {
        if (!res.ok) {
          throw new Error(data.error || 'Something went wrong. Please try again.');
        }
        return data;
      });
    });
  }

  function setBanner(el, state, message) {
    el.classList.remove('ok', 'error', 'processing');
    if (state) el.classList.add(state);
    var dot = el.querySelector('.status-dot');
    if (dot) dot.className = 'status-dot';
    var text = el.querySelector('.status-text');
    if (text) text.textContent = message;
  }

  function setInterviewStatus(state, message) {
    setBanner(els.interviewStatus, state, message);
  }

  function formatTime(totalSeconds) {
    var m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    var s = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
    return m + ':' + s;
  }

  function startTimer(fromMs) {
    stopTimer();
    function tick() {
      var seconds = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
      els.timer.textContent = formatTime(seconds);
    }
    tick();
    timerInterval = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function saveSession(id, startedAt) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ interviewId: id, startedAt: startedAt || null })
    );
  }

  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function addBubble(container, role, text) {
    var div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function renderTranscript(container, transcript) {
    container.innerHTML = '';
    (transcript || []).forEach(function (entry) {
      addBubble(
        container,
        entry.role === 'candidate' ? 'candidate' : 'interviewer',
        entry.text
      );
    });
  }

  function latestAiMessage(summary) {
    var entries = summary.transcript || [];
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role !== 'candidate') return entries[i].text;
    }
    return '';
  }

  function setAnswerEnabled(enabled, placeholder) {
    els.sendBtn.disabled = !enabled;
    els.answerInput.disabled = !enabled;
    if (placeholder) els.answerInput.placeholder = placeholder;
  }

  function setChip(chip, cls) {
    chip.className = 'chip' + (cls ? ' ' + cls : '');
  }

  function showCandidateLive(text) {
    els.candidateMessageText.textContent = text;
    els.candidateMessageText.classList.add('listening');
    els.candidateMessage.classList.add('visible');
  }

  function clearCandidateLive() {
    els.candidateMessageText.textContent = '';
    els.candidateMessageText.classList.remove('listening');
    els.candidateMessage.classList.remove('visible');
  }

  function setTalkButton(state, label) {
    els.talkBtn.disabled = state === 'disabled';
    els.talkBtn.classList.toggle('active', state === 'active');
    els.talkBtn.textContent =
      label || (state === 'active' ? '■ End Turn' : '🎤 Talk');
  }

  function toggleTalk() {
    if (!voice || !voiceReady || voiceDone) return;
    if (voice.isHolding()) {
      voice.endTurn();
    } else {
      voice.startTurn();
    }
  }

  function startAnswerCountdown() {
    stopAnswerCountdown();
    if (!voiceReady || voiceDone) return;
    if (voice && voice.isHolding()) return;
    var token = ++countdownToken;
    setTalkButton('disabled', 'Prepare');
    els.voiceHint.textContent = 'Get ready to answer.';
    els.countdown.classList.remove('hidden');
    els.countdown.textContent = '3';
    var remaining = 2;
    countdownTimer = setInterval(function () {
      if (countdownToken !== token) return;
      if (remaining > 0) {
        els.countdown.textContent = String(remaining);
        remaining -= 1;
      } else {
        finishAnswerCountdown();
      }
    }, 1000);
  }

  function finishAnswerCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownToken++;
    els.countdown.classList.add('hidden');
    els.voiceHint.textContent =
      'Press the Talk button when you want to speak, then press End Turn when done. Pauses won\'t interrupt you.';
    setTalkButton('normal');
  }

  function stopAnswerCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownToken++;
    els.countdown.classList.add('hidden');
  }

  // ---- setup screen ----

  function toggleCustomFields() {
    els.customPositionField.classList.toggle(
      'hidden',
      els.position.value !== 'Custom Position'
    );
    els.customCountField.classList.toggle(
      'hidden',
      els.questionCount.value !== 'custom'
    );
  }

  function checkServerStatus() {
    api('/api/status')
      .then(function (data) {
        appVoiceAvailable = !!data.gemini.voiceAvailable;
        if (data.gemini.configured) {
          var voiceNote = appVoiceAvailable
            ? ' Voice: ' + (data.gemini.liveModel || 'on')
            : ' Voice is not available on this setup; text mode will be used.';
          setBanner(
            els.serverStatus,
            'ok',
            'Connected. AI model: ' +
              data.gemini.model +
              '.' +
              voiceNote
          );
          els.startBtn.disabled = false;
        } else {
          setBanner(
            els.serverStatus,
            'error',
            'Connected, but GEMINI_API_KEY is missing. Add it to .env and restart the server.'
          );
          els.startBtn.disabled = true;
        }
      })
      .catch(function () {
        setBanner(
          els.serverStatus,
          'error',
          'Cannot connect to server. Is it running?'
        );
        els.startBtn.disabled = true;
      });
  }

  function collectConfig() {
    var config = {
      position: els.position.value,
      interviewType: document.getElementById('interview-type').value,
      difficulty: document.getElementById('difficulty').value,
      questionCount: document.getElementById('question-count').value,
    };
    if (config.position === 'Custom Position') {
      config.customPosition = document
        .getElementById('custom-position')
        .value.trim();
    }
    if (config.questionCount === 'custom') {
      config.questionCount = Number(
        document.getElementById('custom-count').value || 10
      );
    } else {
      config.questionCount = Number(config.questionCount);
    }
    return config;
  }

  function setBusy(busy) {
    els.startBtn.disabled = busy;
    els.startBtn.textContent = busy ? 'Starting...' : 'START INTERVIEW';
  }

  function showInterview(summary, opts) {
    opts = opts || {};
    els.setupScreen.classList.add('hidden');
    els.completeScreen.classList.add('hidden');
    els.interviewScreen.classList.remove('hidden');

    els.progress.textContent =
      'Question ' +
      (summary.lastQuestion ? summary.lastQuestion.number : 0) +
      ' of ' +
      summary.questionCount;
    els.aiMessage.textContent = latestAiMessage(summary);
    renderTranscript(els.transcript, summary.transcript);
    setInterviewStatus('ok', 'In progress. ' + summary.position);
    if (summary.startedAt) startTimer(summary.startedAt);
    document.title = 'AI Interviewer — ' + summary.position;

    if (opts.voice) {
      els.voiceCard.classList.remove('hidden');
      setTalkButton('disabled');
      setChip(els.chipConn, 'active');
      setChip(els.chipAi, '');
      setChip(els.chipCand, '');
      els.voiceHint.textContent = 'Connecting to the AI interviewer...';
      clearCandidateLive();
      setAnswerEnabled(false, 'Voice interview in progress — no typing needed.');
    } else {
      els.voiceCard.classList.add('hidden');
      setAnswerEnabled(true);
      els.answerInput.value = '';
      els.answerInput.focus();
    }
  }

  // ---- voice flow ----

  function startVoiceFlow(interviewId) {
    return new Promise(function (resolve, reject) {
      voice = new VoiceSession({
        ready: function (msg) {
          clearTimeout(timer);
          voiceReady = true;
          voiceSummaryQuestionCount = msg.questionCount;
          saveSession(interviewId, msg.startedAt);
          if (msg.startedAt) startTimer(msg.startedAt);
          setTalkButton('disabled');
          els.voiceHint.textContent =
            'Press the Talk button when you want to speak, then press End Turn when done. Pauses won\'t interrupt you.';
          resolve(null);
        },
        holding: function (holding) {
          if (!voiceReady || voiceDone) return;
          if (holding) stopAnswerCountdown();
          setTalkButton(holding ? 'active' : 'disabled');
          setChip(els.chipCand, holding ? 'speaking' : '');
          els.voiceHint.textContent = holding
            ? 'Recording... press End Turn when you finish speaking.'
            : 'Turn ended. Waiting for the AI interviewer...';
        },
        micError: function () {
          reject(new Error('Microphone access was denied. You can continue by typing.'));
        },
        captureError: function (err) {
          reject(new Error('Could not start audio: ' + (err && err.message ? err.message : 'unknown')));
        },
        state: function (s) {
          setChip(els.chipConn, s === 'active' ? 'active' : s === 'ended' ? 'error' : 'thinking');
        },
        aiSpeaking: function (speaking) {
          setChip(els.chipAi, speaking ? 'speaking' : '');
          if (speaking) {
            if (voice && voice.isHolding()) {
              setTalkButton('active');
            } else {
              setTalkButton('disabled');
            }
            clearCandidateLive();
            els.voiceHint.textContent = 'The AI interviewer is speaking...';
          } else if (voiceReady && !voiceDone) {
            if (voice && voice.isHolding()) {
              els.voiceHint.textContent =
                'Recording... press End Turn when you finish speaking.';
            } else {
              startAnswerCountdown();
            }
          }
        },
        aiGenerating: function (generating) {
          if (generating) {
            setChip(els.chipAi, 'thinking');
            if (!(voice && voice.isHolding())) {
              setTalkButton('disabled');
              els.voiceHint.textContent =
                'The interviewer is preparing the next response...';
            }
          } else {
            setChip(els.chipAi, '');
          }
        },
        level: function (rms) {
          if (!voiceReady || voiceDone) return;
          if (voice && voice.isHolding()) {
            setChip(els.chipCand, 'speaking');
          } else {
            setChip(els.chipCand, '');
          }
        },
        candidateText: function (payload) {
          if (payload.final) {
            setChip(els.chipCand, '');
            clearCandidateLive();
            if (payload.text && payload.text.trim()) {
              addBubble(els.transcript, 'candidate', payload.text.trim());
            }
          } else if (payload.text) {
            showCandidateLive(payload.text);
          }
        },
        aiText: function (payload) {
          if (payload.text) els.aiMessage.textContent = payload.text;
          if (payload.final) {
            addBubble(els.transcript, 'interviewer', payload.text);
          }
        },
        turnComplete: function (payload) {
          els.progress.textContent =
            'Question ' + payload.questionNumber + ' of ' +
            (voiceSummaryQuestionCount || '?');
        },
        complete: function () {
          stopAnswerCountdown();
          setTalkButton('disabled');
          voiceDone = true;
          voice.end().then(function () {
            finishVoiceComplete(interviewId);
          });
        },
        error: function (payload) {
          stopAnswerCountdown();
          setTalkButton('disabled');
          if (!voiceReady) {
            reject(new Error(payload.message || 'Voice failed.'));
          } else {
            setInterviewStatus(
              'error',
              payload.message || 'Voice connection problem.'
            );
            setChip(els.chipConn, 'error');
            els.voiceHint.textContent =
              'Voice ended. Reload the page to switch to text mode.';
          }
        },
        wsClosed: function () {
          stopAnswerCountdown();
          setTalkButton('disabled');
          if (!voiceReady) {
            reject(new Error('Voice connection could not be established.'));
          } else if (!voiceDone) {
            setInterviewStatus(
              'error',
              'Voice connection was lost. Check your internet connection.'
            );
            setChip(els.chipConn, 'error');
          }
        },
      });

      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        reject(new Error('Voice connection timed out. You can continue by typing.'));
      }, VOICE_READY_TIMEOUT);

      voice
        .connect(interviewId)
        .catch(function (err) {
          if (!timedOut) {
            clearTimeout(timer);
            reject(err);
          }
        });
    });
  }

  function startInterview() {
    var config = collectConfig();
    if (!appVoiceAvailable) {
      config.mode = 'text';
      setBanner(
        els.serverStatus,
        'error',
        'Voice is not available on this setup. Starting in text mode.'
      );
      return textModeRun(config);
    }
    config.mode = 'voice';
    setBusy(true);
    setBanner(els.serverStatus, 'processing', 'Starting the AI interviewer...');

    api('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(function (data) {
        saveSession(data.interviewId, null);
        els.setupScreen.classList.add('hidden');
        els.interviewScreen.classList.remove('hidden');
        return startVoiceFlow(data.interviewId);
      })
      .then(function () {
        // Voice is live; no summary to render yet (interview begins on voice).
        setInterviewStatus('ok', 'Voice interview started. ' + config.position);
        els.progress.textContent = 'Question 1 of ' + config.questionCount;
        els.aiMessage.textContent = 'Connecting...';
        els.voiceCard.classList.remove('hidden');
        setAnswerEnabled(false, 'Voice interview in progress — no typing needed.');
      })
      .catch(function (err) {
        return fallbackToText(err);
      });
  }

  function fallbackToText(err) {
    var session = loadSession();
    var id = session ? session.interviewId : null;
    if (voice) {
      voice.end();
      voice = null;
    }
    stopAnswerCountdown();
    if (id) {
      return api('/api/interview/' + id + '/text-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then(function (data) {
          saveSession(data.interviewId, data.summary.startedAt);
          showInterview(data.summary, { voice: false });
          setBanner(
            els.serverStatus,
            'error',
            (err && err.message ? err.message : '') + ' Continuing in text mode.'
          );
        })
        .catch(function () {
          showStartError(err);
        });
    }
    showStartError(err);
  }

  function showStartError(err) {
    setBusy(false);
    setBanner(
      els.serverStatus,
      'error',
      (err && err.message ? err.message : 'Could not start the interview.') +
        ' Try again or use text mode.'
    );
    els.interviewScreen.classList.add('hidden');
    els.setupScreen.classList.remove('hidden');
  }

  function textModeRun(config) {
    return textModeStart(config);
  }

  function textModeStart(forceConfig) {
    var config = forceConfig || collectConfig();
    config.mode = 'text';
    setBusy(true);
    setBanner(els.serverStatus, 'processing', 'Starting the interview...');
    api('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(function (data) {
        saveSession(data.interviewId, data.summary.startedAt);
        setBusy(false);
        showInterview(data.summary, { voice: false });
      })
      .catch(function (err) {
        setBusy(false);
        setBanner(
          els.serverStatus,
          'error',
          err.message || 'Could not start the interview.'
        );
      });
  }

  function stopVoice() {
    stopAnswerCountdown();
    if (voice) {
      voice.end();
      voice = null;
    }
    voiceReady = false;
    setTalkButton('disabled');
    setChip(els.chipConn, '');
    els.voiceHint.textContent = 'Voice stopped.';
    clearCandidateLive();
  }

  // ---- answer (text mode) ----

  function sendAnswer() {
    if (voiceReady) return;
    var answer = els.answerInput.value.trim();
    if (!answer) return;

    var session = loadSession();
    if (!session) return;

    setAnswerEnabled(false);
    setInterviewStatus('processing', 'AI is thinking...');

    api('/api/interview/' + session.interviewId + '/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: answer }),
    })
      .then(function (data) {
        if (data.kind === 'complete') {
          showComplete(data.summary);
        } else {
          showInterview(data.summary, { voice: false });
        }
      })
      .catch(function (err) {
        setAnswerEnabled(true);
        setInterviewStatus('error', err.message || 'Something went wrong.');
        els.answerInput.focus();
      });
  }

  // ---- complete screens ----

  function showComplete(summary) {
    stopTimer();
    stopVoice();
    voiceDone = true;
    els.setupScreen.classList.add('hidden');
    els.interviewScreen.classList.add('hidden');
    els.completeScreen.classList.remove('hidden');

    renderRating(summary.evaluation);

    var entries = summary.transcript || [];
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role !== 'candidate') {
        els.closingMessage.textContent = entries[i].text;
        break;
      }
    }
    els.closingMessage.textContent =
      els.closingMessage.textContent || 'Interview complete.';
    renderTranscript(els.completeTranscript, entries);
    document.title = 'AI Interviewer — Complete';
  }

  var RATING_DIMS = [
    ['technical', 'Technical'],
    ['problemSolving', 'Problem Solving'],
    ['communication', 'Communication'],
    ['clarity', 'Clarity'],
    ['confidence', 'Confidence'],
    ['adaptability', 'Adaptability'],
  ];

  function renderRating(evaluation) {
    var hasEval = !!evaluation;
    els.toggleRatingBtn.classList.toggle('hidden', !hasEval);
    els.ratingCard.classList.add('hidden');
    if (!hasEval) return;
    els.ratingCard.dataset.visible = 'false';

    var overall = Number(evaluation.overall);
    els.ratingOverall.textContent = Number.isFinite(overall)
      ? overall.toFixed(1)
      : '—';
    els.ratingNote.textContent = evaluation.note || '';

    var rows = RATING_DIMS.map(function (d) {
      var val = Number(evaluation[d[0]]);
      if (!Number.isFinite(val)) val = 0;
      var pct = Math.max(0, Math.min(100, val * 10));
      return (
        '<div class="rating-row">' +
        '<span class="rating-label">' + d[1] + '</span>' +
        '<div class="rating-bar"><div class="rating-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="rating-val">' + val + '</span>' +
        '</div>'
      );
    }).join('');
    els.ratingDims.innerHTML = rows;

    var suggestions = (evaluation.suggestions || []).filter(function (s) {
      return s && s.trim();
    });
    var existing = els.ratingCard.querySelector('.suggestions');
    if (existing) existing.remove();
    if (suggestions.length) {
      var box = document.createElement('div');
      box.className = 'suggestions';
      box.innerHTML =
        '<h3 class="suggestions-title">How to improve</h3>' +
        '<ul>' +
        suggestions
          .map(function (s) {
            return '<li>' + s + '</li>';
          })
          .join('') +
        '</ul>';
      els.ratingCard.appendChild(box);
    }
  }

  function toggleRating() {
    var shown = els.ratingCard.dataset.visible === 'true';
    shown = !shown;
    els.ratingCard.dataset.visible = shown ? 'true' : 'false';
    els.ratingCard.classList.toggle('hidden', !shown);
    els.toggleRatingBtn.textContent = shown
      ? 'Hide Ratings & Suggestions'
      : 'Show Ratings & Suggestions';
  }

  function finishVoiceComplete(interviewId) {
    api('/api/interview/' + interviewId)
      .then(function (summary) {
        showComplete(summary);
      })
      .catch(function () {
        setInterviewStatus(
          'error',
          'The interview is complete, but results could not be loaded.'
        );
      });
  }

  function startNewInterview() {
    clearSession();
    window.location.reload();
  }

  function returnToSetup() {
    clearSession();
    stopTimer();
    if (voice) {
      voice.end();
      voice = null;
    }
    stopAnswerCountdown();
    voiceReady = false;
    voiceDone = false;
    els.interviewScreen.classList.add('hidden');
    els.completeScreen.classList.add('hidden');
    els.setupScreen.classList.remove('hidden');
    els.aiMessage.textContent = '...';
    document.title = 'AI Interviewer';
    checkServerStatus();
  }

  // ---- restore after refresh ----

  function restoreSession() {
    var session = loadSession();
    if (!session) return;
    api('/api/interview/' + session.interviewId)
      .then(function (data) {
        if (data.status === 'completed') {
          showComplete(data);
        } else if (data.transcript && data.transcript.length) {
          showInterview(data, { voice: false });
        } else {
          clearSession();
        }
      })
      .catch(function () {
        clearSession();
      });
  }

  // ---- wiring ----

  els.setupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    startInterview();
  });
  els.textBtn.addEventListener('click', function (e) {
    e.preventDefault();
    textModeStart();
  });
  els.position.addEventListener('change', toggleCustomFields);
  els.questionCount.addEventListener('change', toggleCustomFields);
  els.sendBtn.addEventListener('click', sendAnswer);
  els.talkBtn.addEventListener('click', toggleTalk);
  els.voiceBtn.addEventListener('click', stopVoice);
  els.returnSetupBtn.addEventListener('click', returnToSetup);
  els.toggleRatingBtn.addEventListener('click', toggleRating);
  els.answerInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!els.sendBtn.disabled) sendAnswer();
    }
  });
  els.answerInput.addEventListener('input', function () {
    if (!els.answerInput.disabled) {
      els.sendBtn.disabled = els.answerInput.value.trim() === '';
    }
  });
  els.newInterviewBtn.addEventListener('click', startNewInterview);
  els.restartBtn.addEventListener('click', function () {
    if (
      window.confirm(
        'Restart the interview from the beginning? Your current progress will be lost.'
      )
    ) {
      startNewInterview();
    }
  });

  toggleCustomFields();
  checkServerStatus();
  restoreSession();
})();