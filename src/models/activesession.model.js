'use strict';
const mongoose = require('mongoose');

/**
 * ActiveSession — tracks live Socket.IO presence per canvas room.
 * Written on canvas:join, deleted on disconnect / canvas:leave.
 * Cursor positions are tracked in-memory (not persisted here) for performance.
 */
const activeSessionSchema = new mongoose.Schema({
  canvasId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Canvas', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  socketId:  { type: String, required: true },
  userName:  { type: String },
  userColor: { type: String },
  role:      { type: String, enum: ['owner', 'editor', 'viewer'], default: 'viewer' },
  joinedAt:  { type: Date, default: Date.now },
  lastSeen:  { type: Date, default: Date.now },
}, { timestamps: false });

activeSessionSchema.index({ canvasId: 1 });
activeSessionSchema.index({ socketId: 1 }, { unique: true });
activeSessionSchema.index({ userId: 1 });
// TTL: auto-clean stale sessions older than 2 hours (safety net for crash/no-disconnect)
activeSessionSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 7200 });

module.exports = mongoose.model('ActiveSession', activeSessionSchema);