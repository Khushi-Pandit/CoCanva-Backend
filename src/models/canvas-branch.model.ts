import { Schema, model, Document, Types } from 'mongoose';
import { IBranch } from '../types/canvas.types';

export interface ICanvasBranchDocument extends IBranch, Document {
  _id: Types.ObjectId;
}

const canvasBranchSchema = new Schema<ICanvasBranchDocument>(
  {
    canvasId: { type: Schema.Types.ObjectId, ref: 'Canvas', required: true },
    name: { type: String, required: true, maxlength: 100 },
    baseSnapshotId: { type: Schema.Types.ObjectId, ref: 'CanvasSnapshot', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mergedAt: { type: Date, default: null },
    parentBranchId: { type: Schema.Types.ObjectId, ref: 'CanvasBranch', default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

canvasBranchSchema.index({ canvasId: 1, createdAt: -1 });
canvasBranchSchema.index({ canvasId: 1, name: 1 }, { unique: true });

export const CanvasBranchModel = model<ICanvasBranchDocument>(
  'CanvasBranch',
  canvasBranchSchema,
  'canvas_branches',
);
