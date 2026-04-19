import { Schema, model, Document, Types } from 'mongoose';

export interface ICanvasPage {
  canvasId: Types.ObjectId;
  pageIndex: number;
  label: string;
  summary: string;
  summaryUpdatedAt: Date | null;
  elementCount: number;
  thumbnail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICanvasPageDocument extends ICanvasPage, Document {
  _id: Types.ObjectId;
}

const canvasPageSchema = new Schema<ICanvasPageDocument>(
  {
    canvasId:          { type: Schema.Types.ObjectId, ref: 'Canvas', required: true, index: true },
    pageIndex:         { type: Number, required: true, default: 0 },
    label:             { type: String, default: '' },
    summary:           { type: String, default: '' },
    summaryUpdatedAt:  { type: Date, default: null },
    elementCount:      { type: Number, default: 0 },
    thumbnail:         { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

canvasPageSchema.index({ canvasId: 1, pageIndex: 1 }, { unique: true });

export const CanvasPageModel = model<ICanvasPageDocument>('CanvasPage', canvasPageSchema);
