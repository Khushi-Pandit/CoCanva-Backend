import { NotificationModel } from '../models/notification.model';
import { UserModel } from '../models/user.model';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class NotificationService {
  async create(
    userId: Types.ObjectId,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const notif = await NotificationModel.create({ userId, type, payload });
    return notif;
  }

  async list(userId: Types.ObjectId, opts: { unread?: boolean; limit: number }) {
    const filter: Record<string, unknown> = { userId };
    if (opts.unread) filter['read'] = false;

    return NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(opts.limit)
      .lean();
  }

  async markRead(userId: Types.ObjectId, ids?: string[], all?: boolean) {
    const filter: Record<string, unknown> = { userId };
    if (!all && ids?.length) {
      filter['_id'] = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    await NotificationModel.updateMany(filter, { $set: { read: true } });
  }

  /**
   * Send a canvas invite email via Resend.
   * Gracefully no-ops if RESEND_API_KEY is missing.
   */
  async sendCanvasInviteEmail(opts: {
    toEmail: string;
    toName: string;
    fromName: string;
    canvasTitle: string;
    role: string;
    canvasUrl: string;
  }): Promise<void> {
    if (!env.RESEND_API_KEY) {
      logger.warn('RESEND_API_KEY not set — skipping invite email');
      return;
    }

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(env.RESEND_API_KEY);

      await resend.emails.send({
        from: env.EMAIL_FROM,
        to: opts.toEmail,
        subject: `${opts.fromName} invited you to "${opts.canvasTitle}"`,
        html: `
<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto;padding:40px 20px">
  <h2 style="color:#6366f1">DrawSync Invitation</h2>
  <p>Hi ${opts.toName},</p>
  <p><strong>${opts.fromName}</strong> has invited you to collaborate on 
     <strong>"${opts.canvasTitle}"</strong> as a <strong>${opts.role}</strong>.</p>
  <a href="${opts.canvasUrl}" 
     style="display:inline-block;margin-top:20px;padding:12px 24px;
            background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
    Open Canvas
  </a>
  <p style="margin-top:40px;color:#888;font-size:13px">
    DrawSync — Intelligent Collaborative Canvas Platform
  </p>
</div>`,
      });

      logger.info('Invite email sent', { to: opts.toEmail });
    } catch (err) {
      logger.error('Failed to send invite email', { error: (err as Error).message });
    }
  }
}

export const notificationService = new NotificationService();
