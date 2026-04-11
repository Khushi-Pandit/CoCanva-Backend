import { Response, NextFunction, Request } from 'express';
import { UserModel } from '../models/user.model';
import { NotificationModel } from '../models/notification.model';
import { AuthenticatedRequest } from '../types/user.types';
import { notificationService } from '../services/notification.service';
import { invalidateUserCache } from '../middleware/auth.middleware';
import { NotFoundError } from '../utils/errors';
import { Types } from 'mongoose';

export class UserController {
  async signup(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { fullName, preferences } = req.body as { fullName: string; preferences?: Record<string, unknown> };
      const user = req.user!;
      await UserModel.updateOne({ _id: user._id }, { $set: { fullName, preferences } });
      await invalidateUserCache(user.fId);
      res.status(201).json({ user: { ...user, fullName } });
    } catch (err) { next(err); }
  }

  async login(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ user: req.user });
    } catch (err) { next(err); }
  }

  async getMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ user: req.user });
    } catch (err) { next(err); }
  }

  async updateMe(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { fullName, avatarUrl, preferences } = req.body as any;
      const update: Record<string, unknown> = {};
      if (fullName) update['fullName'] = fullName;
      if (avatarUrl !== undefined) update['avatarUrl'] = avatarUrl;
      if (preferences) update['preferences'] = preferences;

      const updated = await UserModel.findByIdAndUpdate(
        req.user!._id,
        { $set: update },
        { new: true },
      ).lean();

      await invalidateUserCache(req.user!.fId);
      res.json({ user: updated });
    } catch (err) { next(err); }
  }

  async deleteAccount(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await UserModel.updateOne({ _id: req.user!._id }, { isActive: false });
      await invalidateUserCache(req.user!.fId);
      res.json({ message: 'Account deactivated. All data will be purged within 30 days.' });
    } catch (err) { next(err); }
  }

  async getNotifications(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const unread = req.query['unread'] === 'true';
      const limit = Math.min(Number(req.query['limit'] ?? 50), 100);
      const items = await notificationService.list(req.user!._id, { unread, limit });
      res.json({ items });
    } catch (err) { next(err); }
  }

  async markNotificationsRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { ids, all } = req.body as { ids?: string[]; all?: boolean };
      await notificationService.markRead(req.user!._id, ids, all);
      res.json({ message: 'Notifications marked as read' });
    } catch (err) { next(err); }
  }

  async searchUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = req.query['q'] as string;
      if (!q || q.length < 2) { res.json({ users: [] }); return; }

      const users = await UserModel.find({
        isActive: true,
        $or: [
          { fullName: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
        ],
      })
        .limit(10)
        .select('fullName email avatarUrl avatarId')
        .lean();

      res.json({ users });
    } catch (err) { next(err); }
  }
}

export const userController = new UserController();
