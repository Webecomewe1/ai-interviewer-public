const Question = require('../models/Question');
const { isMongoConfigured } = require('../db');

const MIN_QUALITY = 3;
const CACHE_ENABLED_DEFAULT = true;

function normalized(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDuplicate(candidate, pool) {
  const c = normalized(candidate);
  if (!c) return true;
  for (const existing of pool) {
    const e = normalized(existing);
    if (!e) continue;
    const cWords = c.split(' ');
    const eWords = e.split(' ');
    const overlap = cWords.filter((w) => eWords.includes(w)).length;
    const longer = Math.max(cWords.length, eWords.length) || 1;
    if (overlap / longer >= 0.75) return true;
  }
  return false;
}

async function findCachedQuestion({ position, customPosition, interviewType, difficulty, usedTexts = [] }) {
  if (!isMongoConfigured()) return null;

  const match = {
    position,
    interviewType,
    difficulty,
    quality: { $gte: MIN_QUALITY },
  };
  if (position === 'Custom Position') {
    match.customPosition = { $regex: customPosition || '', $options: 'i' };
    if (!customPosition) return null;
  }

  let candidates;
  try {
    candidates = await Question.find(match)
      .sort({ selectedCount: -1, uses: -1 })
      .limit(20)
      .lean();
  } catch (err) {
    return null;
  }

  for (const c of candidates) {
    if (!isDuplicate(c.text, usedTexts)) {
      try {
        await Question.updateOne({ _id: c._id }, { $inc: { selectedCount: 1 } });
      } catch (err) {
        /* ignore */
      }
      return {
        text: c.text,
        isFollowUp: Boolean(c.isFollowUp),
        source: 'cache',
        id: String(c._id),
      };
    }
  }
  return null;
}

async function saveGeneratedQuestion({
  position,
  customPosition,
  interviewType,
  difficulty,
  text,
  isFollowUp = false,
  userId = null,
  quality = 0,
}) {
  if (!isMongoConfigured()) return null;
  if (!text || !position || !interviewType || !difficulty) return null;
  try {
    const doc = await Question.findOneAndUpdate(
      {
        position,
        customPosition: position === 'Custom Position' ? customPosition || '' : '',
        interviewType,
        difficulty,
        text,
      },
      {
        $inc: { uses: 1 },
        $set: {
          isFollowUp,
          createdBy: userId,
          quality: quality > 0 ? quality : undefined,
        },
      },
      { upsert: true, new: true }
    );
    return doc;
  } catch (err) {
    return null;
  }
}

module.exports = {
  findCachedQuestion,
  saveGeneratedQuestion,
  isDuplicate,
  CACHE_ENABLED_DEFAULT,
};
