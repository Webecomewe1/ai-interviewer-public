const express = require('express');
const { verifyToken } = require('./token');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub).select('emailVerified email name').lean();
    if (!user) {
      return res.status(401).json({ error: 'User not found. Please sign in again.' });
    }
    if (!user.emailVerified) {
      return res.status(403).json({ error: 'Email not verified. Please verify your email address.', needsVerification: true, email: user.email });
    }
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
  } catch (err) {
    req.user = null;
  }
  return next();
}

module.exports = { requireAuth, optionalAuth };
