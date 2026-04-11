import { Types } from 'mongoose';
import crypto from 'crypto';
import { CanvasModel, ICanvasDocument } from '../models/canvas.model';
import { CanvasElementModel } from '../models/canvas-element.model';
import { CanvasBranchModel } from '../models/canvas-branch.model';
import {
  ICanvas, ICanvasWithRole, CanvasRole, CanvasCategory,
} from '../types/canvas.types';
import {
  NotFoundError, ForbiddenError, ConflictError, ValidationError,
} from '../utils/errors';
import { cacheGet, cacheSet, cacheDel, CACHE_TTL } from '../config/redis';
import { logger } from '../utils/logger';
import { getSafeId } from '../utils/id.util';
import { lockManager } from '../socket/rooms/LockManager';
import { generatePresignedDownloadUrl } from '../config/storage';

async function mapThumbnails<T extends { thumbnailKey?: string | null, thumbnail?: string | null }>(items: T[]): Promise<T[]> {
  return Promise.all(items.map(async (item) => {
    if (item.thumbnailKey) {
      try {
        item.thumbnail = await generatePresignedDownloadUrl(item.thumbnailKey, 86400); // 24 hours
      } catch (err) {
         // ignore
      }
    }
    return item;
  }));
}

export class CanvasService {
  // ── Create ────────────────────────────────────────────────────────────────

  async createCanvas(
    userId: Types.ObjectId,
    data: {
      title?: string;
      category?: CanvasCategory;
      settings?: Partial<ICanvas['settings']>;
      templateId?: string;
    },
  ): Promise<ICanvasDocument> {
    const canvas = await CanvasModel.create({
      title: data.title ?? 'Untitled Canvas',
      category: data.category ?? 'other',
      owner: userId,
      settings: data.settings ?? {},
    });

    // Create default branch
    const branch = await CanvasBranchModel.create({
      canvasId: canvas._id,
      name: 'main',
      createdBy: userId,
    });

    await CanvasModel.updateOne(
      { _id: canvas._id },
      { defaultBranch: branch._id, currentBranch: branch._id },
    );

    logger.info('Canvas created', { canvasId: canvas._id, userId });
    return canvas;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async getCanvas(
    canvasId: string,
    userId?: Types.ObjectId,
    shareToken?: string,
  ): Promise<ICanvasWithRole> {
    const cacheKey = `canvas:${canvasId}:meta`;
    let canvas = await cacheGet<ICanvas>(cacheKey);

    if (!canvas) {
      const doc = await CanvasModel.findById(canvasId)
        .populate('owner', 'fullName email avatarUrl avatarId')
        .lean();
      if (!doc || doc.deletedAt) throw new NotFoundError('Canvas not found');
      canvas = doc as unknown as ICanvas;
      await cacheSet(cacheKey, canvas, CACHE_TTL.CANVAS_META);
    }

    const role = this.resolveRole(canvas, userId, shareToken);
    if (!role) throw new ForbiddenError('You do not have access to this canvas');

    const mappedCanvases = await mapThumbnails([canvas]);
    return { ...mappedCanvases[0]!, myRole: role };
  }

  resolveRole(
    canvas: ICanvas,
    userId?: Types.ObjectId,
    shareToken?: string,
  ): CanvasRole | null {
    if (userId) {
      const uidStr = getSafeId(userId);
      const ownerIdStr = getSafeId(canvas.owner);
      if (ownerIdStr === uidStr) return 'owner';

      const collab = canvas.collaborators?.find((c) => getSafeId(c.user) === uidStr);
      if (collab) return collab.role as CanvasRole;
    }
    if (shareToken) {
      const t = canvas.shareTokens.find(
        (st) =>
          st.token === shareToken &&
          !st.revokedAt &&
          (!st.expiresAt || new Date(st.expiresAt) > new Date()) &&
          (!st.maxUses || st.useCount < st.maxUses),
      );
      if (t) return t.role as CanvasRole;
    }
    if (canvas.isPublic) return 'viewer';
    return null;
  }

  async listMyCanvases(
    userId: Types.ObjectId,
    opts: {
      page: number; limit: number; search?: string;
      category?: CanvasCategory; tags?: string[]; sort?: string;
    },
  ) {
    const filter: Record<string, unknown> = {
      owner: userId,
      deletedAt: null,
      archivedAt: null,
    };
    if (opts.category) filter['category'] = opts.category;
    if (opts.tags?.length) filter['tags'] = { $all: opts.tags };
    if (opts.search) filter['title'] = { $regex: opts.search, $options: 'i' };

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      recent: { updatedAt: -1 },
      oldest: { createdAt: 1 },
      title: { title: 1 },
    };
    const sort = sortMap[opts.sort ?? 'recent'] ?? { updatedAt: -1 };

    const [items, total] = await Promise.all([
      CanvasModel.find(filter)
        .sort(sort)
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .select('-shareTokens -collaborators')
        .lean(),
      CanvasModel.countDocuments(filter),
    ]);

    const mapped = await mapThumbnails(items);
    return { items: mapped, total, page: opts.page, limit: opts.limit };
  }

