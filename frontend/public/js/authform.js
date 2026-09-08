(function () {
  'use strict';

  var UI = window.UI;

  if (window.Auth && window.Auth.isLoggedIn()) {
    location.replace('index.html');
    return;
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'Please wait\u2026' : (btn.dataset.label || 'Submit');
  }

  function showToast(msg) {
    UI.toast(msg);
  }

  function showForm(formId) {
    var registerForm = document.getElementById('register-form');
    var verifyForm = document.getElementById('verify-form');
    if (registerForm) registerForm.classList.add('hidden');
    if (verifyForm) verifyForm.classList.add('hidden');
    var target = document.getElementById(formId);
    if (target) target.classList.remove('hidden');
  }

  function startResendCountdown(btn) {
    btn.disabled = true;
    var seconds = 60;
    btn.textContent = seconds + 's';
    var timer = setInterval(function () {
      seconds--;
      if (seconds > 0) {
        btn.textContent = seconds + 's';
      } else {
        clearInterval(timer);
        btn.disabled = false;
        btn.textContent = 'Resend code';
      }
    }, 1000);
  }

  var loginForm = document.getElementById('login-form');
  var registerForm = document.getElementById('register-form');
  var verifyForm = document.getElementById('verify-form');
  var verifyCodeInput = document.getElementById('verify-code');

  if (loginForm) {
    var loginBtn = document.getElementById('login-btn');
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (loginBtn.disabled) return;
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      if (!email || !password) {
        showToast('Please enter your email and password.');
        return;
      }
      setBusy(loginBtn, true);
      window.Auth.login(email, password)
        .then(function (data) {
          if (data.needsVerification) {
            UI.flash('Please verify your email to continue.');
            setBusy(loginBtn, false);
            showForm('verify-form');
            if (verifyCodeInput) verifyCodeInput.value = '';
            showToast('Please verify your email to access the interview service. Code sent to ' + data.email);
            return;
          }
          UI.flash('Signed in. Welcome back!');
          location.href = 'index.html';
        })
        .catch(function (err) {
          setBusy(loginBtn, false);
          showToast((err && err.message) || 'Could not sign you in.');
        });
    });
  }

  if (registerForm) {
    var registerBtn = document.getElementById('register-btn');
    registerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (registerBtn.disabled) return;
      var name = document.getElementById('register-name').value.trim();
      var email = document.getElementById('register-email').value.trim();
      var password = document.getElementById('register-password').value;
      if (!email || !password) {
        showToast('Please fill in your email and password.');
        return;
      }
      if (password.length < 8) {
        showToast('Password must be at least 8 characters.');
        return;
      }
      setBusy(registerBtn, true);
      window.Auth.signup(name, email, password)
        .then(function (data) {
          setBusy(registerBtn, false);
          if (data.needsVerification) {
            UI.flash('Account created. Please verify your email.');
            showForm('verify-form');
            if (verifyCodeInput) verifyCodeInput.value = '';
            showToast('Please verify your email to access the interview service. Code sent to ' + data.email);
          }
        })
        .catch(function (err) {
          setBusy(registerBtn, false);
          showToast((err && err.message) || 'Could not create your account.');
        });
    });
  }

  var verifyEmail = null;

  if (verifyForm) {
    var verifyBtn = document.getElementById('verify-btn');
    var resendBtn = document.getElementById('resend-btn');

    verifyForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (verifyBtn.disabled) return;
      var code = verifyCodeInput ? verifyCodeInput.value.trim() : '';
      if (!code || code.length !== 6) {
        showToast('Please enter the 6-digit verification code.');
        return;
      }
      setBusy(verifyBtn, true);
      window.Auth.verifyOtp(verifyEmail, code)
        .then(function (data) {
          setBusy(verifyBtn, false);
          if (data.token) {
            UI.flash('Email verified. Welcome!');
            location.href = 'index.html';
          } else {
            showToast(data.error || 'Invalid code.');
          }
        })
        .catch(function (err) {
          setBusy(verifyBtn, false);
          showToast((err && err.message) || 'Could not verify code.');
        });
    });

    if (resendBtn) {
      resendBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (resendBtn.disabled) return;
        if (!verifyEmail) {
          showToast('No email to resend to. Please start over.');
          return;
        }
        resendBtn.disabled = true;
        resendBtn.textContent = 'Sending...';
        window.Auth.resendOtp(verifyEmail)
          .then(function (data) {
            resendBtn.textContent = 'Resend code';
            resendBtn.disabled = false;
            startResendCountdown(resendBtn);
            showToast('Please verify your email to access the interview service. New code sent to ' + verifyEmail);
          })
          .catch(function (err) {
            resendBtn.textContent = 'Resend code';
            resendBtn.disabled = false;
            showToast((err && err.message) || 'Could not resend code.');
          });
      });
    }
  }

  // Handle login needsVerification response
  function handleNeedsVerification(data) {
    if (data && data.needsVerification && data.email) {
      verifyEmail = data.email;
      showForm('verify-form');
      if (verifyCodeInput) verifyCodeInput.value = '';
      showToast('Please verify your email to access the interview service. Code sent to ' + data.email);
    }
  }

  // Override the login and signup functions to capture verification state
  var originalSignup = window.Auth.signup;
  var originalLogin = window.Auth.login;

  window.Auth.signup = function (name, email, password) {
    return originalSignup(name, email, password).then(function (data) {
      handleNeedsVerification(data);
      return data;
    });
  };

  window.Auth.login = function (email, password) {
    return originalLogin(email, password).then(function (data) {
      handleNeedsVerification(data);
      return data;
    });
  };
})();