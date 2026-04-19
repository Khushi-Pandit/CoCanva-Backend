import { Router } from 'express';
import { pageController } from '../controllers/page.controller';
import { requireAuth, requireCanvasRole } from '../middleware/auth.middleware';

const router = Router();

// All page routes require auth + canvas membership
router.get(
  '/canvases/:id/pages',
  requireAuth,
  requireCanvasRole('viewer'),
  (req, res, next) => pageController.list(req as any, res, next),
);

// Idempotent: creates page 0 if it doesn't exist, returns it if it does.
// Safe for concurrent calls (uses MongoDB upsert atomically).
router.post(
  '/canvases/:id/pages/ensure-first',
  requireAuth,
  requireCanvasRole('editor'),
  (req, res, next) => pageController.ensureFirst(req as any, res, next),
);

router.post(
  '/canvases/:id/pages',
  requireAuth,
  requireCanvasRole('editor'),
  (req, res, next) => pageController.add(req as any, res, next),
);

router.patch(
  '/canvases/:id/pages/reorder',
  requireAuth,
  requireCanvasRole('editor'),
  (req, res, next) => pageController.reorder(req as any, res, next),
);

router.patch(
  '/canvases/:id/pages/:pageIndex/label',
  requireAuth,
  requireCanvasRole('editor'),
  (req, res, next) => pageController.rename(req as any, res, next),
);

router.delete(
  '/canvases/:id/pages/:pageIndex',
  requireAuth,
  requireCanvasRole('editor'),
  (req, res, next) => pageController.remove(req as any, res, next),
);

router.post(
  '/canvases/:id/pages/:pageIndex/summarize',
  requireAuth,
  requireCanvasRole('viewer'),
  (req, res, next) => pageController.summarize(req as any, res, next),
);

router.post(
  '/canvases/:id/pages/ask',
  requireAuth,
  requireCanvasRole('viewer'),
  (req, res, next) => pageController.ask(req as any, res, next),
);

router.post(
  '/canvases/:id/pages/full-summary',
  requireAuth,
  requireCanvasRole('viewer'),
  (req, res, next) => pageController.fullSummary(req as any, res, next),
);

export default router;
