import { Schema, model, Document, Types } from 'mongoose';
import {
  ICanvas,
  ICollaborator,
  IShareToken,
  ICanvasSettings,
  CanvasCategory,
} from '../types/canvas.types';

export interface ICanvasDocument extends ICanvas, Document {
  _id: Types.ObjectId;
}

const collaboratorSchema = new Schema<ICollaborator>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['viewer', 'editor', 'commenter'], required: true },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
);

const shareTokenSchema = new Schema<IShareToken>(
  {
    token: { type: String, required: true },
    role: { type: String, enum: ['viewer', 'editor', 'commenter'], required: true },
    label: { type: String, default: '' },
    expiresAt: { type: Date, default: null },
    maxUses: { type: Number, default: null },
    useCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
  },
  { _id: false },
);

const settingsSchema = new Schema<ICanvasSettings>(
  {
    gridSize: { type: Number, default: 20 },
    snapToGrid: { type: Boolean, default: false },
    backgroundColor: { type: String, default: '#ffffff' },
    allowComments: { type: Boolean, default: true },
    allowAnonymousView: { type: Boolean, default: false },
    aiEnabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const canvasSchema = new Schema<ICanvasDocument>(
  {
    title: { type: String, required: true, maxlength: 200, default: 'Untitled Canvas' },
    description: { type: String, default: '', maxlength: 2000 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: { type: [collaboratorSchema], default: [] },
    shareTokens: { type: [shareTokenSchema], default: [] },
    isPublic: { type: Boolean, default: false },
    thumbnail: { type: String, default: null },
    thumbnailKey: { type: String, default: null },
    thumbnailUpdatedAt: { type: Date, default: null },
    elementCount: { type: Number, default: 0 },
    activeUserCount: { type: Number, default: 0 },
    tags: { type: [String], default: [], validate: { validator: (v: string[]) => v.length <= 20 } },
    category: {
      type: String,
      enum: ['flowchart', 'architecture', 'brainstorm', 'wireframe', 'erd', 'other'],
      default: 'other',
    } as { type: StringConstructor; enum: CanvasCategory[]; default: CanvasCategory },
    lastViewport: {
      type: { x: Number, y: Number, zoom: Number },
      default: { x: 0, y: 0, zoom: 1 },
    },
    currentBranch: { type: Schema.Types.ObjectId, ref: 'CanvasBranch', default: null },
    defaultBranch: { type: Schema.Types.ObjectId, ref: 'CanvasBranch', default: null },
    forkOf: { type: Schema.Types.ObjectId, ref: 'Canvas', default: null },
    forkSnapshotId: { type: Schema.Types.ObjectId, ref: 'CanvasSnapshot', default: null },
    settings: { type: settingsSchema, default: () => ({}) },
    canvasType: { type: String, enum: ['drawing', 'notes', 'diagram'], default: 'drawing' },
    pageSize: { type: String, enum: ['a4', 'letter', 'a3', 'a5', 'custom'], default: 'a4' },
    pageOrientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
    pageCount: { type: Number, default: 1 },
    archivedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes
canvasSchema.index({ owner: 1, deletedAt: 1 });
canvasSchema.index({ 'collaborators.user': 1 });
canvasSchema.index({ 'shareTokens.token': 1 });
canvasSchema.index({ isPublic: 1, deletedAt: 1 });
canvasSchema.index({ tags: 1 });
canvasSchema.index({ category: 1, deletedAt: 1 });
canvasSchema.index({ updatedAt: -1 });
canvasSchema.index({ title: 'text', description: 'text', tags: 'text' });

export const CanvasModel = model<ICanvasDocument>('Canvas', canvasSchema, 'canvases');
