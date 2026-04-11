import { Router } from 'express';
import { searchController } from '../controllers/search.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/search/canvases', requireAuth, (req, res, next) => searchController.searchCanvases(req as any, res, next));
router.get('/search/elements', requireAuth, (req, res, next) => searchController.searchElements(req as any, res, next));

export default router;
