import { Schema, model, Document, Types } from 'mongoose';

export interface ICanvasSnapshot {
  _id: Types.ObjectId;
  canvasId: Types.ObjectId;
  branchId: Types.ObjectId;
  sequenceNo: number;
  elements: unknown[];
  createdAt: Date;
}

export interface ICanvasSnapshotDocument extends ICanvasSnapshot, Document {
  _id: Types.ObjectId;
}

const canvasSnapshotSchema = new Schema<ICanvasSnapshotDocument>(
  {
    canvasId: { type: Schema.Types.ObjectId, ref: 'Canvas', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'CanvasBranch', required: true },
    sequenceNo: { type: Number, required: true },
    elements: { type: Schema.Types.Mixed as any, default: [] },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

canvasSnapshotSchema.index({ canvasId: 1, branchId: 1, sequenceNo: 1 });
canvasSnapshotSchema.index({ canvasId: 1, createdAt: -1 });

export const CanvasSnapshotModel = model<ICanvasSnapshotDocument>(
  'CanvasSnapshot',
  canvasSnapshotSchema,
  'canvas_snapshots',
);
