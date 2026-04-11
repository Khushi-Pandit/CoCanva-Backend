import { Router } from 'express';
import { aiController } from '../controllers/ai.controller';
import { requireAuth, optionalAuth, requireCanvasRole } from '../middleware/auth.middleware';
import { aiRateLimit } from '../middleware/rateLimit.middleware';

const router = Router({ mergeParams: true });

// Provider info
router.get('/canvases/:id/ai/providers', requireAuth, (req, res, next) => aiController.providers(req as any, res, next));

// Agent chat (new primary — returns structured actions)
router.post('/canvases/:id/ai/agent', requireAuth, aiRateLimit, (req, res, next) => aiController.agentChat(req as any, res, next));

// Per-element explanation
router.post('/canvases/:id/ai/explain', requireAuth, aiRateLimit, requireCanvasRole('viewer'), (req, res, next) => aiController.explainElement(req as any, res, next));

// Tab ghost suggest-next
router.post('/canvases/:id/ai/suggest-next', requireAuth, aiRateLimit, requireCanvasRole('viewer'), (req, res, next) => aiController.suggestNext(req as any, res, next));

// Legacy endpoints (kept for compatibility)
router.post('/canvases/:id/ai/chat', requireAuth, aiRateLimit, (req, res, next) => aiController.chat(req as any, res, next));
router.post('/canvases/:id/ai/summarize', requireAuth, aiRateLimit, (req, res, next) => aiController.summarize(req as any, res, next));
router.post('/canvases/:id/ai/suggest', requireAuth, aiRateLimit, requireCanvasRole('viewer'), (req, res, next) => aiController.ghostSuggest(req as any, res, next));
router.post('/canvases/:id/ai/layout', requireAuth, requireCanvasRole('editor'), (req, res, next) => aiController.autoLayout(req as any, res, next));
router.post('/canvases/:id/ai/code-to-diagram', requireAuth, aiRateLimit, requireCanvasRole('editor'), (req, res, next) => aiController.codeToDiagram(req as any, res, next));
router.post('/canvases/:id/ai/diagram-to-code', requireAuth, aiRateLimit, (req, res, next) => aiController.diagramToCode(req as any, res, next));
router.post('/canvases/:id/ai/accept-ghost', requireAuth, requireCanvasRole('editor'), (req, res, next) => aiController.acceptGhosts(req as any, res, next));
router.delete('/canvases/:id/ai/ghosts', requireAuth, requireCanvasRole('editor'), (req, res, next) => aiController.dismissGhosts(req as any, res, next));

export default router;
