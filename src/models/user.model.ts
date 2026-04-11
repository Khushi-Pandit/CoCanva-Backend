import { Schema, model, Document, Types } from 'mongoose';
import { IUser, IUserPreferences } from '../types/canvas.types';

export interface IUserDocument extends IUser, Document {
  _id: Types.ObjectId;
}

const preferencesSchema = new Schema<IUserPreferences>(
  {
    theme: { type: String, enum: ['system', 'dark', 'light'], default: 'system' },
    cursorColor: { type: String, default: '#6366f1' },
    defaultTool: { type: String, default: 'select' },
    gridEnabled: { type: Boolean, default: true },
    snapToGrid: { type: Boolean, default: false },
    fontSize: { type: Number, default: 14 },
  },
  { _id: false },
);

const userSchema = new Schema<IUserDocument>(
  {
    fId: { type: String, required: true, unique: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    fullName: { type: String, required: true, maxlength: 120 },
    avatarUrl: { type: String, default: null },
    avatarId: { type: Number, default: () => Math.floor(Math.random() * 1000) },
    plan: {
      type: String,
      enum: ['free', 'pro', 'team', 'enterprise'],
      default: 'free',
    },
    preferences: { type: preferencesSchema, default: () => ({}) },
    canvasCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ fId: 1 }, { unique: true });

export const UserModel = model<IUserDocument>('User', userSchema, 'users');
