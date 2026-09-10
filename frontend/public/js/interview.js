(function () {
  'use strict';

  var UI = window.UI;
  var VOICE_READY_TIMEOUT = 25000;

  var els = {
    topNewBtn: document.getElementById('top-new-btn'),
    interviewStatus: document.getElementById('interview-status'),
    metaPosition: document.getElementById('meta-position'),
    metaType: document.getElementById('meta-type'),
    metaDifficulty: document.getElementById('meta-difficulty'),
    timer: document.getElementById('timer'),
    progress: document.getElementById('progress'),
    progressFill: document.getElementById('progress-fill'),
    hintBtn: document.getElementById('hint-btn'),
    hintBox: document.getElementById('hint-box'),
    restartBtn: document.getElementById('restart-btn'),
    transcript: document.getElementById('transcript'),
    candidateMessage: document.getElementById('candidate-message'),
    candidateMessageText: document.getElementById('candidate-message-text'),
    answerInput: document.getElementById('answer-input'),
    sendBtn: document.getElementById('send-btn'),
    answerHintText: document.getElementById('answer-hint-text'),
    answerCount: document.getElementById('answer-count'),
    voiceCard: document.getElementById('voice-card'),
    aiMessage: document.getElementById('ai-message'),
    chipAi: document.getElementById('chip-ai'),
    chipCand: document.getElementById('chip-cand'),
    chipConn: document.getElementById('chip-conn'),
    levelVizBars: document.querySelectorAll('#level-viz .bar'),
    talkBtn: document.getElementById('talk-btn'),
    voiceBtn: document.getElementById('voice-btn'),
    voiceHint: document.getElementById('voice-hint'),
    countdown: document.getElementById('countdown'),
    assessmentModal: document.getElementById('assessment-modal'),
    assessmentYes: document.getElementById('assessment-yes'),
    assessmentNo: document.getElementById('assessment-no'),
    assessmentLoading: document.getElementById('assessment-loading'),
    sideLeft: document.getElementById('side-left'),
  };

  var timerInterval = null;
  var voice = null;
  var voiceReady = false;
  var voiceDone = false;
  var assessmentPromptReceived = false;
  var voiceSummaryQuestionCount = null;
  var appVoiceAvailable = false;
  var countdownTimer = null;
  var countdownToken = 0;
  var lastSummary = null;

  // --------------------------------------------------------- helpers

  function displayPosition(summary) {
    return summary && summary.customPosition && summary.position === 'Custom Position'
      ? summary.customPosition
      : (summary ? summary.position : '');
  }

  function latestAiMessage(summary) {
    var entries = summary.transcript || [];
    for (var i = entries.length - 1; i >= 0; i--) {
      if (entries[i].role !== 'candidate') return entries[i].text;
    }
    return '';
  }

  function setInterviewStatus(state, message) {
    UI.setBanner(els.interviewStatus, state, message);
  }

  // --------------------------------------------------------- timer

  function startTimer(fromMs) {
    stopTimer();
    function tick() {
      var seconds = Math.max(0, Math.floor((Date.now() - fromMs) / 1000));
      els.timer.textContent = UI.formatTime(seconds);
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

  // --------------------------------------------------------- progress

  function updateProgressFill(current, total) {
    if (!els.progressFill) return;
    var pct = total > 0 ? Math.max(0, Math.min(100, (current / total) * 100)) : 0;
    els.progressFill.style.width = pct + '%';
  }

  // --------------------------------------------------------- transcript

  function addBubble(container, role, text) {
    var div = document.createElement('div');
    div.className = 'bubble ' + role;
    
    // Create bubble content wrapper
    var contentWrapper = document.createElement('div');
    contentWrapper.className = 'bubble-content';
    
    var textSpan = document.createElement('span');
    textSpan.className = 'bubble-text';
    textSpan.textContent = text;
    contentWrapper.appendChild(textSpan);
    
    // Add timestamp
    var timestamp = document.createElement('span');
    timestamp.className = 'bubble-timestamp';
    var now = new Date();
    var hours = String(now.getHours()).padStart(2, '0');
    var mins = String(now.getMinutes()).padStart(2, '0');
    timestamp.textContent = hours + ':' + mins;
    contentWrapper.appendChild(timestamp);
    
    div.appendChild(contentWrapper);
    
    // Add copy button for candidate responses
    if (role === 'candidate') {
      var actions = document.createElement('div');
      actions.className = 'bubble-actions';
      var copyBtn = document.createElement('button');
      copyBtn.className = 'bubble-action-btn';
      copyBtn.setAttribute('type', 'button');
      copyBtn.setAttribute('aria-label', 'Copy response');
      copyBtn.setAttribute('title', 'Copy to clipboard');
      copyBtn.innerHTML = '📋';
      copyBtn.addEventListener('click', function(e) {
        e.preventDefault();
        navigator.clipboard.writeText(text).then(function() {
          copyBtn.innerHTML = '✓';
          copyBtn.style.color = 'var(--success)';
          setTimeout(function() {
            copyBtn.innerHTML = '📋';
            copyBtn.style.color = '';
          }, 2000);
        }).catch(function() {
          console.error('Failed to copy');
        });
      });
      actions.appendChild(copyBtn);
      div.appendChild(actions);
    }
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function renderTranscript(container, transcript, timing) {
    container.innerHTML = '';
    var candIndex = 0;
    (transcript || []).forEach(function (entry) {
      var isCandidate = entry.role === 'candidate';
      var bubble = addBubble(container, isCandidate ? 'candidate' : 'interviewer', entry.text || '');
      if (isCandidate) {
        var info = timing && timing[candIndex];
        candIndex += 1;
        if (info) {
          var parts = [];
          if (info.number != null) parts.push('Q' + info.number);
          if (info.wordCount) parts.push(info.wordCount + ' words');
          if (info.elapsedMs) parts.push(UI.formatDuration(info.elapsedMs));
          if (parts.length) {
            var tag = document.createElement('span');
            tag.className = 'bubble-tag';
            tag.textContent = parts.join('  \u00b7  ');
            bubble.insertBefore(tag, bubble.firstChild);
          }
        }
      }
    });
  }

  // --------------------------------------------------------- candidate live

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

  // --------------------------------------------------------- voice controls

  function setChip(chip, cls) {
    chip.className = 'chip' + (cls ? ' ' + cls : '');
  }

  function setVoicePanelSpeaking(speaking) {
    if (els.voiceCard) {
      els.voiceCard.classList.toggle('speaking', speaking);
      var avatar = els.voiceCard.querySelector('.avatar');
      if (avatar) {
        avatar.classList.toggle('breathing', speaking);
      }
    }
  }

  function setTalkButton(state, label) {
    els.talkBtn.disabled = state === 'disabled';
    els.talkBtn.classList.toggle('active', state === 'active');
    els.talkBtn.textContent = label || (state === 'active' ? 'End turn' : 'Talk');
  }

  function toggleTalk() {
    if (!voice || !voiceReady || voiceDone || assessmentPromptReceived || assessmentActive()) return;
    if (voice.isHolding()) {
      voice.endTurn();
    } else {
      voice.startTurn();
    }
  }

  function startAnswerCountdown() {
    stopAnswerCountdown();
    if (!voiceReady || voiceDone || assessmentPromptReceived) return;
    if (assessmentActive()) return;
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

  // --------------------------------------------------------- level visualizer

  function setLevel(rms) {
    var target = 0;
    if (rms && rms > 0.015) {
      var scaled = Math.log(1 + rms * 42) * 5.6;
      target = Math.min(els.levelVizBars.length, Math.max(1, Math.round(scaled)));
    }
    for (var i = 0; i < els.levelVizBars.length; i++) {
      els.levelVizBars[i].classList.toggle('lit', i < target);
    }
  }

  // --------------------------------------------------------- answer enabled

  function setAnswerEnabled(enabled, hint) {
    els.sendBtn.disabled = !enabled;
    els.answerInput.disabled = !enabled;
    els.answerHintText.textContent = hint || '';
    if (enabled) {
      els.sendBtn.disabled = els.answerInput.value.trim() === '';
      autoGrow(els.answerInput);
      updateAnswerCount();
    }
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }

  function updateAnswerCount() {
    if (!els.answerCount) return;
    var words = els.answerInput.value.trim().split(/\s+/).filter(Boolean).length;
    els.answerCount.textContent = words ? words + ' words' : '';
  }

  // --------------------------------------------------------- interview render

  function setInterviewMeta(summary) {
    els.metaPosition.textContent = displayPosition(summary) || '\u2014';
    els.metaType.textContent = UI.titleCase(summary.interviewType) || '\u2014';
    els.metaDifficulty.textContent = UI.titleCase(summary.difficulty) || '\u2014';
    var qn = summary.lastQuestion ? Math.min(summary.lastQuestion.number, summary.questionCount) : 0;
    
    var isFinal = qn >= summary.questionCount;
    els.progress.textContent = 'Question ' + qn + ' of ' + summary.questionCount + (isFinal ? ' (Final)' : '');
    els.progress.classList.toggle('final-question', isFinal);
    
    updateProgressFill(qn, summary.questionCount);
    if (summary.startedAt) startTimer(summary.startedAt);
  }

  function renderInterview(summary, opts) {
    opts = opts || {};
    lastSummary = summary;

    setInterviewMeta(summary);
    els.aiMessage.textContent = latestAiMessage(summary) || '\u2026';
    renderTranscript(els.transcript, summary.transcript, summary.questionTiming);
    setInterviewStatus('ok', 'In progress. ' + displayPosition(summary));
    document.title = 'AI Interviewer Hotsilog \u2014 ' + displayPosition(summary);

    els.hintBox.classList.add('hidden');
    els.hintBtn.disabled = false;
    els.hintBtn.textContent = 'Ask for a hint';

    if (opts.voice) {
      els.voiceCard.classList.remove('hidden');
      setTalkButton('disabled');
      setChip(els.chipConn, 'active');
      setChip(els.chipAi, '');
      setChip(els.chipCand, '');
      els.voiceHint.textContent = 'Connecting to the AI interviewer\u2026';
      clearCandidateLive();
      setAnswerEnabled(false, 'Voice interview in progress \u2014 no typing needed.');
    } else {
      els.voiceCard.classList.add('hidden');
      setAnswerEnabled(true);
      els.answerInput.focus();
    }
  }

  // --------------------------------------------------------- voice flow

  function startVoiceFlow(interviewId) {
    return new Promise(function (resolve, reject) {
      voice = new VoiceSession({
        ready: function (msg) {
          clearTimeout(timer);
          voiceReady = true;
          voiceSummaryQuestionCount = msg.questionCount;
          UI.saveSession({ interviewId: interviewId, startedAt: msg.startedAt || null, mode: 'voice' });
          if (msg.startedAt) startTimer(msg.startedAt);
          setTalkButton('disabled');
          els.voiceHint.textContent =
            'Press the Talk button when you want to speak, then press End Turn when done. Pauses won\'t interrupt you.';
          resolve(null);
        },
        holding: function (holding) {
          if (!voiceReady || voiceDone) return;
          if (holding) stopAnswerCountdown();
          setVoicePanelSpeaking(holding);
          setTalkButton(holding ? 'active' : 'disabled');
          setChip(els.chipCand, holding ? 'speaking' : '');
          els.voiceHint.textContent = holding
            ? 'Recording\u2026 press End Turn when you finish speaking.'
            : 'Turn ended. Waiting for the AI interviewer\u2026';
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
          setVoicePanelSpeaking(speaking);
          setChip(els.chipAi, speaking ? 'speaking' : '');
          if (speaking) {
            if (voice && voice.isHolding()) {
              setTalkButton('active');
            } else {
              setTalkButton('disabled');
            }
            clearCandidateLive();
            els.voiceHint.textContent = 'The AI interviewer is speaking\u2026';
          } else if (voiceReady && !voiceDone && !assessmentPromptReceived && !assessmentActive()) {
            if (voice && voice.isHolding()) {
              els.voiceHint.textContent =
                'Recording\u2026 press End Turn when you finish speaking.';
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
              els.voiceHint.textContent = 'The interviewer is preparing the next response\u2026';
            }
          } else {
            setChip(els.chipAi, '');
          }
        },
        level: function (rms) {
          if (!voiceReady || voiceDone) return;
          if (voice && voice.isHolding()) {
            setChip(els.chipCand, 'speaking');
            setLevel(rms);
          } else {
            setChip(els.chipCand, '');
            setLevel(0);
          }
        },
        candidateText: function (payload) {
          if (payload.final) {
            setChip(els.chipCand, '');
            setLevel(0);
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
          var total = voiceSummaryQuestionCount || '?';
          var qn = Math.min(payload.questionNumber, voiceSummaryQuestionCount || payload.questionNumber);
          var isFinal = qn >= total;
          els.progress.textContent = 'Question ' + qn + ' of ' + total + (isFinal ? ' (Final)' : '');
          els.progress.classList.toggle('final-question', isFinal);
          updateProgressFill(qn, total === '?' ? 0 : total);
        },
        assessmentPrompt: function () {
          assessmentPromptReceived = true;
          // Automatically trigger assessment evaluation immediately
          chooseAssessment(true);
          // Show the View assessment button in the sidebar, hide coach panel
          var coachPanel = document.getElementById('coach-panel');
          var postCard = document.getElementById('post-interview-card');
          if (coachPanel) coachPanel.classList.add('hidden');
          if (postCard) postCard.classList.remove('hidden');
        },
        complete: function () {
          hideAssessmentPrompt();
          hideAssessmentLoading();
          stopAnswerCountdown();
          setTalkButton('disabled');
          setLevel(0);
          setVoicePanelSpeaking(false);
          // Disappearing talk controls
          if (els.voiceCard) els.voiceCard.classList.add('hidden');
          voiceDone = true;
          voice.end().then(function () {
            finishVoiceComplete(interviewId);
          });
        },
        error: function (payload) {
          stopAnswerCountdown();
          setTalkButton('disabled');
          setLevel(0);
          setVoicePanelSpeaking(false);
          if (!voiceReady) {
            reject(new Error(payload.message || 'Voice failed.'));
          } else {
            setInterviewStatus('error', payload.message || 'Voice connection problem.');
            setChip(els.chipConn, 'error');
            els.voiceHint.textContent = 'Voice ended. Use text mode to continue.';
          }
        },
        wsClosed: function () {
          stopAnswerCountdown();
          setTalkButton('disabled');
          setLevel(0);
          setVoicePanelSpeaking(false);
          if (!voiceReady) {
            reject(new Error('Voice connection could not be established.'));
          } else if (!voiceDone) {
            setInterviewStatus('error', 'Voice connection was lost. Check your internet connection.');
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

  function beginVoice(summary) {
    var interviewId = summary.interviewId;
    renderInterview(summary, { voice: true });
    startVoiceFlow(interviewId)
      .then(function () {
        setInterviewStatus('ok', 'Voice interview started. ' + displayPosition(summary));
        els.progress.textContent = 'Question 1 of ' + summary.questionCount;
        updateProgressFill(1, summary.questionCount);
        els.aiMessage.textContent = 'Connecting\u2026';
        els.voiceCard.classList.remove('hidden');
        setAnswerEnabled(false, 'Voice interview in progress \u2014 no typing needed.');
        els.hintBox.classList.add('hidden');
      })
      .catch(function (err) {
        return fallbackToText(err);
      });
  }

  function fallbackToText(err) {
    var session = UI.loadSession();
    var id = session ? session.interviewId : null;
    if (voice) {
      voice.end();
      voice = null;
    }
    stopAnswerCountdown();
    if (id) {
      return UI.api('/api/interview/' + id + '/text-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then(function (data) {
          UI.saveSession({ interviewId: data.interviewId, startedAt: data.summary.startedAt || null, mode: 'text' });
          renderInterview(data.summary, { voice: false });
          setInterviewStatus('error', (err && err.message ? err.message : '') + ' Continuing in text mode.');
        })
        .catch(function () {
          setInterviewStatus(
            'error',
            (err && err.message ? err.message : 'Could not start the interview.') + ' Try again or use text mode.'
          );
        });
    }
    setInterviewStatus(
      'error',
      (err && err.message ? err.message : 'Could not start the interview.') + ' Try again.'
    );
  }

  // --------------------------------------------------------- text mode

  function sendAnswer() {
    if (voiceReady) return;
    var answer = els.answerInput.value.trim();
    if (!answer) return;

    var session = UI.loadSession();
    if (!session) return;

    var isLastQuestion =
      lastSummary &&
      lastSummary.lastQuestion &&
      lastSummary.questionCount &&
      lastSummary.lastQuestion.number >= lastSummary.questionCount;

    setAnswerEnabled(false);
    if (isLastQuestion) showAssessmentLoading();
    setInterviewStatus(
      'processing',
      isLastQuestion ? 'Finalizing your interview and generating your assessment — this may take a moment.' : 'AI is thinking\u2026'
    );

    UI.api('/api/interview/' + session.interviewId + '/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: answer }),
    })
      .then(function (data) {
        if (data.kind === 'complete') {
          hideAssessmentLoading();
          if (els.voiceCard) els.voiceCard.classList.add('hidden');
          UI.upsertHistory({
            interviewId: data.summary.interviewId,
            position: displayPosition(data.summary),
            date: data.summary.completedAt || Date.now(),
            status: 'completed',
            score: data.summary.evaluation ? Number(data.summary.evaluation.overall) : null,
          });
          location.href = 'results.html?id=' + data.summary.interviewId;
        } else {
          renderInterview(data.summary, { voice: false });
        }
      })
      .catch(function (err) {
        hideAssessmentLoading();
        setAnswerEnabled(true);
        setInterviewStatus('error', err.message || 'Something went wrong.');
        els.answerInput.focus();
      });
  }

  // --------------------------------------------------------- hint

  function requestHint() {
    var session = UI.loadSession();
    if (!session) {
      UI.toast('Start an interview first.');
      return;
    }
    els.hintBtn.disabled = true;
    els.hintBtn.textContent = 'Thinking\u2026';
    UI.api('/api/interview/' + session.interviewId + '/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(function (data) {
        els.hintBox.classList.remove('hidden');
        els.hintBox.innerHTML = '';
        var label = document.createElement('span');
        label.className = 'hint-label';
        label.textContent = 'Coach\u2019s hint';
        var body = document.createElement('p');
        body.textContent = data.hint || '';
        els.hintBox.appendChild(label);
        els.hintBox.appendChild(body);
      })
      .catch(function (err) {
        UI.toast(err.message || 'Could not get a hint right now.');
      })
      .finally(function () {
        els.hintBtn.disabled = false;
        els.hintBtn.textContent = 'Ask for a hint';
      });
  }

  // --------------------------------------------------------- assessment modal

  function assessmentActive() {
    return !els.assessmentModal.classList.contains('hidden');
  }

  function showAssessmentPrompt() {
    stopAnswerCountdown();
    setTalkButton('disabled');
    setLevel(0);
    els.assessmentYes.disabled = false;
    els.assessmentNo.disabled = false;
    els.assessmentModal.classList.remove('hidden');
    els.assessmentYes.focus();
  }

  function hideAssessmentPrompt() {
    els.assessmentModal.classList.add('hidden');
  }

  function showAssessmentLoading() {
    if (els.assessmentLoading) els.assessmentLoading.classList.remove('hidden');
  }

  function hideAssessmentLoading() {
    if (els.assessmentLoading) els.assessmentLoading.classList.add('hidden');
  }

  function chooseAssessment(yes) {
    if (!voice || !voiceReady || voiceDone) return;
    els.assessmentYes.disabled = true;
    els.assessmentNo.disabled = true;
    hideAssessmentPrompt();
    if (yes) {
      stopAnswerCountdown();
      setTalkButton('disabled');
      els.voiceHint.textContent = 'Preparing your assessment\u2026';
      showAssessmentLoading();
      voice.chooseAssessment(yes);
    } else {
      voice.chooseAssessment(false);
      UI.clearSession();
      UI.flash('Interview ended \u2014 no report was generated.');
      location.href = 'index.html';
    }
  }

  function trapModalFocus(e, modal) {
    if (e.key !== 'Tab') return;
    var items = Array.prototype.slice.call(
      modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (n) { return n.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // --------------------------------------------------------- stop voice

  function stopVoice() {
    stopAnswerCountdown();
    setLevel(0);
    setVoicePanelSpeaking(false);
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

  // --------------------------------------------------------- finish voice

  function finishVoiceComplete(interviewId) {
    UI.api('/api/interview/' + interviewId)
      .then(function (summary) {
        UI.upsertHistory({
          interviewId: summary.interviewId,
          position: displayPosition(summary),
          date: summary.completedAt || Date.now(),
          status: 'completed',
          score: summary.evaluation ? Number(summary.evaluation.overall) : null,
        });
        location.href = 'results.html?id=' + summary.interviewId;
      })
      .catch(function (err) {
        console.error('Voice complete failed to load summary:', err && err.message);
        setInterviewStatus('error', 'The interview is complete, but results could not be loaded.');
      });
  }

  // --------------------------------------------------------- init

  function initPage() {
    if (!(window.Auth && window.Auth.isLoggedIn())) {
      UI.clearSession();
      UI.flash('Sign in to access interviews.');
      location.href = 'login.html';
      return;
    }

    var params = new URLSearchParams(location.search);
    var id = params.get('id');
    var session = UI.loadSession();
    if (!id && session) id = session.interviewId;
    if (!id) {
      location.href = 'index.html';
      return;
    }

    Promise.all([
      UI.api('/api/status').catch(function () { return { gemini: {} }; }),
      UI.api('/api/interview/' + id),
    ])
      .then(function (results) {
        var status = results[0] || {};
        var summary = results[1];
        appVoiceAvailable = !!(status.gemini && status.gemini.voiceAvailable);
        if (status.gemini && status.gemini.configured === false) UI.setTopState('error', 'No API key');

        UI.saveSession({ interviewId: id, startedAt: summary.startedAt || null, mode: (session && session.mode) || 'text' });
        if (summary.status === 'completed') {
          location.href = 'results.html?id=' + summary.interviewId;
          return;
        }

        var isVoiceBootstrap = params.get('voice') === '1' && session && session.mode === 'voice' && !summary.startedAt;
        if (isVoiceBootstrap) {
          if (appVoiceAvailable) {
            beginVoice(summary);
          } else {
            fallbackToText(new Error('Voice is not available on this setup.'));
          }
          return;
        }

        if (!summary.transcript || !summary.transcript.length) {
          UI.clearSession();
          location.href = 'index.html';
          return;
        }
        renderInterview(summary, { voice: false });
      })
      .catch(function (err) {
        console.error('Failed to load interview:', err && err.message);
        UI.clearSession();
        UI.flash('Could not load your interview' + (err && err.message ? ': ' + err.message : '.'));
        location.href = 'index.html';
      });
  }

  // --------------------------------------------------------- wiring

  els.sendBtn.addEventListener('click', sendAnswer);
  els.talkBtn.addEventListener('click', toggleTalk);
  els.voiceBtn.addEventListener('click', stopVoice);
  els.hintBtn.addEventListener('click', requestHint);
  els.restartBtn.addEventListener('click', function () {
    if (window.confirm('Restart the interview from the beginning? Your current progress will be lost.')) {
      UI.clearSession();
      location.href = 'index.html';
    }
  });
  if (els.topNewBtn) {
    els.topNewBtn.addEventListener('click', function () {
      if (window.confirm('Start a new session? Your current progress will be lost.')) {
        UI.clearSession();
        location.href = 'index.html';
      }
    });
  }
  els.assessmentYes.addEventListener('click', function () { chooseAssessment(true); });
  els.assessmentNo.addEventListener('click', function () { chooseAssessment(false); });
  if (els.assessmentModal) {
    els.assessmentModal.addEventListener('keydown', function (e) {
      trapModalFocus(e, els.assessmentModal);
    });
  }

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
    autoGrow(els.answerInput);
    updateAnswerCount();
  });

  // Space = talk / end turn (voice mode only, when not typing in a field)
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' && e.code !== 'Space') return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (!voiceReady || voiceDone) return;
    e.preventDefault();
    toggleTalk();
  });

  try {
    initPage();
  } catch (err) {
    console.error('Interview page init failed:', err && err.message);
    if (els.interviewStatus) {
      els.interviewStatus.classList.remove('hidden');
      UI.setBanner(els.interviewStatus, 'processing', 'Finalizing your interview and generating your assessment — this may take a moment.');
    }
  }
})();