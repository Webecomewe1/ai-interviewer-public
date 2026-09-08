/**
 * @typedef {Object} UserSession
 * @property {string} interviewId
 * @property {number|null} startedAt
 * @property {string} mode
 */

/**
 * @typedef {Object} HistoryEntry
 * @property {string} interviewId
 * @property {string} position
 * @property {number} date
 * @property {string} status
 * @property {number|null} score
 */

/**
 * @typedef {Object} ServerStatus
 * @property {boolean} ok
 * @property {Object} gemini
 * @property {boolean} gemini.configured
 * @property {string} gemini.model
 * @property {string|null} gemini.liveModel
 * @property {boolean} gemini.voiceAvailable
 * @property {Object} auth
 * @property {boolean} auth.configured
 */

/**
 * @typedef {Object} InterviewSummary
 * @property {string} interviewId
 * @property {string} position
 * @property {string|null} customPosition
 * @property {string} interviewType
 * @property {string} difficulty
 * @property {number} questionCount
 * @property {string} status
 * @property {number} createdAt
 * @property {number|null} startedAt
 * @property {number|null} completedAt
 * @property {Array<{number:number,text:string,isFollowUp:boolean,difficulty:string,source:string}>} questions
 * @property {Array<{role:string,text:string}>} transcript
 * @property {Object|null} evaluation
 * @property {Object|null} stats
 * @property {Array<Object>} questionTiming
 * @property {Object|null} lastQuestion
 */

