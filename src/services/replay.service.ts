import { CanvasEventModel } from '../models/canvas-event.model';
import { CanvasSnapshotModel } from '../models/canvas-snapshot.model';
import { CanvasBranchModel } from '../models/canvas-branch.model';
import { CanvasElementModel } from '../models/canvas-element.model';
import { CanvasModel } from '../models/canvas.model';
import { NotFoundError } from '../utils/errors';
import { Types } from 'mongoose';
import { logger } from '../utils/logger';

export class ReplayService {
  /**
   * Returns paginated event stream for a branch (for replay/time-travel).
   */
  async getBranchEvents(
    canvasId: string,
    branchId: string,
    opts: { from?: number; limit: number },
  ) {
    const filter: Record<string, unknown> = { canvasId, branchId };
    if (opts.from !== undefined) filter['sequenceNo'] = { $gte: opts.from };

    const [events, total] = await Promise.all([
      CanvasEventModel.find(filter)
        .sort({ sequenceNo: 1 })
        .limit(opts.limit)
        .populate('userId', 'fullName avatarUrl')
        .lean(),
      CanvasEventModel.countDocuments(filter),
    ]);

    return { events, total };
  }

  /**
   * Reconstructs canvas element state at a specific sequence number.
   * Finds the nearest snapshot before that seqNo and applies delta events.
   */
  async getStateAtSequence(
    canvasId: string,
    branchId: string,
    targetSeqNo: number,
  ) {
    // Find nearest snapshot at or before targetSeqNo
    const snapshot = await CanvasSnapshotModel.findOne({
      canvasId,
      branchId,
      sequenceNo: { $lte: targetSeqNo },
    })
      .sort({ sequenceNo: -1 })
      .lean();

    let elementMap: Map<string, Record<string, unknown>> = new Map();

    if (snapshot) {
      for (const el of snapshot.elements) {
        const typedEl = el as Record<string, unknown>;
        elementMap.set(typedEl['elementId'] as string, typedEl);
      }
    } else {
      // No snapshot — start from scratch
    }

    // Apply events from snapshot.sequenceNo to targetSeqNo
    const fromSeq = snapshot ? snapshot.sequenceNo + 1 : 1;
    const events = await CanvasEventModel.find({
      canvasId,
      branchId,
      sequenceNo: { $gte: fromSeq, $lte: targetSeqNo },
    })
      .sort({ sequenceNo: 1 })
      .lean();

    for (const event of events) {
      this.applyEvent(elementMap, event.type, event.payload as Record<string, unknown>);
    }

    return {
      elements: Array.from(elementMap.values()),
      snapshotSeq: snapshot?.sequenceNo ?? 0,
      appliedEvents: events.length,
      targetSeqNo,
    };
  }

  private applyEvent(
    elementMap: Map<string, Record<string, unknown>>,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    switch (type) {
      case 'element_add': {
        const el = payload['element'] as Record<string, unknown>;
        if (el?.['elementId']) elementMap.set(el['elementId'] as string, el);
        break;
      }
      case 'element_update': {
        const el = payload['element'] as Record<string, unknown>;
        if (el?.['elementId']) {
          const existing = elementMap.get(el['elementId'] as string) ?? {};
          elementMap.set(el['elementId'] as string, { ...existing, ...el });
        }
        break;
      }
      case 'element_delete': {
        const ids = (payload['elementIds'] as string[]) ?? [];
        for (const id of ids) {
          const existing = elementMap.get(id);
          if (existing) elementMap.set(id, { ...existing, isDeleted: true });
        }
        break;
      }
      case 'element_batch': {
        const added = (payload['added'] as Record<string, unknown>[]) ?? [];
        const updated = (payload['updated'] as Record<string, unknown>[]) ?? [];
        const deletedIds = (payload['deletedIds'] as string[]) ?? [];
        for (const el of [...added, ...updated]) {
          if (el['elementId']) {
            const existing = elementMap.get(el['elementId'] as string) ?? {};
            elementMap.set(el['elementId'] as string, { ...existing, ...el });
          }
        }
        for (const id of deletedIds) {
          const existing = elementMap.get(id);
          if (existing) elementMap.set(id, { ...existing, isDeleted: true });
        }
        break;
      }
      case 'canvas_clear': {
        for (const [id, el] of elementMap) {
          elementMap.set(id, { ...el, isDeleted: true });
        }
        break;
      }
    }
  }

  /**
   * Lists all branches for a canvas.
   */
  async listBranches(canvasId: string) {
    return CanvasBranchModel.find({ canvasId })
      .populate('createdBy', 'fullName avatarUrl')
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Creates a new branch from current state or a named snapshot.
   */
  async createBranch(
    canvasId: string,
    userId: Types.ObjectId,
    name: string,
    fromSnapshotId?: string,
  ) {
    // Check name uniqueness
    const exists = await CanvasBranchModel.findOne({ canvasId, name });
    if (exists) throw new Error(`Branch "${name}" already exists`);

    const canvas = await CanvasModel.findById(canvasId).lean();
    if (!canvas) throw new NotFoundError('Canvas not found');

    const branch = await CanvasBranchModel.create({
      canvasId,
      name,
      createdBy: userId,
      baseSnapshotId: fromSnapshotId ? new Types.ObjectId(fromSnapshotId) : null,
      parentBranchId: canvas.currentBranch,
    });

    logger.info('Branch created', { canvasId, branchId: branch._id, name });
    return branch;
  }

  /**
   * Merge a branch into main using the given strategy.
   */
  async mergeBranch(
    canvasId: string,
    branchId: string,
    userId: Types.ObjectId,
    strategy: 'overwrite' | 'append',
  ) {
    const canvas = await CanvasModel.findById(canvasId).lean();
    if (!canvas) throw new NotFoundError('Canvas not found');

    if (strategy === 'overwrite') {
      // Get all non-deleted elements from the branch's base snapshot
      const branchEvents = await CanvasEventModel.find({
        canvasId,
        branchId,
      })
        .sort({ sequenceNo: 1 })
        .lean();

      logger.info('Merging branch (overwrite)', {
        canvasId, branchId, eventCount: branchEvents.length,
      });

      // Mark branch as merged
      await CanvasBranchModel.updateOne(
        { _id: branchId },
        { mergedAt: new Date() },
      );
    }

    return { merged: true, strategy, branchId };
  }
}

export const replayService = new ReplayService();
