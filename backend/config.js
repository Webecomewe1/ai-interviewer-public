const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ quiet: true, path: path.join(__dirname, '.env') });

const config = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI || '',
  webUrl: process.env.WEB_URL || 'http://localhost:5173',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret',
  emailjs: {
    serviceId: process.env.EMAILJS_SERVICE_ID || '',
    templateId: process.env.EMAILJS_TEMPLATE_ID || '',
    publicKey: process.env.EMAILJS_PUBLIC_KEY || '',
    privateKey: process.env.EMAILJS_PRIVATE_KEY || '',
  },
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

config.isAuthConfigured = Boolean(config.jwtSecret);

module.exports = config;