  async listSharedWithMe(userId: Types.ObjectId, page: number, limit: number): Promise<any> {
    const filter = { 'collaborators.user': userId, deletedAt: null };
    const [items, total] = await Promise.all([
      CanvasModel.find(filter)
        .populate('owner', 'fullName avatarUrl')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CanvasModel.countDocuments(filter),
    ]);

    // Attach myRole
    const enriched = items.map((c) => {
      const collab = c.collaborators.find(
        (col) => col.user.toString() === userId.toString(),
      );
      return { ...c, myRole: collab?.role ?? 'viewer' };
    });

    const mapped = await mapThumbnails(enriched);
    return { items: mapped, total, page, limit };
  }

  async listPublic(opts: { q?: string; category?: string; sort?: string; page: number; limit: number }) {
    const filter: Record<string, unknown> = { isPublic: true, deletedAt: null };
    if (opts.category) filter['category'] = opts.category;
    if (opts.q) filter['$text'] = { $search: opts.q };

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      trending: { activeUserCount: -1 },
      popular: { elementCount: -1 },
      recent: { updatedAt: -1 },
    };

    const [items, total] = await Promise.all([
      CanvasModel.find(filter)
        .sort(sortMap[opts.sort ?? 'recent'] ?? { updatedAt: -1 })
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .select('-shareTokens')
        .populate('owner', 'fullName avatarUrl')
        .lean(),
      CanvasModel.countDocuments(filter),
    ]);

    const mapped = await mapThumbnails(items);
    return { items: mapped, total, page: opts.page, limit: opts.limit };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCanvas(
    canvasId: string,
    userId: Types.ObjectId,
    data: Partial<Pick<ICanvas, 'title' | 'description' | 'tags' | 'category' | 'settings' | 'isPublic'>>,
  ): Promise<ICanvasDocument> {
    const canvas = await CanvasModel.findByIdAndUpdate(
      canvasId,
      { $set: data },
      { new: true, runValidators: true },
    );
    if (!canvas) throw new NotFoundError('Canvas not found');
    await cacheDel(`canvas:${canvasId}:meta`);
    return canvas;
  }

  // ── Delete / Archive / Restore ────────────────────────────────────────────

