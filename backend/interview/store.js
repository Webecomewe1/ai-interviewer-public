const InterviewSessionModel = require('../models/Session');
const { isMongoConfigured } = require('../db');

let persisted = false;

function isPersisted() {
  return persisted;
}

function setPersisted(v) {
  persisted = Boolean(v);
}

async function createSessionDoc(data) {
  if (!isMongoConfigured()) return null;
  try {
    return await InterviewSessionModel.create(data);
  } catch (err) {
    console.error('Create session doc failed:', err.message);
    return null;
  }
}

async function upsertSession(session) {
  if (!isMongoConfigured() || !session || !session._id) return null;
  try {
    const doc = {
      user: session.userId || null,
      mode: session.config.mode,
      config: session.config,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      questions: session.questions,
      answers: session.answers,
      transcript: session.transcript,
      evaluation: session.evaluation,
      stats: session._buildStats ? session._buildStats() : null,
      questionTiming: session._buildQuestionTiming
        ? session._buildQuestionTiming()
        : [],
    };
    return await InterviewSessionModel.updateOne(
      { _id: session._id },
      { $set: doc }
    );
  } catch (err) {
    return null;
  }
}

async function loadSessionDoc(id) {
  if (!isMongoConfigured()) return null;
  try {
    return await InterviewSessionModel.findById(id).lean();
  } catch (err) {
    return null;
  }
}

async function listUserSessions(userId, limit = 20) {
  if (!isMongoConfigured()) return [];
  try {
    return await InterviewSessionModel.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  } catch (err) {
    return [];
  }
}

async function clearUserSessions(userId) {
  if (!isMongoConfigured()) return 0;
  try {
    const result = await InterviewSessionModel.deleteMany({ user: userId });
    return result && result.deletedCount ? result.deletedCount : 0;
  } catch (err) {
    return 0;
  }
}

module.exports = {
  isPersisted,
  setPersisted,
  createSessionDoc,
  upsertSession,
  loadSessionDoc,
  listUserSessions,
  clearUserSessions,
};
