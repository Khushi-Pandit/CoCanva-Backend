import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { searchService } from '../services/search.service';

export class SearchController {
  async searchCanvases(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await searchService.searchCanvases(req.user!._id.toString(), {
        q: req.query['q'] as string ?? '',
        type: req.query['type'] as any,
        category: req.query['category'] as string,
        tags: req.query['tags'] ? String(req.query['tags']).split(',') : undefined,
        page: Number(req.query['page'] ?? 1),
        limit: Number(req.query['limit'] ?? 20),
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  async searchElements(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await searchService.searchElements(
        req.user!._id.toString(),
        req.query['q'] as string ?? '',
        { page: Number(req.query['page'] ?? 1), limit: Number(req.query['limit'] ?? 20) },
      );
      res.json(result);
    } catch (err) { next(err); }
  }
}

export const searchController = new SearchController();
