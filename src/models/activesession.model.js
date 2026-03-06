const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Tracks active Socket.io sessions per canvas room
const activeSessionSchema = new Schema({
  canvasId: {
    type: Schema.Types.ObjectId,
    ref: 'Canvas',
    required: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  socketId: {
    type: String,
    required: true,
  },
  userName: String,
  userColor: String, // assigned cursor color for this session
  cursor: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: false });

activeSessionSchema.index({ canvasId: 1 });
activeSessionSchema.index({ socketId: 1 }, { unique: true });

module.exports = mongoose.model('ActiveSession', activeSessionSchema);