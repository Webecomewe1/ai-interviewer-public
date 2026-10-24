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
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedOptions: document.getElementById('advanced-options'),
  };

  var selectedMode = 'voice';
  var appVoiceAvailable = false;
  var serviceReady = false;

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
    if (els.modeVoice) els.modeVoice.tabIndex = selectedMode === 'voice' ? 0 : -1;
    if (els.modeText) els.modeText.tabIndex = selectedMode === 'text' ? 0 : -1;
    updateSessionPreview();
  }

  function initModePicker() {
    if (els.modeVoice) els.modeVoice.addEventListener('click', function () { setSelectedMode('voice'); saveSetupContext(); });
    if (els.modeText) els.modeText.addEventListener('click', function () { setSelectedMode('text'); saveSetupContext(); });
    [els.modeVoice, els.modeText].forEach(function (button) {
      button.addEventListener('keydown', function (event) {
        if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].indexOf(event.key) < 0) return;
        event.preventDefault();
        var next = selectedMode === 'voice' || !appVoiceAvailable ? 'text' : 'voice';
        setSelectedMode(next);
        (next === 'voice' ? els.modeVoice : els.modeText).focus();
        saveSetupContext();
      });
    });
  }

  // --------------------------------------------------------- advanced toggle

  function initAdvancedToggle() {
    if (!els.advancedToggle || !els.advancedOptions) return;
    
    els.advancedToggle.addEventListener('click', function () {
      var isExpanded = els.advancedToggle.getAttribute('aria-expanded') === 'true';
      var newState = !isExpanded;
      
      els.advancedToggle.setAttribute('aria-expanded', newState ? 'true' : 'false');
      
      if (newState) {
        els.advancedOptions.classList.remove('collapsed', 'collapsing');
        els.advancedOptions.classList.add('expanded');
      } else {
        els.advancedOptions.classList.add('collapsed');
        els.advancedOptions.classList.remove('expanded');
      }
    });
  }

  function initPicker(groupId, selectEl) {
    var group = document.getElementById(groupId);
    if (!group || !selectEl) return;
    var chips = group.querySelectorAll('.chip-option, .seg-option');
    function sync() {
      chips.forEach(function (c) {
        c.classList.toggle('active', c.dataset.value === selectEl.value);
        c.setAttribute('aria-pressed', String(c.dataset.value === selectEl.value));
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
      mode: selectedMode,
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
    var saved = true;
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(ctx)); } catch (e) { saved = false; }
    if (els.autosaveHint) {
      els.autosaveHint.textContent = saved ? 'Settings saved on this device' : 'Settings could not be saved on this device';
      els.autosaveHint.classList.add('visible');
      clearTimeout(els.autosaveHint._t);
      els.autosaveHint._t = setTimeout(function () {
        els.autosaveHint.classList.remove('visible');
      }, 1600);
    }
    updateSessionPreview();
  }

  function loadSetupContext() {
    var ctx = null;
    try { ctx = JSON.parse(localStorage.getItem(SETUP_KEY)) || null; } catch (e) { ctx = null; }
    if (!ctx || !els.position) return;
    function restore(select, value) {
      if (Array.from(select.options).some(function (option) { return option.value === value; })) select.value = value;
    }
    restore(els.position, ctx.position);
    restore(els.interviewType, ctx.interviewType);
    restore(els.difficulty, ctx.difficulty);
    restore(els.questionCount, ctx.questionCount);
    if (ctx.mode) setSelectedMode(ctx.mode);
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
    els.customPosition.required = els.position.value === 'Custom Position';
    els.customCount.required = els.questionCount.value === 'custom';
    els.customCount.disabled = els.questionCount.value !== 'custom';
    updateSessionPreview();
  }

  function updateSessionPreview() {
    var preview = document.getElementById('session-preview');
    if (!preview) return;
    var count = els.questionCount.value === 'custom' ? els.customCount.value : els.questionCount.value;
    preview.textContent = count + (Number(count) === 1 ? ' question' : ' questions') + ' / ' + UI.titleCase(els.difficulty.value) + ' / ' + UI.titleCase(els.interviewType.value) + ' / ' + UI.titleCase(selectedMode);
    document.querySelectorAll('[data-preset]').forEach(function (button) {
      var preset = button.dataset.preset;
      var matches = els.interviewType.value === (preset === 'starter' ? 'mixed' : preset) && els.difficulty.value === (preset === 'starter' ? 'beginner' : 'intermediate') && els.questionCount.value === (preset === 'technical' ? '10' : '5');
      button.setAttribute('aria-pressed', String(matches));
    });
  }

  function checkServerStatus() {
    serviceReady = false;
    els.startBtn.disabled = true;
    els.textBtn.disabled = true;
    var retry = document.getElementById('retry-connection');
    if (retry) retry.classList.add('hidden');
    UI.setBanner(els.serverStatus, 'processing', 'Checking the interview service...');
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    UI.api('/api/status', { signal: controller.signal })
      .then(function (data) {
        appVoiceAvailable = !!(data.gemini && data.gemini.voiceAvailable);
        els.modeVoice.disabled = !appVoiceAvailable;
        els.modeVoice.querySelector('.mode-desc').textContent = appVoiceAvailable ? 'Talk with the AI interviewer' : 'Unavailable right now; use text';
        if (!appVoiceAvailable) setSelectedMode('text');
        if (data.gemini && data.gemini.configured) {
          var voiceNote = appVoiceAvailable
            ? 'Voice and text practice are ready.'
            : 'Text practice is ready. Voice is currently unavailable.';
          UI.setBanner(
            els.serverStatus,
            'ok',
            voiceNote
          );
          UI.setTopState('ok', 'Connected');
          els.startBtn.disabled = false;
          els.textBtn.disabled = false;
          serviceReady = true;
        } else {
          UI.setBanner(
            els.serverStatus,
            'error',
            'AI practice is not configured yet. You can still try the sample warm-up.'
          );
          UI.setTopState('error', 'AI unavailable');
          els.startBtn.disabled = true;
          if (retry) retry.classList.remove('hidden');
        }
      })
      .catch(function (err) {
        console.error('Server status check failed:', err && err.message);
        UI.setBanner(els.serverStatus, 'error', 'AI practice is temporarily unreachable. Try again or use the sample warm-up.');
        UI.setTopState('error', 'Offline');
        els.startBtn.disabled = true;
        if (retry) retry.classList.remove('hidden');
      }).finally(function () { clearTimeout(timeout); });
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
    els.startBtn.disabled = busy || !serviceReady;
    els.textBtn.disabled = busy || !serviceReady;
    els.setupForm.setAttribute('aria-busy', String(busy));
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
    saveSetupContext();
    UI.flash('Sign in to start an interview.');
    location.href = 'login.html';
    return false;
  }

  function startInterview() {
    if (!serviceReady || !validateSetup()) return;
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
    if (!serviceReady || !validateSetup()) return;
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

  function validateSetup() {
    if (els.position.value === 'Custom Position' && !els.customPosition.value.trim()) {
      els.customPosition.setCustomValidity('Enter the role you want to practice for.');
    } else {
      els.customPosition.setCustomValidity('');
    }
    if (!els.setupForm.checkValidity()) {
      if (els.advancedToggle.getAttribute('aria-expanded') !== 'true' && els.questionCount.value === 'custom') els.advancedToggle.click();
      els.setupForm.reportValidity();
      return false;
    }
    return true;
  }

  els.customPosition.addEventListener('input', function () { els.customPosition.setCustomValidity(''); });
  document.querySelectorAll('[data-preset]').forEach(function (button) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', function () {
      var preset = button.dataset.preset;
      els.interviewType.value = preset === 'starter' ? 'mixed' : preset;
      els.difficulty.value = preset === 'starter' ? 'beginner' : 'intermediate';
      els.questionCount.value = preset === 'technical' ? '10' : '5';
      [els.interviewType, els.difficulty, els.questionCount].forEach(function (field) { field.dispatchEvent(new Event('change', { bubbles: true })); });
      document.querySelectorAll('[data-preset]').forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
      UI.toast('Practice focus updated. Your role and context are kept.');
    });
  });
  document.getElementById('retry-connection').addEventListener('click', checkServerStatus);
  document.getElementById('forget-context').addEventListener('click', function () {
    try { localStorage.removeItem(SETUP_KEY); } catch (e) {
      UI.toast('Could not clear saved context. Check your browser storage settings.');
      return;
    }
    els.resume.value = '';
    els.jobDescription.value = '';
    els.companyInfo.value = '';
    els.customPosition.value = '';
    els.customPosition.setCustomValidity('');
    els.autosaveHint.textContent = 'Saved context cleared from this device';
    UI.toast('Setup draft cleared. Account sessions are unchanged.');
  });

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
    setSelectedMode('text');
    saveSetupContext();
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
            UI.toast('Could not clear account history. Please try again.');
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
  setSelectedMode(selectedMode);
  els.textBtn.disabled = true;
  if (window.Auth && window.Auth.isLoggedIn()) document.getElementById('signin-hint').textContent = 'Your session and feedback will be saved to your account.';
  toggleCustomFields();
  initPicker('position-chips', els.position);
  initPicker('type-chips', els.interviewType);
  initPicker('difficulty-chips', els.difficulty);
  initPicker('count-chips', els.questionCount);
  initModePicker();
  initAdvancedToggle();
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
