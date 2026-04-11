import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { canvasService } from '../services/canvas.service';
import { notificationService } from '../services/notification.service';
import { UserModel } from '../models/user.model';
import { NotFoundError } from '../utils/errors';
import { Types } from 'mongoose';
import { env } from '../config/env';

const pid = (req: AuthenticatedRequest) => String(req.params['id']);

export class CanvasController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const canvas = await canvasService.createCanvas(req.user!._id, req.body);
      res.status(201).json({ canvas });
    } catch (err) { next(err); }
  }

  async get(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // Accept shareToken from query param (?shareToken=) OR header (x-share-token)
      const shareToken =
        (req.query['shareToken'] as string | undefined) ||
        (req.headers['x-share-token'] as string | undefined);
      const canvas = await canvasService.getCanvas(pid(req), req.user?._id, shareToken);
      res.json({ canvas });
    } catch (err) { next(err); }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const canvas = await canvasService.updateCanvas(pid(req), req.user!._id, req.body);
      res.json({ canvas });
    } catch (err) { next(err); }
  }

  async softDelete(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.softDelete(pid(req), req.user!._id);
      res.json({ message: 'Canvas moved to trash' });
    } catch (err) { next(err); }
  }

  async restore(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.restore(pid(req), req.user!._id);
      res.json({ message: 'Canvas restored' });
    } catch (err) { next(err); }
  }

  async archive(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.archive(pid(req), req.user!._id);
      res.json({ message: 'Canvas archived' });
    } catch (err) { next(err); }
  }

  async duplicate(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const canvas = await canvasService.duplicate(pid(req), req.user!._id, req.body.title);
      res.status(201).json({ canvas });
    } catch (err) { next(err); }
  }

  async listPublic(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await canvasService.listPublic({
        q: req.query['q'] as string,
        category: req.query['category'] as string,
        sort: req.query['sort'] as string,
        page: Number(req.query['page'] ?? 1),
        limit: Number(req.query['limit'] ?? 20),
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  // ── Share tokens ──────────────────────────────────────────────────────────

  async joinByToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await canvasService.resolveShareToken(String(req.params['token']));
      res.json(result);
    } catch (err) { next(err); }
  }

  async createShareLink(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = await canvasService.createShareToken(pid(req), req.user!._id, req.body);
      res.status(201).json({ token });
    } catch (err) { next(err); }
  }

  async revokeShareLink(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.revokeShareToken(pid(req), req.user!._id, String(req.params['token']));
      res.json({ message: 'Share token revoked' });
    } catch (err) { next(err); }
  }

  // ── Collaborators ─────────────────────────────────────────────────────────

  async addCollaborator(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, userId, role } = req.body as any;

      let targetUser;
      if (userId) {
        targetUser = await UserModel.findById(userId).lean();
      } else if (email) {
        targetUser = await UserModel.findOne({ email: email.toLowerCase() }).lean();
      }
      if (!targetUser) throw new NotFoundError('User not found');

      await canvasService.addCollaborator(pid(req), req.user!._id, targetUser._id as Types.ObjectId, role);

      const canvas = await canvasService.getCanvas(pid(req), req.user!._id);
      await notificationService.create(targetUser._id as Types.ObjectId, 'canvas_invite', {
        canvasId: pid(req),
        canvasTitle: canvas.title,
        fromUserId: req.user!._id,
        role,
      });
      await notificationService.sendCanvasInviteEmail({
        toEmail: targetUser.email,
        toName: targetUser.fullName,
        fromName: req.user!.fullName,
        canvasTitle: canvas.title,
        role,
        canvasUrl: `${env.FRONTEND_URL}/canvas/${pid(req)}`,
      });

      res.status(201).json({ message: 'Collaborator added', userId: targetUser._id });
    } catch (err) { next(err); }
  }

  async updateCollaboratorRole(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.updateCollaboratorRole(
        pid(req),
        req.user!._id,
        new Types.ObjectId(String(req.params['uid'])),
        req.body.role,
      );
      res.json({ message: 'Role updated' });
    } catch (err) { next(err); }
  }

  async removeCollaborator(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.removeCollaborator(
        pid(req),
        req.user!._id,
        new Types.ObjectId(String(req.params['uid'])),
      );
      res.json({ message: 'Collaborator removed' });
    } catch (err) { next(err); }
  }

  async selfLeave(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await canvasService.removeCollaborator(pid(req), req.user!._id, req.user!._id);
      res.json({ message: 'Left canvas' });
    } catch (err) { next(err); }
  }

  async listCollaborators(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await canvasService.listCollaborators(pid(req));
      res.json(result);
    } catch (err) { next(err); }
  }
}

export const canvasController = new CanvasController();
