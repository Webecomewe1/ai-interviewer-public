const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, unique: true, trim: true },
    name: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    emailVerified: { type: Boolean, default: false },
    verificationCode: { type: String, default: null },
    verificationExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);