// FILE: src/models/canvas.model.js
const mongoose = require('mongoose');
const Schema   = mongoose.Schema;

const collaboratorSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['viewer', 'editor', 'voice'], default: 'viewer' },
}, { _id: false });

const shareTokenSchema = new Schema({
  token: { type: String, required: true },
  role:  { type: String, enum: ['viewer', 'editor', 'voice'], required: true },
}, { _id: false });

const elementSchema = new Schema({
  elementId:  { type: String, required: true },
  kind:       { type: String, enum: ['stroke', 'shape', 'text', 'flowchart'], required: true },

  // ── Stroke fields ──────────────────────────────────────────────────────────
  strokeType: { type: String, enum: ['pen', 'marker', 'pencil', 'brush', 'eraser'] },
  points:     [{ x: Number, y: Number }],

  // ── Shape / Flowchart fields ───────────────────────────────────────────────
  shapeType: {
    type: String,
    enum: [
      // Basic shapes
      'rectangle', 'circle', 'triangle', 'line', 'arrow',
      // Flowchart shapes
      'diamond',       // decision
      'parallelogram', // input/output
      'cylinder',      // database
      'rounded_rect',  // process (start/end)
      'hexagon',       // preparation
      'connector',     // line with arrow
    ],
  },

  x: Number, y: Number, width: Number, height: Number,
  rotation:   { type: Number, default: 0 },

  // ── Text / Label (inside shapes) ──────────────────────────────────────────
  text:       String,
  label:      String,   // label inside flowchart shapes
  fontSize:   Number,
  fontFamily: String,
  textAlign:  { type: String, enum: ['left', 'center', 'right'], default: 'center' },

  // ── Style ─────────────────────────────────────────────────────────────────
  color:       String,
  fillColor:   String,
  strokeWidth: Number,
  opacity:     { type: Number, default: 1 },
  dashed:      { type: Boolean, default: false },  // for connector lines
  arrowEnd:    { type: Boolean, default: true  },  // arrow at end of connector

  // ── Flowchart connector endpoints ─────────────────────────────────────────
  fromId: String,  // elementId of source shape
  toId:   String,  // elementId of target shape

  timestamp: Number,
}, { _id: false });

const canvasSchema = new Schema({
  title:         { type: String, default: 'Untitled Canvas', trim: true },
  owner:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
  collaborators: [collaboratorSchema],
  elements:      [elementSchema],
  isPublic:      { type: Boolean, default: false },
  shareTokens:   [shareTokenSchema],
  thumbnail:     { type: String, default: null },
  viewport: {
    x:    { type: Number, default: 0 },
    y:    { type: Number, default: 0 },
    zoom: { type: Number, default: 1 },
  },
}, { timestamps: true });

canvasSchema.index({ owner: 1, createdAt: -1 });
canvasSchema.index({ 'shareTokens.token': 1 });
canvasSchema.index({ 'collaborators.user': 1 }); // ← for getSharedWithMe query

module.exports = mongoose.model('Canvas', canvasSchema);
