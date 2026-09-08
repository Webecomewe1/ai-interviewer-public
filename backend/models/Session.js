const mongoose = require('mongoose');

const evalSchema = new mongoose.Schema(
  {
    technical: Number,
    problemSolving: Number,
    communication: Number,
    clarity: Number,
    confidence: Number,
    adaptability: Number,
    note: String,
    suggestions: [String],
    overall: Number,
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    mode: { type: String, enum: ['text', 'voice'], default: 'text' },
    config: {
      position: String,
      customPosition: String,
      interviewType: String,
      difficulty: String,
      questionCount: Number,
    },
    status: { type: String, default: 'in_progress' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    questions: [
      {
        number: Number,
        text: String,
        isFollowUp: Boolean,
        difficulty: String,
        source: { type: String, default: 'generated' },
      },
    ],
    answers: [
      {
        questionNumber: Number,
        answer: String,
        wordCount: Number,
        elapsedMs: Number,
        difficulty: String,
        eval: evalSchema,
      },
    ],
    transcript: [{ role: String, text: String }],
    evaluation: evalSchema,
    stats: { type: mongoose.Schema.Types.Mixed, default: null },
    questionTiming: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true }
);

sessionSchema.index({ user: 1, createdAt: -1 });

module.exports =
  mongoose.models.InterviewSession || mongoose.model('InterviewSession', sessionSchema);
