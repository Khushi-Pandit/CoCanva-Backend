import { Router } from 'express';
import { elementController } from '../controllers/element.controller';
import { requireAuth, optionalAuth, requireCanvasRole } from '../middleware/auth.middleware';
import multer from 'multer';
import { uploadRateLimit } from '../middleware/rateLimit.middleware';

const router = Router({ mergeParams: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Elements
router.get('/canvases/:id/elements', optionalAuth, (req, res, next) => elementController.getElements(req as any, res, next));
router.get('/canvases/:id/elements/:elementId', optionalAuth, (req, res, next) => elementController.getElementById(req as any, res, next));
router.post('/canvases/:id/elements/save', requireAuth, requireCanvasRole('editor'), (req, res, next) => elementController.bulkSave(req as any, res, next));
router.post('/canvases/:id/elements/import', requireAuth, requireCanvasRole('editor'), (req, res, next) => elementController.importElements(req as any, res, next));
router.get('/canvases/:id/elements/export', optionalAuth, (req, res, next) => elementController.exportElements(req as any, res, next));

// Thumbnail
router.post(
  '/canvases/:id/thumbnail',
  requireAuth,
  requireCanvasRole('editor'),
  upload.single('file'),
  (req, res, next) => elementController.uploadThumbnail(req as any, res, next),
);

// Asset upload
router.post('/assets/upload', requireAuth, uploadRateLimit, (req, res, next) => elementController.getPresignedUpload(req as any, res, next));
router.delete('/assets/:assetId', requireAuth, (req, res, next) => elementController.deleteAsset(req as any, res, next));

export default router;
