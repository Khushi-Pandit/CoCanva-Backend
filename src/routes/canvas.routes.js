// FILE: src/routes/canvas.routes.js

const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

// ── PUBLIC route — NO auth required ──────────────────────────────────────────
// Must be registered BEFORE verifyFirebaseToken middleware.
// When a user opens a share link on a new device they are not logged in yet.
// This endpoint only resolves token → canvasId, no sensitive data is returned.
router.get('/join/:token', ctrl.resolveShareToken);

// ── All routes below require a valid Firebase token ───────────────────────────
router.use(verifyFirebaseToken);

router.get('/',        ctrl.getMyCanvases);
router.post('/',       ctrl.createCanvas);

router.get('/shared',  ctrl.getSharedWithMe);

// Canvas CRUD
router.get(   '/:canvasId', ctrl.getCanvas);
router.put(   '/:canvasId', ctrl.updateTitle);
router.delete('/:canvasId', ctrl.deleteCanvas);

// Canvas actions
router.post('/:canvasId/share',                  ctrl.generateShareLinks);
router.post('/:canvasId/save',                   ctrl.saveCanvasState);
router.post('/:canvasId/collaborator',           ctrl.addCollaborator);
router.delete('/:canvasId/collaborator/:userId', ctrl.removeCollaborator);

// AI features
router.post('/:canvasId/ai-summary', ctrl.getAISummary);
router.post('/:canvasId/ai-stroke',  ctrl.getAIStrokeSuggestion);

module.exports = router;