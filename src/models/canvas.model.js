const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const collaboratorSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['viewer', 'editor', 'voice'], default: 'viewer' },
}, { _id: false });

// One token per permission level
const shareTokenSchema = new Schema({
  token: { type: String, required: true },
  role:  { type: String, enum: ['viewer', 'editor', 'voice'], required: true },
}, { _id: false });

const elementSchema = new Schema({
  elementId:  { type: String, required: true },
  kind:       { type: String, enum: ['stroke', 'shape', 'text'], required: true },
  strokeType: { type: String, enum: ['pen', 'marker', 'pencil', 'brush', 'eraser'] },
  points:     [{ x: Number, y: Number }],
  shapeType:  { type: String, enum: ['rectangle', 'circle', 'triangle', 'line', 'arrow', 'diamond'] },
  x: Number, y: Number, width: Number, height: Number,
  rotation:   { type: Number, default: 0 },
  text: String, fontSize: Number, fontFamily: String,
  color: String, fillColor: String, strokeWidth: Number,
  opacity:    { type: Number, default: 1 },
  timestamp:  Number,
}, { _id: false });

const canvasSchema = new Schema({
  title:         { type: String, default: 'Untitled Canvas', trim: true },
  owner:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
  collaborators: [collaboratorSchema],
  elements:      [elementSchema],
  isPublic:      { type: Boolean, default: false },
  shareTokens:   [shareTokenSchema], // per-role tokens
  thumbnail:     { type: String, default: null },
  viewport:      { x: { type: Number, default: 0 }, y: { type: Number, default: 0 }, zoom: { type: Number, default: 1 } },
}, { timestamps: true });

canvasSchema.index({ owner: 1, createdAt: -1 });
canvasSchema.index({ 'shareTokens.token': 1 });

module.exports = mongoose.model('Canvas', canvasSchema);