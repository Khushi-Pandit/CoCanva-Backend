import { Schema, model, Document, Types } from 'mongoose';
import { INotification } from '../types/user.types';

export interface INotificationDocument extends INotification, Document {
  _id: Types.ObjectId;
}

const notificationSchema = new Schema<INotificationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'canvas_invite',
        'canvas_comment',
        'canvas_mention',
        'canvas_edit',
        'role_change',
        'ghost_suggestion',
      ],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

// 30-day TTL
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2_592_000 });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const NotificationModel = model<INotificationDocument>(
  'Notification',
  notificationSchema,
  'notifications',
);
