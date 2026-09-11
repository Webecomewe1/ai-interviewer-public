const express = require('express');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { signToken } = require('../auth/token');
const { optionalAuth } = require('../auth/middleware');
const { hashPassword, verifyPassword } = require('../auth/passwords');
const { sendVerificationEmail, sendResetEmail } = require('../auth/email');
const { isMongoConfigured } = require('../db');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 verification requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again later.' },
});

const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 resend requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many resend requests. Please try again later.' },
});

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function validateSignup({ name, email, password }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const cleanPassword = String(password || '');

  if (!EMAIL_RE.test(cleanEmail)) {
    return { error: 'Please enter a valid email address.' };
  }
  if (cleanPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (cleanName.length > 80) {
    return { error: 'Name must be 80 characters or fewer.' };
  }
  return { email: cleanEmail, name: cleanName, password: cleanPassword };
}

router.post('/signup', async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const body = req.body || {};
  const validated = validateSignup(body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    let existing = await User.findOne({ email: validated.email });
    const code = generateOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (existing) {
      if (existing.emailVerified) {
        return res.status(409).json({ error: 'An account with that email already exists. Try signing in.' });
      }
      // If user exists but is not verified, update password/name/code and resend
      existing.name = validated.name;
      existing.passwordHash = await hashPassword(validated.password);
      existing.verificationCode = code;
      existing.verificationExpires = expires;
      await existing.save();

      const emailResult = await sendVerificationEmail(existing.email, code);
      return res.json({
        needsVerification: true,
        email: existing.email,
        devCode: emailResult.devCode || undefined,
      });
    }

    const passwordHash = await hashPassword(validated.password);
    const user = await User.create({
      email: validated.email,
      name: validated.name,
      passwordHash,
      emailVerified: false,
      verificationCode: code,
      verificationExpires: expires,
    });

    const emailResult = await sendVerificationEmail(user.email, code);
    console.log(`[AUTH] New account created: ${user.email}`);
    res.json({
      needsVerification: true,
      email: user.email,
      devCode: emailResult.devCode || undefined,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'An account with that email already exists. Try signing in.' });
    }
    console.error('Signup failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not create your account. Please try again.' });
  }
});

router.post('/verify-otp', verifyLimiter, async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (user.emailVerified) {
      const token = signToken(user);
      console.log(`[AUTH] User logged in successfully: ${user.email}`);
      return res.json({
        token,
        user: { id: user._id.toString(), email: user.email, name: user.name },
      });
    }

    if (!user.verificationCode || user.verificationCode !== code) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    if (user.verificationExpires && user.verificationExpires < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationExpires = null;
    await user.save();

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name },
    });
  } catch (err) {
    console.error('Verify OTP failed:', err.message);
    res.status(500).json({ error: 'Could not verify code. Please try again.' });
  }
});

router.post('/resend-otp', resendLimiter, async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email is already verified. Please sign in.' });
    }

    const code = generateOTP();
    user.verificationCode = code;
    user.verificationExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const emailResult = await sendVerificationEmail(user.email, code);
    res.json({
      success: true,
      message: 'New verification code sent.',
      devCode: emailResult.devCode || undefined,
    });
  } catch (err) {
    console.error('Resend OTP failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not resend verification code.' });
  }
});

router.post('/forgot-password', resendLimiter, async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const user = await User.findOne({ email });
    let devCode;
    if (user) {
      const code = generateOTP();
      user.resetCode = code;
      user.resetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      user.resetVerified = false;
      await user.save();

      const emailResult = await sendResetEmail(user.email, code);
      devCode = emailResult.devCode;
      console.log(`[AUTH] Password reset requested: ${user.email}`);
    }

    // Always respond the same way to avoid revealing whether the account exists.
    res.json({
      success: true,
      message: 'If an account exists for that email, a reset code has been sent.',
      devCode: devCode || undefined,
    });
  } catch (err) {
    console.error('Forgot password failed:', err.message);
    res.status(500).json({ error: 'Could not send reset code. Please try again.' });
  }
});

router.post('/verify-reset-otp', verifyLimiter, async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and reset code are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user || !user.resetCode) {
      return res.status(400).json({ error: 'Invalid or expired reset code. Please request a new one.' });
    }
    if (user.resetCode !== code) {
      return res.status(400).json({ error: 'Invalid reset code.' });
    }
    if (user.resetExpires && user.resetExpires < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    }

    user.resetVerified = true;
    user.emailVerified = true;
    user.resetCode = null;
    user.resetExpires = null;
    await user.save();

    res.json({ success: true, message: 'Code verified. You may now set a new password.' });
  } catch (err) {
    console.error('Verify reset OTP failed:', err.message);
    res.status(500).json({ error: 'Could not verify reset code. Please try again.' });
  }
});

router.post('/reset-password', verifyLimiter, async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }

  try {
    const user = await User.findOne({ email });
    if (!user || !user.resetVerified) {
      return res.status(403).json({ error: 'Password reset was not verified. Please start again.' });
    }

    user.passwordHash = await hashPassword(password);
    user.resetVerified = false;
    user.emailVerified = true;
    user.resetCode = null;
    user.resetExpires = null;
    await user.save();
    console.log(`[AUTH] Password reset completed: ${user.email}`);

    res.json({ success: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    console.error('Reset password failed:', err.message);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  if (!isMongoConfigured()) {
    return res.status(503).json({ error: 'Accounts are unavailable until MongoDB is configured.' });
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    // Check email verification for accounts created with 2FA
    if (user.emailVerified === false) {
      const code = generateOTP();
      user.verificationCode = code;
      user.verificationExpires = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      const emailResult = await sendVerificationEmail(user.email, code);

      return res.status(403).json({
        error: 'Please verify your email address to continue.',
        needsVerification: true,
        email: user.email,
        devCode: emailResult.devCode || undefined,
      });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id.toString(), email: user.email, name: user.name },
    });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Could not sign you in. Please try again.' });
  }
});

router.get('/me', optionalAuth, (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: req.user });
});

module.exports = router;
