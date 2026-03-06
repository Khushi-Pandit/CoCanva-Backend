const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-schema for collaborators
const collaboratorSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: ['viewer', 'editor'],
    default: 'viewer',
  },
}, { _id: false });

// Sub-schema for individual drawable elements
const elementSchema = new Schema({
  elementId: { type: String, required: true }, // frontend generated ID
  kind: {
    type: String,
    enum: ['stroke', 'shape', 'text'],
    required: true,
  },
  // Stroke fields
  strokeType: {
    type: String,
    enum: ['pen', 'marker', 'pencil', 'brush', 'eraser'],
  },
  points: [{ x: Number, y: Number }],
  // Shape fields
  shapeType: {
    type: String,
    enum: ['rectangle', 'circle', 'triangle', 'line', 'arrow', 'diamond'],
  },
  x: Number,
  y: Number,
  width: Number,
  height: Number,
  rotation: { type: Number, default: 0 },
  // Text fields
  text: String,
  fontSize: Number,
  fontFamily: String,
  // Common fields
  color: String,
  fillColor: String,
  strokeWidth: Number,
  opacity: { type: Number, default: 1 },
  timestamp: Number,
}, { _id: false });

// Main Canvas schema
const canvasSchema = new Schema({
  title: {
    type: String,
    default: 'Untitled Canvas',
    trim: true,
  },
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  collaborators: [collaboratorSchema],
  elements: [elementSchema],
  isPublic: {
    type: Boolean,
    default: false,
  },
  shareToken: {
    type: String,
    unique: true,
    sparse: true, // only indexed when present
  },
  thumbnail: {
    type: String,
    default: null,
  },
  viewport: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    zoom: { type: Number, default: 1 },
  },
}, { timestamps: true });

// Index for fast lookup by owner
canvasSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model('Canvas', canvasSchema);