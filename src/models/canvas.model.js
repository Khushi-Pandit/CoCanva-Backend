'use strict';
/**
 * Canvas model — stores METADATA only.
 * Actual drawing elements live in the CanvasElement collection
 * so canvases can grow to infinite size without hitting MongoDB's 16 MB document limit.
 */
const mongoose = require('mongoose');

const collaboratorSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:    { type: String, enum: ['viewer', 'editor'], default: 'viewer' },
  addedAt: { type: Date, default: Date.now },
}, { _id: false });

const shareTokenSchema = new mongoose.Schema({
  token:    { type: String, required: true },
  role:     { type: String, enum: ['viewer', 'editor'], required: true },
  createdAt:{ type: Date, default: Date.now },
}, { _id: false });

const canvasSchema = new mongoose.Schema({
  title:         { type: String, default: 'Untitled Canvas', trim: true, maxlength: 200 },
  owner:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collaborators: [collaboratorSchema],
  shareTokens:   [shareTokenSchema],
  isPublic:      { type: Boolean, default: false },
  thumbnail:     { type: String, default: null },   // small base64 preview image
  elementCount:  { type: Number, default: 0 },      // cached count for dashboard list
  tags:          [{ type: String, trim: true }],    // user-defined tags / labels
  // Last known viewport — used as a hint when reopening (per-canvas, not per-user)
  lastViewport: {
    x:    { type: Number, default: 0 },
    y:    { type: Number, default: 0 },
    zoom: { type: Number, default: 1 },
  },
}, { timestamps: true });

canvasSchema.index({ owner: 1, updatedAt: -1 });
canvasSchema.index({ 'collaborators.user': 1, updatedAt: -1 });
canvasSchema.index({ 'shareTokens.token': 1 });
canvasSchema.index({ isPublic: 1, updatedAt: -1 });

module.exports = mongoose.model('Canvas', canvasSchema);
