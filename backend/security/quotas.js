const { createHash } = require('crypto');
const { mongoose } = require('../db');
const config = require('../config');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const bucketSchema = new mongoose.Schema({
  _id: String,
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
}, { bufferCommands: false, versionKey: false });
bucketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const Bucket = mongoose.models.AbuseQuota || mongoose.model('AbuseQuota', bucketSchema);
const developmentBuckets = new Map();

class QuotaError extends Error {
  constructor(message, status = 429, retryAfter = 60) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = status === 429 ? 'QUOTA_EXCEEDED' : 'QUOTA_UNAVAILABLE';
  }
}

async function incrementBucket(id, expiresAt) {
  if (mongoose.connection.readyState !== 1) {
    // Shared quotas must survive restarts and cover all production workers.
    if (process.env.NODE_ENV === 'production' || config.mongoUri) {
      throw new QuotaError('Practice limits are temporarily unavailable. Please try again shortly.', 503);
    }
    const now = Date.now();
    for (const [key, value] of developmentBuckets) if (value.expiresAt <= now) developmentBuckets.delete(key);
    if (!developmentBuckets.has(id) && developmentBuckets.size >= 10000) {
      throw new QuotaError('Practice is temporarily busy. Please try again shortly.', 503);
    }
    const entry = developmentBuckets.get(id) || { count: 0, expiresAt: expiresAt.getTime() };
    entry.count++;
    developmentBuckets.set(id, entry);
    return entry.count;
  }
  try {
    const bucket = await Bucket.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true, maxTimeMS: 3000 }
    ).lean();
    return bucket.count;
  } catch (error) {
    if (error.code === 11000) {
      // Another worker may have created this same fixed-window bucket first.
      try {
        const bucket = await Bucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true, maxTimeMS: 3000 }).lean();
        if (bucket) return bucket.count;
      } catch (_) { /* fail closed below */ }
    }
    throw new QuotaError('Practice limits are temporarily unavailable. Please try again shortly.', 503);
  }
}

function createQuotaConsumer(increment = incrementBucket, now = Date.now) {
  return async function consume(scope, identity, limit, windowMs, message = 'Your practice limit has been reached. Please try again after the reset.') {
    const time = now();
    const windowStart = Math.floor(time / windowMs) * windowMs;
    const expiresAt = new Date(windowStart + windowMs);
    const digest = createHash('sha256').update(String(identity)).digest('hex');
    const count = await increment(`${scope}:${digest}:${windowStart}`, expiresAt);
    if (count > limit) throw new QuotaError(message, 429, Math.max(1, Math.ceil((expiresAt.getTime() - time) / 1000)));
    return { remaining: Math.max(0, limit - count), resetTime: expiresAt };
  };
}

const consumeQuota = createQuotaConsumer();

async function accountDailyLimit(req, res, next) {
  try {
    await consumeQuota('account-ai-day', req.user.id, config.limits.accountRequestsPerDay, DAY);
    next();
  } catch (error) { next(error); }
}

async function accountStartLimit(req, res, next) {
  try {
    await consumeQuota('account-start-hour', req.user.id, config.limits.startsPerHour, HOUR, 'You have reached your hourly interview start limit. Please try again later.');
    next();
  } catch (error) { next(error); }
}

module.exports = { QuotaError, createQuotaConsumer, consumeQuota, accountDailyLimit, accountStartLimit, MINUTE, HOUR, DAY };
