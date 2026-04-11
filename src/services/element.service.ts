import { Types } from 'mongoose';
import { CanvasElementModel } from '../models/canvas-element.model';
import { CanvasModel } from '../models/canvas.model';
import { CanvasEventModel } from '../models/canvas-event.model';
import { ICanvasElement } from '../types/element.types';
import { NotFoundError } from '../utils/errors';
import { sanitizeElement } from '../utils/sanitize';
import { simplifyStroke } from '../utils/geometry';
import { cacheDel, cacheGet, cacheSet, CACHE_TTL } from '../config/redis';
import { logger } from '../utils/logger';

export class ElementService {
  /**
   * Returns all live elements for a canvas, sorted by zIndex.
   * Supports optional viewport bounding box for spatial filtering.
   */
  async getElements(
    canvasId: string,
    opts: { minX?: number; minY?: number; maxX?: number; maxY?: number } = {},
  ): Promise<ICanvasElement[]> {
    const cacheKey = `canvas:${canvasId}:elements`;
    const cached = await cacheGet<ICanvasElement[]>(cacheKey);
    if (cached && !Object.values(opts).some(Boolean)) return cached;

    const filter: Record<string, unknown> = { canvasId, isDeleted: false };
    if (opts.minX !== undefined && opts.maxX !== undefined) {
      filter['x'] = { $gte: opts.minX, $lte: opts.maxX };
    }
    if (opts.minY !== undefined && opts.maxY !== undefined) {
      filter['y'] = { $gte: opts.minY, $lte: opts.maxY };
    }

    const elements = await CanvasElementModel.find(filter)
      .sort({ zIndex: 1 })
      .lean() as unknown as ICanvasElement[];

    if (!Object.values(opts).some(Boolean)) {
      await cacheSet(cacheKey, elements, CACHE_TTL.CANVAS_ELEMENTS);
    }

    return elements;
  }

  async getElementById(canvasId: string, elementId: string): Promise<ICanvasElement> {
    const el = await CanvasElementModel.findOne({ canvasId, elementId, isDeleted: false }).lean();
    if (!el) throw new NotFoundError(`Element ${elementId} not found`);
    return el as unknown as ICanvasElement;
  }

  /**
   * Bulk upsert: upserts "elements", soft-deletes "deletedIds".
   * Uses MongoDB bulkWrite(ordered:false) for parallelism.
   */
  async bulkSave(
    canvasId: Types.ObjectId,
    userId: Types.ObjectId,
    elements: Partial<ICanvasElement>[],
    deletedIds: string[],
    branchId?: Types.ObjectId,
    sessionId?: string,
  ): Promise<{ upserted: number; deleted: number }> {
    // Upsert ops with version increment
    const upsertOps = elements.map((raw) => {
      const cleaned = sanitizeElement(raw as Record<string, unknown>);
      if (!cleaned['elementId']) return null;
      if (cleaned['points'] && Array.isArray(cleaned['points'])) {
        cleaned['points'] = simplifyStroke(cleaned['points'] as any[], 1.5);
      }
      delete cleaned['version']; // Prevent MongoDB conflict with $inc
      return {
        updateOne: {
          filter: { canvasId, elementId: cleaned['elementId'] },
          update: {
            $set: {
              ...cleaned,
              canvasId,
              updatedBy: userId,
            },
            $setOnInsert: { createdBy: userId },
            $inc: { version: 1 },
          },
          upsert: true,
        },
      };
    }).filter(Boolean);

    const deleteOps = deletedIds.map((elementId) => ({
      updateOne: {
        filter: { canvasId, elementId },
        update: { $set: { isDeleted: true, updatedBy: userId } },
      },
    }));

    const allOps = [...upsertOps, ...deleteOps] as any[];
    if (!allOps.length) return { upserted: 0, deleted: 0 };

    const result = await CanvasElementModel.bulkWrite(allOps, { ordered: false });

    // Update canvas element count
    const liveCount = await CanvasElementModel.countDocuments({ canvasId, isDeleted: false });
    await CanvasModel.updateOne({ _id: canvasId }, { elementCount: liveCount });

    // Invalidate cache
    await cacheDel(`canvas:${canvasId}:elements`);

    // Write event sourcing record
    if (branchId) {
      await this.writeEvent(canvasId, branchId, userId, sessionId ?? 'bulk', {
        type: 'element_batch',
        payload: { added: elements.map((e) => e.elementId), deletedIds },
      });
    }

    return {
      upserted: (result.upsertedCount ?? 0) + (result.modifiedCount ?? 0),
      deleted: deleteOps.length,
    };
  }

  /**
   * Single element upsert (used by socket handlers for immediate saves).
   */
  async upsertElement(
    canvasId: Types.ObjectId,
    userId: Types.ObjectId,
    element: Partial<ICanvasElement>,
  ): Promise<ICanvasElement> {
    const cleaned = sanitizeElement(element as Record<string, unknown>);
    if (cleaned['points'] && Array.isArray(cleaned['points'])) {
      cleaned['points'] = simplifyStroke(cleaned['points'] as any[], 1.5);
    }
    delete cleaned['version']; // Prevent MongoDB conflict with $inc

    const doc = await CanvasElementModel.findOneAndUpdate(
      { canvasId, elementId: cleaned['elementId'] },
      {
        $set: { ...cleaned, canvasId, updatedBy: userId },
        $setOnInsert: { createdBy: userId },
        $inc: { version: 1 },
      },
      { upsert: true, new: true },
    );

    await cacheDel(`canvas:${canvasId}:elements`);
    return doc as unknown as ICanvasElement;
  }

  /**
   * Soft-delete multiple elements, release locks.
   */
  async deleteElements(
    canvasId: Types.ObjectId,
    elementIds: string[],
    userId: Types.ObjectId,
  ): Promise<void> {
    await CanvasElementModel.updateMany(
      { canvasId, elementId: { $in: elementIds } },
      { $set: { isDeleted: true, updatedBy: userId } },
    );
    await cacheDel(`canvas:${canvasId}:elements`);
  }

  /**
   * Accept ghost AI elements (set isGhostSuggestion = false).
   */
  async acceptGhostElements(
    canvasId: Types.ObjectId,
    elementIds: string[],
    userId: Types.ObjectId,
  ): Promise<void> {
    await CanvasElementModel.updateMany(
      { canvasId, elementId: { $in: elementIds } },
      { $set: { isGhostSuggestion: false, updatedBy: userId } },
    );
    await cacheDel(`canvas:${canvasId}:elements`);
  }

  /**
   * Dismiss all ghost suggestions for a canvas.
   */
  async dismissGhosts(canvasId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    await CanvasElementModel.updateMany(
      { canvasId, isGhostSuggestion: true },
      { $set: { isDeleted: true, updatedBy: userId } },
    );
    await cacheDel(`canvas:${canvasId}:elements`);
  }

  private async writeEvent(
    canvasId: Types.ObjectId,
    branchId: Types.ObjectId,
    userId: Types.ObjectId,
    sessionId: string,
    event: { type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    try {
      const lastEvent = await CanvasEventModel.findOne(
        { canvasId, branchId },
        {},
        { sort: { sequenceNo: -1 } },
      ).lean();
      const sequenceNo = (lastEvent?.sequenceNo ?? 0) + 1;

      await CanvasEventModel.create({
        canvasId,
        branchId,
        sequenceNo,
        type: event.type,
        payload: event.payload,
        prevState: {},
        userId,
        sessionId,
        clientTimestamp: new Date(),
      });
    } catch (err) {
      logger.warn('Failed to write canvas event', { error: (err as Error).message });
    }
  }
}

export const elementService = new ElementService();
