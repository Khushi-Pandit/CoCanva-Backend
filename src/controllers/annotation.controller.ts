import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { AnnotationModel } from '../models/annotation.model';
import { notificationService } from '../services/notification.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { Types } from 'mongoose';

export class AnnotationController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const filter: Record<string, unknown> = {
        canvasId: req.params['id'],
        isDeleted: false,
      };
      if (req.query['elementId']) filter['attachedToElementId'] = req.query['elementId'];
      if (req.query['resolved'] === 'false') filter['resolvedAt'] = null;

      const annotations = await AnnotationModel.find(filter)
        .sort({ createdAt: -1 })
        .populate('author', 'fullName avatarUrl avatarId')
        .populate('resolvedBy', 'fullName')
        .lean();

      res.json({ annotations });
    } catch (err) { next(err); }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { text, region, attachedToElementId, parentId } = req.body as any;
      const annotation = await AnnotationModel.create({
        canvasId: req.params['id'],
        text,
        region: region ?? null,
        attachedToElementId: attachedToElementId ?? null,
        parentId: parentId ? new Types.ObjectId(parentId) : null,
        author: req.user!._id,
      });

      const populated = await annotation.populate('author', 'fullName avatarUrl avatarId');
      res.status(201).json({ annotation: populated });
    } catch (err) { next(err); }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const annotation = await AnnotationModel.findById(req.params['aId']);
      if (!annotation) throw new NotFoundError('Annotation not found');
      if (annotation.author.toString() !== req.user!._id.toString()) {
        throw new ForbiddenError('Only the author can edit this annotation');
      }
      annotation.text = req.body.text ?? annotation.text;
      if (req.body.attachments) annotation.attachments = req.body.attachments;
      await annotation.save();
      res.json({ annotation });
    } catch (err) { next(err); }
  }

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const annotation = await AnnotationModel.findById(req.params['aId']);
      if (!annotation) throw new NotFoundError('Annotation not found');

      const isAuthor = annotation.author.toString() === req.user!._id.toString();
      const isOwner = req.canvasRole === 'owner';
      if (!isAuthor && !isOwner) throw new ForbiddenError('Cannot delete this annotation');

      annotation.isDeleted = true;
      await annotation.save();
      res.json({ message: 'Annotation deleted' });
    } catch (err) { next(err); }
  }

  async resolve(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const annotation = await AnnotationModel.findByIdAndUpdate(
        req.params['aId'],
        { resolvedAt: new Date(), resolvedBy: req.user!._id },
        { new: true },
      );
      if (!annotation) throw new NotFoundError('Annotation not found');
      res.json({ annotation });
    } catch (err) { next(err); }
  }

  async react(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { emoji } = req.body as { emoji: string };
      const userId = req.user!._id;

      const annotation = await AnnotationModel.findById(req.params['aId']);
      if (!annotation) throw new NotFoundError('Annotation not found');

      const existing = annotation.reactions.find((r) => r.emoji === emoji);
      if (existing) {
        const idx = existing.users.findIndex((u) => u.toString() === userId.toString());
        if (idx >= 0) existing.users.splice(idx, 1);
        else existing.users.push(userId);
      } else {
        annotation.reactions.push({ emoji, users: [userId] });
      }

      await annotation.save();
      res.json({ reactions: annotation.reactions });
    } catch (err) { next(err); }
  }
}

export const annotationController = new AnnotationController();
