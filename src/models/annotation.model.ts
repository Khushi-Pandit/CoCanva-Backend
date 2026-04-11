import { Schema, model, Document, Types } from 'mongoose';

export interface IAnnotation {
  _id: Types.ObjectId;
  canvasId: Types.ObjectId;
  attachedToElementId: string | null;
  region: { x: number; y: number; width: number; height: number } | null;
  parentId: Types.ObjectId | null;
  text: string;
  attachments: Array<{ url: string; type: string; name: string }>;
  reactions: Array<{ emoji: string; users: Types.ObjectId[] }>;
  mentions: Types.ObjectId[];
  resolvedAt: Date | null;
  resolvedBy: Types.ObjectId | null;
  author: Types.ObjectId;
  isAiGenerated: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAnnotationDocument extends IAnnotation, Document {
  _id: Types.ObjectId;
}

const attachmentSchema = new Schema(
  { url: String, type: String, name: String },
  { _id: false },
);

const reactionSchema = new Schema(
  { emoji: String, users: [{ type: Schema.Types.ObjectId, ref: 'User' }] },
  { _id: false },
);

const regionSchema = new Schema(
  { x: Number, y: Number, width: Number, height: Number },
  { _id: false },
);

const annotationSchema = new Schema<IAnnotationDocument>(
  {
    canvasId: { type: Schema.Types.ObjectId, ref: 'Canvas', required: true },
    attachedToElementId: { type: String, default: null },
    region: { type: regionSchema, default: null },
    parentId: { type: Schema.Types.ObjectId, ref: 'Annotation', default: null },
    text: { type: String, required: true, maxlength: 10000 },
    attachments: { type: [attachmentSchema], default: [] },
    reactions: { type: [reactionSchema], default: [] },
    mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isAiGenerated: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

annotationSchema.index({ canvasId: 1, isDeleted: 1 });
annotationSchema.index({ canvasId: 1, attachedToElementId: 1 });
annotationSchema.index({ canvasId: 1, parentId: 1 });
annotationSchema.index({ canvasId: 1, resolvedAt: 1 });
annotationSchema.index({ author: 1 });

export const AnnotationModel = model<IAnnotationDocument>(
  'Annotation',
  annotationSchema,
  'annotations',
);
