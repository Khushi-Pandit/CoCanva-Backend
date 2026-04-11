import { Schema, model, Document, Types } from 'mongoose';

export interface IActiveSession {
  _id: Types.ObjectId;
  canvasId: Types.ObjectId;
  userId: Types.ObjectId;
  socketId: string;
  userName: string;
  userColor: string;
  role: string;
  joinedAt: Date;
  lastSeen: Date;
}

export interface IActiveSessionDocument extends IActiveSession, Document {
  _id: Types.ObjectId;
}

const activeSessionSchema = new Schema<IActiveSessionDocument>(
  {
    canvasId: { type: Schema.Types.ObjectId, ref: 'Canvas', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    socketId: { type: String, required: true, unique: true },
    userName: { type: String, required: true },
    userColor: { type: String, required: true },
    role: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
  },
  {
    versionKey: false,
  },
);

// 2-hour TTL
activeSessionSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 7200 });
activeSessionSchema.index({ canvasId: 1 });
activeSessionSchema.index({ userId: 1 });
activeSessionSchema.index({ socketId: 1 }, { unique: true });

export const ActiveSessionModel = model<IActiveSessionDocument>(
  'ActiveSession',
  activeSessionSchema,
  'active_sessions',
);
