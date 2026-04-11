import { IUser } from './canvas.types';
import { Request } from 'express';
import { Types } from 'mongoose';

export type { IUser };

// Extends Express Request with authenticated user
export interface AuthenticatedRequest extends Request {
  user?: IUser & { _id: Types.ObjectId };
  canvasRole?: string;
}

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type:
    | 'canvas_invite'
    | 'canvas_comment'
    | 'canvas_mention'
    | 'canvas_edit'
    | 'role_change'
    | 'ghost_suggestion';
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

export interface IApiKey {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  keyHash: string;
  name: string;
  scopes: string[];
  lastUsed: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}