(function () {
  'use strict';

  var THEME_KEY = 'ai-interviewer:theme';
  var HISTORY_KEY = 'ai-interviewer:history';
  var SESSION_KEY = 'ai-interviewer:session';
  var FLASH_KEY = 'ai-interviewer:flash';

  /**
   * @type {{
   *   themeToggle: HTMLElement|null,
   *   topNewBtn: HTMLElement|null,
   *   topConnection: HTMLElement|null,
   *   topConnectionText: HTMLElement|null,
   *   authUserChip: HTMLElement|null,
   *   authUserAvatar: HTMLElement|null,
   *   authUserName: HTMLElement|null,
   *   logoutBtn: HTMLElement|null,
   *   authOpenBtn: HTMLElement|null
   * }}
   */
  var els = {
    themeToggle: document.getElementById('theme-toggle'),
    topNewBtn: document.getElementById('top-new-btn'),
    topConnection: document.getElementById('top-connection'),
    topConnectionText: document.getElementById('top-connection-text'),
    authUserChip: document.getElementById('auth-user-chip'),
    authUserAvatar: document.getElementById('auth-user-avatar'),
    authUserName: document.getElementById('auth-user-name'),
    logoutBtn: document.getElementById('logout-btn'),
    authOpenBtn: document.getElementById('auth-open-btn'),
  };

  // --------------------------------------------------------- helpers

  function api(path, options) {
    var opts = options || {};
    var token = window.Auth ? window.Auth.getToken() : null;
    if (token) {
      opts.headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
    }
    return fetch(path, opts).then(function (res) {
      if (res.status === 401 && token) {
        try { window.Auth.logout(); } catch (e) {}
      }
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

  function titleCase(value) {
    var s = String(value || '');
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function formatTime(totalSeconds) {
    var m = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    var s = String(Math.floor(totalSeconds % 60)).padStart(2, '0');
    return m + ':' + s;
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '';
    var totalSec = Math.round(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    if (m <= 0) return s + 's';
    return m + 'm ' + s + 's';
  }

  function toast(message) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  function setBanner(el, state, message) {
    if (!el) return;
    el.classList.remove('ok', 'error', 'processing');
    if (state) el.classList.add(state);
    var dot = el.querySelector('.status-dot');
    if (dot) dot.className = 'status-dot';
    var text = el.querySelector('.status-text');
    if (text) text.textContent = message;
  }

  function setTopState(state, message) {
    if (!els.topConnection || !els.topConnectionText) return;
    els.topConnection.classList.remove('ok', 'error');
    if (state) els.topConnection.classList.add(state);
    els.topConnectionText.textContent = message;
  }

  // --------------------------------------------------------- theme

  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* ignore */ }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    var mode = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(mode);
  }

  if (els.themeToggle) {
    els.themeToggle.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      applyTheme(cur);
    });
  }

  // --------------------------------------------------------- flash messages

  function flash(message) {
    try { sessionStorage.setItem(FLASH_KEY, message); } catch (e) { /* ignore */ }
  }

  function consumeFlash() {
    try {
      var m = sessionStorage.getItem(FLASH_KEY);
      if (m) {
        sessionStorage.removeItem(FLASH_KEY);
        return m;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // --------------------------------------------------------- history (write side)

  function _loadLocalHistory() {
    try {
      var list = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20))); } catch (e) { /* ignore */ }
  }

  function upsertHistory(entry) {
    if (window.Auth && window.Auth.isLoggedIn()) {
      if (typeof UI.renderHistory === 'function') UI.renderHistory();
      return;
    }
    var list = _loadLocalHistory();
    var idx = list.findIndex(function (h) { return h.interviewId === entry.interviewId; });
    if (idx >= 0) list[idx] = entry; else list.unshift(entry);
    saveHistory(list);
    if (typeof UI.renderHistory === 'function') UI.renderHistory();
  }

  // --------------------------------------------------------- session store

  function saveSession(data) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(data || {})); } catch (e) { /* ignore */ }
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  // --------------------------------------------------------- auth UI

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'AI';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function applyAuthUi() {
    var loggedIn = window.Auth && window.Auth.isLoggedIn();
    if (els.authUserChip) els.authUserChip.classList.toggle('hidden', !loggedIn);
    if (els.logoutBtn) els.logoutBtn.classList.toggle('hidden', !loggedIn);
    if (els.authOpenBtn) els.authOpenBtn.classList.toggle('hidden', loggedIn);
    if (loggedIn) {
      var user = window.Auth.parseUser(window.Auth.getToken());
      if (els.authUserName) els.authUserName.textContent = (user && user.name) || 'Signed in';
      if (els.authUserAvatar) els.authUserAvatar.textContent = initials(user && user.name);
    }
    if (typeof UI.renderHistory === 'function') UI.renderHistory();
  }

  function initAuth() {
    if (!(window.Auth && window.Auth.isLoggedIn())) {
      applyAuthUi();
      return;
    }
    api('/api/auth/me').then(function (data) {
      if (!data.authenticated) {
        window.Auth.logout();
      }
      applyAuthUi();
    }).catch(function () {
      applyAuthUi();
    });
  }

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', function () {
      window.Auth.logout();
      applyAuthUi();
      toast('Signed out.');
    });
  }

  // --------------------------------------------------------- exports

  window.UI = {
    api: api,
    titleCase: titleCase,
    formatTime: formatTime,
    formatDuration: formatDuration,
    toast: toast,
    setBanner: setBanner,
    setTopState: setTopState,
    initTheme: initTheme,
    applyAuthUi: applyAuthUi,
    initAuth: initAuth,
    saveSession: saveSession,
    loadSession: loadSession,
    clearSession: clearSession,
    upsertHistory: upsertHistory,
    _loadLocalHistory: _loadLocalHistory,
    saveHistory: saveHistory,
    flash: flash,
    consumeFlash: consumeFlash,
    renderHistory: null,
  };

  initTheme();

  var flashMsg = consumeFlash();
  if (flashMsg) {
    setTimeout(function () { toast(flashMsg); }, 120);
  }

  initAuth();

  // --------------------------------------------------------- global error surface

  window.addEventListener('error', function (e) {
    console.error('Uncaught error:', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', function (e) {
    console.error('Unhandled rejection:', e.reason || e);
  });
})();