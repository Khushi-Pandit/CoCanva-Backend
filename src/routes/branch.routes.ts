import { Router } from 'express';
import { branchController } from '../controllers/branch.controller';
import { requireAuth, requireCanvasRole } from '../middleware/auth.middleware';

const router = Router({ mergeParams: true });

router.get('/canvases/:id/branches', requireAuth, (req, res, next) => branchController.list(req as any, res, next));
router.post('/canvases/:id/branches', requireAuth, requireCanvasRole('editor'), (req, res, next) => branchController.create(req as any, res, next));
router.get('/canvases/:id/branches/:bId/events', requireAuth, (req, res, next) => branchController.getEvents(req as any, res, next));
router.get('/canvases/:id/branches/:bId/snapshot/:seqNo', requireAuth, (req, res, next) => branchController.getSnapshot(req as any, res, next));
router.post('/canvases/:id/branches/:bId/merge', requireAuth, requireCanvasRole('owner'), (req, res, next) => branchController.merge(req as any, res, next));

export default router;
