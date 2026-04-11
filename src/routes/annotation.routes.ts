import { Router } from 'express';
import { annotationController } from '../controllers/annotation.controller';
import { requireAuth, optionalAuth, requireCanvasRole } from '../middleware/auth.middleware';

const router = Router({ mergeParams: true });

router.get('/canvases/:id/annotations', optionalAuth, (req, res, next) => annotationController.list(req as any, res, next));
router.post('/canvases/:id/annotations', requireAuth, requireCanvasRole('commenter'), (req, res, next) => annotationController.create(req as any, res, next));
router.put('/canvases/:id/annotations/:aId', requireAuth, (req, res, next) => annotationController.update(req as any, res, next));
router.delete('/canvases/:id/annotations/:aId', requireAuth, (req, res, next) => annotationController.remove(req as any, res, next));
router.post('/canvases/:id/annotations/:aId/resolve', requireAuth, requireCanvasRole('commenter'), (req, res, next) => annotationController.resolve(req as any, res, next));
router.post('/canvases/:id/annotations/:aId/react', requireAuth, (req, res, next) => annotationController.react(req as any, res, next));

export default router;
