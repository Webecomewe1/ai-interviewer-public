const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ quiet: true, path: path.join(__dirname, '.env') });

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function trustedProxies(value = '') {
  // Default to the socket address. Never trust arbitrary forwarded headers.
  if (!value || value === 'false' || value === '0') return false;
  if (value === 'true' || /^\d+$/.test(value)) throw new Error('TRUST_PROXY must list trusted proxy IPs or subnets, not a boolean or hop count.');
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

const config = {
  port: Number(process.env.PORT) || 3000,
  trustProxy: trustedProxies(process.env.TRUST_PROXY),
  limits: {
    startsPerHour: positiveInteger('INTERVIEW_STARTS_PER_HOUR', 10),
    accountRequestsPerDay: positiveInteger('AI_REQUESTS_PER_ACCOUNT_DAY', 200),
    aiCallsPerDay: positiveInteger('AI_CALLS_PER_DAY', 1000),
    voiceSessionsPerDay: positiveInteger('VOICE_SESSIONS_PER_ACCOUNT_DAY', 4),
    globalVoiceSessionsPerDay: positiveInteger('VOICE_SESSIONS_PER_DAY', 50),
    voiceMaxMinutes: positiveInteger('VOICE_MAX_MINUTES', 15),
  },
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

if (process.env.NODE_ENV === 'production' && (config.jwtSecret.length < 32 || ['dev-jwt-secret', 'change_me_to_a_long_random_string'].includes(config.jwtSecret))) {
  throw new Error('Production requires a unique JWT_SECRET of at least 32 characters.');
}
config.isAuthConfigured = Boolean(config.jwtSecret);

module.exports = config;
