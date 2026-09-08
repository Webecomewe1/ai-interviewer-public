(function () {
  'use strict';

  var TOKEN_KEY = 'ai-interviewer:auth';

  window.Auth = {
    getToken: function () {
      try {
        var t = localStorage.getItem(TOKEN_KEY);
        return t || null;
      } catch (e) { return null; }
    },

    storeToken: function (token) {
      try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    },

    logout: function () {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    },

    isLoggedIn: function () {
      return Boolean(window.Auth.getToken());
    },

    parseUser: function (token) {
      try {
        var payload = token.split('.')[1];
        var decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        var obj = JSON.parse(decoded);
        return { id: obj.sub, email: obj.email, name: obj.name || '' };
      } catch (e) {
        return null;
      }
    },

    authRequest: function (path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            throw new Error(data.error || 'Something went wrong. Please try again.');
          }
          return data;
        });
      });
    },

    login: function (email, password) {
      return window.Auth.authRequest('/api/auth/login', { email: email, password: password })
        .then(function (data) {
          if (data.needsVerification) {
            return data;
          }
          window.Auth.storeToken(data.token);
          return data;
        });
    },

    signup: function (name, email, password) {
      return window.Auth.authRequest('/api/auth/signup', { name: name, email: email, password: password })
        .then(function (data) {
          return data;
        });
    },

    verifyOtp: function (email, code) {
      return window.Auth.authRequest('/api/auth/verify-otp', { email: email, code: code })
        .then(function (data) {
          if (data.token) {
            window.Auth.storeToken(data.token);
          }
          return data;
        });
    },

    resendOtp: function (email) {
      return window.Auth.authRequest('/api/auth/resend-otp', { email: email });
    },
  };
})();