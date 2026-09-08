(function () {
  'use strict';

  var UI = window.UI;
  var SETUP_KEY = 'ai-interviewer:setup';

  var els = {
    topNewBtn: document.getElementById('top-new-btn'),
    serverStatus: document.getElementById('server-status'),
    setupForm: document.getElementById('setup-form'),
    startBtn: document.getElementById('start-btn'),
    textBtn: document.getElementById('text-btn'),
    position: document.getElementById('position'),
    customPositionField: document.getElementById('custom-position-field'),
    customPosition: document.getElementById('custom-position'),
    interviewType: document.getElementById('interview-type'),
    difficulty: document.getElementById('difficulty'),
    questionCount: document.getElementById('question-count'),
    customCountField: document.getElementById('custom-count-field'),
    customCount: document.getElementById('custom-count'),
    resume: document.getElementById('resume'),
    jobDescription: document.getElementById('job-description'),
    companyInfo: document.getElementById('company-info'),
    historyCard: document.getElementById('history-card'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    historyList: document.getElementById('history-list'),
    modeVoice: document.getElementById('mode-voice'),
    modeText: document.getElementById('mode-text'),
    autosaveHint: document.getElementById('autosave-hint'),
  };

  var selectedMode = 'voice';
  var appVoiceAvailable = false;

  // --------------------------------------------------------- mode picker

  function setSelectedMode(mode) {
    selectedMode = mode === 'text' ? 'text' : 'voice';
    if (els.modeVoice) {
      els.modeVoice.classList.toggle('active', selectedMode === 'voice');
      els.modeVoice.setAttribute('aria-checked', selectedMode === 'voice' ? 'true' : 'false');
    }
    if (els.modeText) {
      els.modeText.classList.toggle('active', selectedMode === 'text');
      els.modeText.setAttribute('aria-checked', selectedMode === 'text' ? 'true' : 'false');
    }
  }

  function initModePicker() {
    if (els.modeVoice) els.modeVoice.addEventListener('click', function () { setSelectedMode('voice'); });
    if (els.modeText) els.modeText.addEventListener('click', function () { setSelectedMode('text'); });
  }

  function initPicker(groupId, selectEl) {
    var group = document.getElementById(groupId);
    if (!group || !selectEl) return;
    var chips = group.querySelectorAll('.chip-option, .seg-option');
    function sync() {
      chips.forEach(function (c) {
        c.classList.toggle('active', c.dataset.value === selectEl.value);
      });
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        selectEl.value = c.dataset.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      });
    });
    selectEl.addEventListener('change', sync);
    sync();
  }

  // --------------------------------------------------------- context autosave

  function saveSetupContext() {
    var ctx = {
      position: els.position.value,
      interviewType: els.interviewType.value,
      difficulty: els.difficulty.value,
      questionCount: els.questionCount.value,
      customPosition: els.customPosition.value,
      customCount: els.customCount.value,
      resume: els.resume.value,
      jobDescription: els.jobDescription.value,
      companyInfo: els.companyInfo.value,
    };
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(ctx)); } catch (e) { /* ignore */ }
    if (els.autosaveHint) {
      els.autosaveHint.classList.add('visible');
      clearTimeout(els.autosaveHint._t);
      els.autosaveHint._t = setTimeout(function () {
        els.autosaveHint.classList.remove('visible');
      }, 1600);
    }
  }

  function loadSetupContext() {
    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem(SETUP_KEY)) || null; } catch (e) { ctx = null; }
    if (!ctx || !els.position) return;
    if (ctx.position && els.position.querySelector('option[value="' + ctx.position + '"]')) els.position.value = ctx.position;
    if (ctx.interviewType && els.interviewType.querySelector('option[value="' + ctx.interviewType + '"]')) els.interviewType.value = ctx.interviewType;
    if (ctx.difficulty && els.difficulty.querySelector('option[value="' + ctx.difficulty + '"]')) els.difficulty.value = ctx.difficulty;
    if (ctx.questionCount && els.questionCount.querySelector('option[value="' + ctx.questionCount + '"]')) els.questionCount.value = ctx.questionCount;
    if (ctx.customPosition) els.customPosition.value = ctx.customPosition;
    if (ctx.customCount) els.customCount.value = String(ctx.customCount);
    if (ctx.resume) els.resume.value = ctx.resume;
    if (ctx.jobDescription) els.jobDescription.value = ctx.jobDescription;
    if (ctx.companyInfo) els.companyInfo.value = ctx.companyInfo;
  }

  function wireContextAutosave() {
    [els.position, els.interviewType, els.difficulty, els.questionCount, els.customPosition, els.customCount, els.resume, els.jobDescription, els.companyInfo].forEach(function (f) {
      if (!f) return;
      f.addEventListener('change', saveSetupContext);
      f.addEventListener('input', saveSetupContext);
    });
  }

  // --------------------------------------------------------- server status

  function toggleCustomFields() {
    els.customPositionField.classList.toggle('hidden', els.position.value !== 'Custom Position');
    els.customCountField.classList.toggle('hidden', els.questionCount.value !== 'custom');
  }

  function checkServerStatus() {
    UI.api('/api/status')
      .then(function (data) {
        appVoiceAvailable = !!data.gemini.voiceAvailable;
        if (!appVoiceAvailable) setSelectedMode('text');
        if (data.gemini.configured) {
          var voiceNote = appVoiceAvailable
            ? ' Voice: ' + (data.gemini.liveModel || 'on')
            : ' Voice is not available on this setup; text mode will be used.';
          UI.setBanner(
            els.serverStatus,
            'ok',
            'Connected. AI model: ' + data.gemini.model + '.' + voiceNote
          );
          UI.setTopState('ok', 'Connected');
          els.startBtn.disabled = false;
        } else {
          UI.setBanner(
            els.serverStatus,
            'error',
            'Connected, but GEMINI_API_KEY is missing. Add it to .env and restart the server.'
          );
          UI.setTopState('error', 'No API key');
          els.startBtn.disabled = true;
        }
      })
      .catch(function (err) {
        console.error('Server status check failed:', err && err.message);
        UI.setBanner(els.serverStatus, 'error', 'Cannot connect to server. Is it running?');
        UI.setTopState('error', 'Offline');
        els.startBtn.disabled = true;
      });
  }

  // --------------------------------------------------------- config

  function collectConfig() {
    var config = {
      position: els.position.value,
      interviewType: els.interviewType.value,
      difficulty: els.difficulty.value,
      questionCount: els.questionCount.value,
      resume: els.resume.value.trim(),
      jobDescription: els.jobDescription.value.trim(),
      companyInfo: els.companyInfo.value.trim(),
    };
    if (config.position === 'Custom Position') {
      config.customPosition = els.customPosition.value.trim();
    }
    if (config.questionCount === 'custom') {
      config.questionCount = Number(els.customCount.value || 10);
    } else {
      config.questionCount = Number(config.questionCount);
    }
    return config;
  }

  function setBusy(busy) {
    els.startBtn.disabled = busy;
    els.startBtn.textContent = busy ? 'Starting\u2026' : 'Start interview';
  }

  function displayPosition(summary) {
    return summary && summary.customPosition && summary.position === 'Custom Position'
      ? summary.customPosition
      : (summary ? summary.position : '');
  }

  // --------------------------------------------------------- starting

  function requireLogin() {
    if (window.Auth && window.Auth.isLoggedIn()) return true;
    UI.flash('Sign in to start an interview.');
    location.href = 'login.html';
    return false;
  }

  function startInterview() {
    if (!requireLogin()) return;
    var config = collectConfig();
    if (!appVoiceAvailable) {
      setSelectedMode('text');
      config.mode = 'text';
      UI.setBanner(els.serverStatus, 'error', 'Voice is not available on this setup. Starting in text mode.');
      return textModeStart(config);
    }
    config.mode = 'voice';
    setBusy(true);
    UI.setBanner(els.serverStatus, 'processing', 'Starting the AI interviewer\u2026');

    UI.api('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(function (data) {
        UI.saveSession({ interviewId: data.interviewId, startedAt: null, mode: 'voice' });
        UI.upsertHistory({
          interviewId: data.interviewId,
          position: displayPosition(data.summary),
          date: Date.now(),
          status: 'in_progress',
          score: null,
        });
        location.href = 'interview.html?voice=1';
      })
      .catch(function (err) {
        setBusy(false);
        UI.setBanner(
          els.serverStatus,
          'error',
          (err && err.message ? err.message : 'Could not start the interview.') + ' Try again or use text mode.'
        );
      });
  }

  function textModeStart(forceConfig) {
    if (!requireLogin()) return;
    var config = forceConfig || collectConfig();
    config.mode = 'text';
    setBusy(true);
    UI.setBanner(els.serverStatus, 'processing', 'Starting the interview\u2026');
    UI.api('/api/interview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(function (data) {
        UI.saveSession({ interviewId: data.interviewId, startedAt: data.summary.startedAt || null, mode: 'text' });
        UI.upsertHistory({
          interviewId: data.interviewId,
          position: displayPosition(data.summary),
          date: Date.now(),
          status: 'in_progress',
          score: null,
        });
        location.href = 'interview.html';
      })
      .catch(function (err) {
        setBusy(false);
        UI.setBanner(els.serverStatus, 'error', (err && err.message) || 'Could not start the interview.');
      });
  }

  // --------------------------------------------------------- history

  function renderHistory() {
    var list = (window.Auth && window.Auth.isLoggedIn()) ? [] : UI._loadLocalHistory();
    if (window.Auth && window.Auth.isLoggedIn()) {
      loadServerHistory().then(function (serverList) {
        _renderHistoryItems(serverList);
      });
    } else {
      _renderHistoryItems(list);
    }
  }

  function loadServerHistory() {
    return UI.api('/api/me/sessions').then(function (data) {
      return Array.isArray(data.sessions) ? data.sessions : [];
    }).catch(function () {
      return UI._loadLocalHistory();
    });
  }

  function _renderHistoryItems(list) {
    if (!els.historyCard || !els.historyList) return;
    if (!list.length) {
      els.historyCard.classList.add('hidden');
      return;
    }
    els.historyCard.classList.remove('hidden');
    els.historyList.innerHTML = '';
    list.forEach(function (entry) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item';
      var main = document.createElement('span');
      main.className = 'hi-main';
      var title = document.createElement('span');
      title.className = 'hi-title';
      title.textContent = entry.position || 'Interview';
      var meta = document.createElement('span');
      meta.className = 'hi-meta';
      var when = entry.date ? new Date(entry.date).toLocaleString() : '';
      meta.textContent = when + (entry.status === 'completed' ? ' · completed' : ' · in progress');
      main.appendChild(title);
      main.appendChild(meta);
      var score = document.createElement('span');
      score.className = 'hi-score';
      score.textContent = entry.score != null ? entry.score + '/10' : 'view';
      btn.appendChild(main);
      btn.appendChild(score);
      btn.addEventListener('click', function () { openHistoryEntry(entry); });
      els.historyList.appendChild(btn);
    });
  }

  function openHistoryEntry(entry) {
    if (!requireLogin()) return;
    UI.api('/api/interview/' + entry.interviewId)
      .then(function (summary) {
        if (summary.status === 'completed') {
          UI.saveSession({ interviewId: summary.interviewId, startedAt: summary.startedAt || null, mode: 'text' });
          location.href = 'results.html?id=' + summary.interviewId;
        } else if (summary.transcript && summary.transcript.length) {
          UI.saveSession({ interviewId: summary.interviewId, startedAt: summary.startedAt || null, mode: 'text' });
          location.href = 'interview.html?id=' + summary.interviewId;
        } else {
          UI.clearSession();
          UI.toast('That session has no content to show yet.');
        }
      })
      .catch(function (err) {
        console.error('Failed to open history entry:', err && err.message);
        UI.toast('That session is no longer available (the server was restarted).');
      });
  }

  UI.renderHistory = renderHistory;

  // --------------------------------------------------------- wiring

  els.setupForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (selectedMode === 'text') {
      textModeStart();
    } else {
      startInterview();
    }
  });
  els.textBtn.addEventListener('click', function (e) {
    e.preventDefault();
    textModeStart();
  });
  els.position.addEventListener('change', toggleCustomFields);
  els.questionCount.addEventListener('change', toggleCustomFields);
  if (els.clearHistoryBtn) {
    els.clearHistoryBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      UI.saveHistory([]);
      if (window.Auth && window.Auth.isLoggedIn()) {
        UI.api('/api/me/sessions', { method: 'DELETE' })
          .then(function () {
            renderHistory();
            UI.toast('History cleared.');
          })
          .catch(function () {
            renderHistory();
            UI.toast('History cleared.');
          });
      } else {
        renderHistory();
        UI.toast('History cleared.');
      }
    });
  }
  if (els.topNewBtn) {
    els.topNewBtn.addEventListener('click', function () {
      UI.clearSession();
      location.reload();
    });
  }

  // --------------------------------------------------------- init

  loadSetupContext();
  toggleCustomFields();
  initPicker('position-chips', els.position);
  initPicker('type-chips', els.interviewType);
  initPicker('difficulty-chips', els.difficulty);
  initPicker('count-chips', els.questionCount);
  initModePicker();
  wireContextAutosave();
  checkServerStatus();
  renderHistory();

  // Auto-resume: if a session is still in progress, take the user back to it.
  (function resumeIfActive() {
    if (!(window.Auth && window.Auth.isLoggedIn())) return;
    var session = UI.loadSession();
    if (!session || !session.interviewId) return;
    UI.api('/api/interview/' + session.interviewId)
      .then(function (data) {
        if (data.status === 'completed') {
          location.href = 'results.html?id=' + data.interviewId;
        } else if (data.transcript && data.transcript.length) {
          location.href = 'interview.html?id=' + session.interviewId;
        } else {
          UI.clearSession();
        }
      })
      .catch(function (err) {
        console.error('Resume check failed:', err && err.message);
        UI.clearSession();
      });
  })();
})();