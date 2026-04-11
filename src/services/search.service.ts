import { CanvasModel } from '../models/canvas.model';
import { CanvasElementModel } from '../models/canvas-element.model';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export class SearchService {
  /**
   * Full-text canvas search using MongoDB $text index.
   * Falls back gracefully — no Atlas Vector Search required.
   */
  async searchCanvases(
    userId: string,
    opts: {
      q: string;
      type?: 'text' | 'semantic' | 'hybrid';
      category?: string;
      tags?: string[];
      page: number;
      limit: number;
    },
  ): Promise<any> {
    const filter: Record<string, unknown> = {
      deletedAt: null,
      $or: [
        { owner: userId },
        { 'collaborators.user': userId },
        { isPublic: true },
      ],
    };

    if (opts.category) filter['category'] = opts.category;
    if (opts.tags?.length) filter['tags'] = { $all: opts.tags };

    if (opts.q && opts.q.trim()) {
      filter['$text'] = { $search: opts.q };
    }

    const projection = opts.q ? { score: { $meta: 'textScore' } } : {};
    const sort = opts.q
      ? { score: { $meta: 'textScore' } }
      : { updatedAt: -1 };

    const [items, total] = await Promise.all([
      CanvasModel.find(filter, projection)
        .sort(sort as any)
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .populate('owner', 'fullName avatarUrl')
        .select('-shareTokens')
        .lean(),
      CanvasModel.countDocuments(filter),
    ]);

    return { items, total, page: opts.page, limit: opts.limit, searchType: 'text' };
  }

  /**
   * Search canvas elements by text content across all accessible canvases.
   */
  async searchElements(
    userId: string,
    query: string,
    opts: { page: number; limit: number },
  ): Promise<any> {
    // First get accessible canvas IDs
    const canvases = await CanvasModel.find({
      deletedAt: null,
      $or: [
        { owner: userId },
        { 'collaborators.user': userId },
        { isPublic: true },
      ],
    })
      .select('_id title')
      .limit(1000)
      .lean();

    const canvasIds = canvases.map((c) => c._id);
    const labelFilter = query
      ? {
          canvasId: { $in: canvasIds },
          isDeleted: false,
          $or: [
            { label: { $regex: query, $options: 'i' } },
            { text: { $regex: query, $options: 'i' } },
          ],
        }
      : { canvasId: { $in: canvasIds }, isDeleted: false };

    const [elements, total] = await Promise.all([
      CanvasElementModel.find(labelFilter)
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .select('elementId type subtype label text x y canvasId')
        .lean(),
      CanvasElementModel.countDocuments(labelFilter),
    ]);

    // Enrich with canvas title
    const canvasMap = new Map(canvases.map((c) => [c._id.toString(), c.title]));
    const enriched = elements.map((el) => ({
      ...el,
      canvasTitle: canvasMap.get(el.canvasId.toString()) ?? 'Unknown',
    }));

    return { items: enriched, total, page: opts.page, limit: opts.limit };
  }
}

export const searchService = new SearchService();
