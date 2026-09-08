const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), email: user.email, name: user.name },
    config.jwtSecret,
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = { signToken, verifyToken };
