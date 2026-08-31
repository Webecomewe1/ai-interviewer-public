const dotenv = require('dotenv');

dotenv.config();

const config = {
  port: Number(process.env.PORT) || 3000,
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL || '',
    liveSilenceMs: Number(process.env.GEMINI_LIVE_SILENCE_MS) || 5000,
    liveEndSensitivity:
      (process.env.GEMINI_LIVE_END_SENSITIVITY || 'low').toLowerCase() === 'high'
        ? 'END_SENSITIVITY_HIGH'
        : 'END_SENSITIVITY_LOW',
  },
};

module.exports = config;