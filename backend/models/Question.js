const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
  {
    position: { type: String, required: true },
    customPosition: { type: String, default: '' },
    interviewType: { type: String, enum: ['behavioral', 'technical', 'mixed'], required: true },
    difficulty: { type: String, enum: ['beginner', 'intermediate', 'advanced'], required: true },
    text: { type: String, required: true },
    isFollowUp: { type: Boolean, default: false },
    quality: { type: Number, default: 0, min: 0, max: 10 },
    uses: { type: Number, default: 1 },
    selectedCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

questionSchema.index({ position: 1, customPosition: 1, interviewType: 1, difficulty: 1 });

module.exports =
  mongoose.models.Question || mongoose.model('Question', questionSchema);
