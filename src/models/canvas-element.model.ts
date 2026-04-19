import { Schema, model, Document, Types } from 'mongoose';
import { ICanvasElement, Point, Shadow } from '../types/element.types';

export interface ICanvasElementDocument extends ICanvasElement, Document {
  _id: Types.ObjectId;
}

const pointSchema = new Schema<Point>(
  { x: Number, y: Number, p: Number, t: Number },
  { _id: false },
);

const shadowSchema = new Schema<Shadow>(
  { blur: Number, color: String, offsetX: Number, offsetY: Number },
  { _id: false },
);

const canvasElementSchema = new Schema<ICanvasElementDocument>(
  {
    canvasId: { type: Schema.Types.ObjectId, ref: 'Canvas', required: true },
    elementId: { type: String, required: true },
    type: {
      type: String,
      enum: ['stroke', 'shape', 'text', 'image', 'frame', 'connector', 'sticky', 'widget'],
      required: true,
    },
    subtype: { type: String, default: '' },
    shapeType: { type: String, default: 'rectangle' },
    pageIndex: { type: Number, default: 0 },

    // Spatial
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    rotation: { type: Number, default: 0 },

    // Stroke
    points: { type: [pointSchema], default: [] },

    // Connector
    fromElementId: { type: String, default: null },
    toElementId: { type: String, default: null },
    fromAnchor: {
      type: String,
      enum: ['top', 'right', 'bottom', 'left', 'center', null],
      default: null,
    },
    toAnchor: {
      type: String,
      enum: ['top', 'right', 'bottom', 'left', 'center', null],
      default: null,
    },
    fromPoint: { type: pointSchema, default: null },
    toPoint: { type: pointSchema, default: null },
    waypoints: { type: [pointSchema], default: [] },
    controlPoints: { type: [pointSchema], default: [] },
    routingAlgorithm: {
      type: String,
      enum: ['orthogonal', 'curved', 'straight'],
      default: 'curved',
    },

    // Text
    text: { type: String, default: '' },
    label: { type: String, default: '' },
    fontSize: { type: Number, default: 16 },
    fontFamily: { type: String, default: 'Inter' },
    fontWeight: { type: String, default: 'normal' },
    fontStyle: { type: String, default: 'normal' },
    textAlign: { type: String, default: 'left' },
    textColor: { type: String, default: '#000000' },
    lineHeight: { type: Number, default: 1.5 },
    letterSpacing: { type: Number, default: 0 },

    // Style
    strokeColor: { type: String, default: '#000000' },
    fillColor: { type: String, default: 'transparent' },
    strokeWidth: { type: Number, default: 2 },
    opacity: { type: Number, default: 1 },
    dashed: { type: Boolean, default: false },
    dashArray: { type: [Number], default: [] },
    roughness: { type: Number, default: 0 },
    roundness: { type: Number, default: 0 },
    borderRadius: { type: Number, default: 0 },
    shadow: { type: shadowSchema, default: null },

    // Arrow
    arrowStart: { type: Boolean, default: false },
    arrowEnd: { type: Boolean, default: true },
    arrowHeadStyle: {
      type: String,
      enum: ['triangle', 'open', 'dot', 'diamond', 'none'],
      default: 'triangle',
    },
    arrowTailStyle: {
      type: String,
      enum: ['triangle', 'open', 'dot', 'diamond', 'none'],
      default: 'none',
    },

    // Image / Widget
    imageUrl: { type: String, default: null },
    widgetType: { type: String, default: null },
    widgetData: { type: Schema.Types.Mixed, default: null },

    // Layer
    zIndex: { type: Number, default: 0 },
    groupId: { type: String, default: null },
    frameId: { type: String, default: null },

    // AI
    isGhostSuggestion: { type: Boolean, default: false },
    aiConfidence: { type: Number, default: 0 },
    aiReasoning: { type: String, default: '' },
    isFlowchartEl: { type: Boolean, default: false },

    // State
    isDeleted: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },

    // Audit
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Compound indexes as per spec
canvasElementSchema.index({ canvasId: 1, isDeleted: 1 });
canvasElementSchema.index({ canvasId: 1, elementId: 1 }, { unique: true });
canvasElementSchema.index({ canvasId: 1, zIndex: 1 });
canvasElementSchema.index({ canvasId: 1, frameId: 1 });
canvasElementSchema.index({ canvasId: 1, groupId: 1 });
canvasElementSchema.index({ canvasId: 1, fromElementId: 1 });
canvasElementSchema.index({ canvasId: 1, toElementId: 1 });
canvasElementSchema.index({ canvasId: 1, isGhostSuggestion: 1 });
canvasElementSchema.index({ canvasId: 1, updatedAt: 1 });

export const CanvasElementModel = model<ICanvasElementDocument>(
  'CanvasElement',
  canvasElementSchema,
  'canvas_elements',
);