  async softDelete(canvasId: string, userId: Types.ObjectId): Promise<void> {
    const res = await CanvasModel.updateOne(
      { _id: canvasId, owner: userId },
      { deletedAt: new Date() },
    );
    if (!res.matchedCount) throw new NotFoundError('Canvas not found or not owner');
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  async restore(canvasId: string, userId: Types.ObjectId): Promise<void> {
    const res = await CanvasModel.updateOne(
      { _id: canvasId, owner: userId },
      { deletedAt: null },
    );
    if (!res.matchedCount) throw new NotFoundError('Canvas not found or not owner');
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  async archive(canvasId: string, userId: Types.ObjectId): Promise<void> {
    await CanvasModel.updateOne({ _id: canvasId, owner: userId }, { archivedAt: new Date() });
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  // ── Duplicate ─────────────────────────────────────────────────────────────

  async duplicate(
    canvasId: string,
    userId: Types.ObjectId,
    newTitle?: string,
  ): Promise<ICanvasDocument> {
    const source = await CanvasModel.findById(canvasId).lean();
    if (!source) throw new NotFoundError('Canvas not found');

    const newCanvas = await CanvasModel.create({
      title: newTitle ?? `${source.title} (Copy)`,
      description: source.description,
      owner: userId,
      category: source.category,
      tags: source.tags,
      settings: source.settings,
      forkOf: source._id,
    });

    // Deep-copy elements
    const elements = await CanvasElementModel.find({
      canvasId: source._id,
      isDeleted: false,
    }).lean();

    if (elements.length > 0) {
      const copies = elements.map(({ _id, canvasId: _cid, ...rest }) => ({
        ...rest,
        canvasId: newCanvas._id,
        createdBy: userId,
        updatedBy: userId,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      await CanvasElementModel.insertMany(copies);
      await CanvasModel.updateOne({ _id: newCanvas._id }, { elementCount: copies.length });
    }

    logger.info('Canvas duplicated', { from: canvasId, to: newCanvas._id });
    return newCanvas;
  }

  // ── Share Tokens ──────────────────────────────────────────────────────────

  async createShareToken(
    canvasId: string,
    userId: Types.ObjectId,
    opts: {
      role: 'viewer' | 'editor' | 'commenter';
      label?: string;
      expiresIn?: number; // days
      maxUses?: number;
    },
  ): Promise<string> {
    const token = crypto.randomBytes(20).toString('hex');
    const expiresAt = opts.expiresIn
      ? new Date(Date.now() + opts.expiresIn * 24 * 3600 * 1000)
      : null;

    await CanvasModel.updateOne(
      { _id: canvasId, owner: userId },
      {
        $push: {
          shareTokens: {
            token,
            role: opts.role,
            label: opts.label ?? '',
            expiresAt,
            maxUses: opts.maxUses ?? null,
            useCount: 0,
            createdAt: new Date(),
            revokedAt: null,
          },
        },
      },
    );
    await cacheDel(`canvas:${canvasId}:meta`);
    return token;
  }

  async revokeShareToken(canvasId: string, userId: Types.ObjectId, token: string): Promise<void> {
    await CanvasModel.updateOne(
      { _id: canvasId, owner: userId, 'shareTokens.token': token },
      { $set: { 'shareTokens.$.revokedAt': new Date() } },
    );
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  async resolveShareToken(token: string): Promise<{ canvasId: string; title: string; role: string; expiresAt: Date | null }> {
    const canvas = await CanvasModel.findOne({ 'shareTokens.token': token }).lean();
    if (!canvas) throw new NotFoundError('Invalid share token');

    const entry = canvas.shareTokens.find((t) => t.token === token);
    if (!entry || entry.revokedAt) throw new NotFoundError('Share token revoked or invalid');
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
      throw new ValidationError('Share token has expired');
    }

    return { canvasId: canvas._id.toString(), title: canvas.title, role: entry.role, expiresAt: entry.expiresAt };
  }

  // ── Collaborators ─────────────────────────────────────────────────────────

  async addCollaborator(
    canvasId: string,
    ownerId: Types.ObjectId,
    targetUserId: Types.ObjectId,
    role: 'viewer' | 'editor' | 'commenter',
  ): Promise<void> {
    const existing = await CanvasModel.findOne({
      _id: canvasId,
      'collaborators.user': targetUserId,
    });
    if (existing) throw new ConflictError('User is already a collaborator');

    await CanvasModel.updateOne(
      { _id: canvasId, owner: ownerId },
      {
        $push: {
          collaborators: {
            user: targetUserId,
            role,
            addedAt: new Date(),
            addedBy: ownerId,
          },
        },
      },
    );
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  async updateCollaboratorRole(
    canvasId: string,
    ownerId: Types.ObjectId,
    targetUserId: Types.ObjectId,
    role: 'viewer' | 'editor' | 'commenter',
  ): Promise<void> {
    await CanvasModel.updateOne(
      { _id: canvasId, owner: ownerId, 'collaborators.user': targetUserId },
      { $set: { 'collaborators.$.role': role } },
    );
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  async removeCollaborator(
    canvasId: string,
    ownerId: Types.ObjectId,
    targetUserId: Types.ObjectId,
  ): Promise<void> {
    await CanvasModel.updateOne(
      { _id: canvasId, owner: ownerId },
      { $pull: { collaborators: { user: targetUserId } } },
    );
    await cacheDel(`canvas:${canvasId}:meta`);
  }

  async listCollaborators(canvasId: string) {
    const canvas = await CanvasModel.findById(canvasId)
      .populate('collaborators.user', 'fullName email avatarUrl avatarId lastSeenAt')
      .populate('owner', 'fullName email avatarUrl avatarId lastSeenAt')
      .lean();
    if (!canvas) throw new NotFoundError('Canvas not found');
    return { owner: canvas.owner, collaborators: canvas.collaborators };
  }
}

export const canvasService = new CanvasService();
