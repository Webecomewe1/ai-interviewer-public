const bcrypt = require('bcryptjs');

const ROUNDS = 10;

async function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

module.exports = { hashPassword, verifyPassword };