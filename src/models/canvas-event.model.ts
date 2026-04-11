import { Schema, model, Document, Types } from 'mongoose';

export type CanvasEventType =
  | 'element_add'
  | 'element_update'
  | 'element_delete'
  | 'element_batch'
  | 'canvas_clear'
  | 'canvas_title_change'
  | 'collaborator_add'
  | 'branch_create';

export interface ICanvasEvent {
  _id: Types.ObjectId;
  canvasId: Types.ObjectId;
  branchId: Types.ObjectId;
  sequenceNo: number;
  type: CanvasEventType;
  payload: Record<string, unknown>;
  prevState: Record<string, unknown>;
  userId: Types.ObjectId;
  sessionId: string;
  clientTimestamp: Date;
  createdAt: Date;
}

export interface ICanvasEventDocument extends ICanvasEvent, Document {
  _id: Types.ObjectId;
}

const canvasEventSchema = new Schema<ICanvasEventDocument>(
  {
    canvasId: { type: Schema.Types.ObjectId, ref: 'Canvas', required: true },
    branchId: { type: Schema.Types.ObjectId, ref: 'CanvasBranch', required: true },
    sequenceNo: { type: Number, required: true },
    type: {
      type: String,
      enum: [
        'element_add',
        'element_update',
        'element_delete',
        'element_batch',
        'canvas_clear',
        'canvas_title_change',
        'collaborator_add',
        'branch_create',
      ],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, required: true },
    prevState: { type: Schema.Types.Mixed, default: {} },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    clientTimestamp: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// Indexes
canvasEventSchema.index({ canvasId: 1, sequenceNo: 1 });
canvasEventSchema.index({ canvasId: 1, createdAt: 1 });
// 90-day TTL
canvasEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

export const CanvasEventModel = model<ICanvasEventDocument>(
  'CanvasEvent',
  canvasEventSchema,
  'canvas_events',
);
