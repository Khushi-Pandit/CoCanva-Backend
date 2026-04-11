import { Router } from 'express';
import { canvasController } from '../controllers/canvas.controller';
import { canvasService } from '../services/canvas.service';
import { requireAuth, optionalAuth, requireCanvasRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { z } from 'zod';
import { getIO } from '../config/socket';

const router = Router();

const createCanvasSchema = z.object({
  title: z.string().max(200).optional(),
  category: z.enum(['flowchart', 'architecture', 'brainstorm', 'wireframe', 'erd', 'other']).optional(),
  settings: z.record(z.unknown()).optional(),
  templateId: z.string().optional(),
});

const updateCanvasSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  category: z.enum(['flowchart', 'architecture', 'brainstorm', 'wireframe', 'erd', 'other']).optional(),
  isPublic: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

const collaboratorSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().optional(),
  role: z.enum(['viewer', 'editor', 'commenter']),
  message: z.string().optional(),
});

// Public canvases browse
router.get('/canvases/public', optionalAuth, (req, res, next) => canvasController.listPublic(req as any, res, next));

// My canvases (listed under user routes but kept here for cohesion)
router.get('/users/me/canvases', requireAuth, async (req: any, res, next) => {
  try {
    const result = await canvasService.listMyCanvases(req.user!._id, {
      page: Number(req.query['page'] ?? 1),
      limit: Number(req.query['limit'] ?? 20),
      search: req.query['search'] as string,
      category: req.query['category'] as any,
      tags: req.query['tags'] ? String(req.query['tags']).split(',') : undefined,
      sort: req.query['sort'] as string,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/users/me/shared', requireAuth, async (req: any, res, next) => {
  try {
    const result = await canvasService.listSharedWithMe(
      req.user!._id,
      Number(req.query['page'] ?? 1),
      Number(req.query['limit'] ?? 20),
    );
    res.json(result);
  } catch (err) { next(err); }
});

// Share token join
router.get('/canvases/join/:token', optionalAuth, (req, res, next) => canvasController.joinByToken(req as any, res, next));

// Canvas CRUD
router.post('/canvases', requireAuth, validate(createCanvasSchema), (req, res, next) => canvasController.create(req as any, res, next));
router.get('/canvases/:id', optionalAuth, (req, res, next) => canvasController.get(req as any, res, next));
router.put('/canvases/:id', requireAuth, requireCanvasRole('editor'), validate(updateCanvasSchema), (req, res, next) => canvasController.update(req as any, res, next));
router.delete('/canvases/:id', requireAuth, requireCanvasRole('owner'), (req, res, next) => canvasController.softDelete(req as any, res, next));

// Canvas actions
router.post('/canvases/:id/restore', requireAuth, (req, res, next) => canvasController.restore(req as any, res, next));
router.post('/canvases/:id/archive', requireAuth, requireCanvasRole('owner'), (req, res, next) => canvasController.archive(req as any, res, next));
router.post('/canvases/:id/duplicate', requireAuth, (req, res, next) => canvasController.duplicate(req as any, res, next));

// Share links
router.post('/canvases/:id/share', requireAuth, requireCanvasRole('owner'), (req, res, next) => canvasController.createShareLink(req as any, res, next));
router.delete('/canvases/:id/share/:token', requireAuth, requireCanvasRole('owner'), (req, res, next) => canvasController.revokeShareLink(req as any, res, next));

// Collaborators
router.get('/canvases/:id/collaborators', requireAuth, (req, res, next) => canvasController.listCollaborators(req as any, res, next));
router.post('/canvases/:id/collaborators', requireAuth, requireCanvasRole('owner'), validate(collaboratorSchema), (req, res, next) => canvasController.addCollaborator(req as any, res, next));
router.put('/canvases/:id/collaborators/:uid', requireAuth, requireCanvasRole('owner'), (req, res, next) => canvasController.updateCollaboratorRole(req as any, res, next));
router.delete('/canvases/:id/collaborators/:uid', requireAuth, requireCanvasRole('owner'), (req, res, next) => canvasController.removeCollaborator(req as any, res, next));
router.post('/canvases/:id/leave', requireAuth, (req, res, next) => canvasController.selfLeave(req as any, res, next));

// Thumbnail — PUT /canvases/:id/thumbnail
router.put('/canvases/:id/thumbnail', requireAuth, requireCanvasRole('editor'), async (req: any, res, next) => {
  try {
    const { thumbnailService } = await import('../services/thumbnail.service');
    const { data } = req.body as { data: string }; // base64 data URL
    if (!data) { res.status(400).json({ error: 'Missing thumbnail data' }); return; }
    const url = await thumbnailService.saveThumbnail(String(req.params['id']), data);
    getIO().to(String(req.params['id'])).emit('canvas:thumbnail', { url });
    res.json({ url });
  } catch (err) { next(err); }
});

export default router;
