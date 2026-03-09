// FILE: src/routes/canvas.routes.js
const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

router.use(verifyFirebaseToken);

// IMPORTANT: specific routes BEFORE param routes
router.get('/',        ctrl.getMyCanvases);
router.post('/',       ctrl.createCanvas);

// ── TASK 5: Shared canvases ───────────────────────────────────────────────────
router.get('/shared',  ctrl.getSharedWithMe);

// FIX: "join" must come before /:canvasId
router.get('/join/:token', ctrl.resolveShareToken);

// Canvas CRUD
router.get(   '/:canvasId', ctrl.getCanvas);
router.put(   '/:canvasId', ctrl.updateTitle);
router.delete('/:canvasId', ctrl.deleteCanvas);

// Canvas actions
router.post('/:canvasId/share',                  ctrl.generateShareLinks);
router.post('/:canvasId/save',                   ctrl.saveCanvasState);
router.post('/:canvasId/collaborator',           ctrl.addCollaborator);
router.delete('/:canvasId/collaborator/:userId', ctrl.removeCollaborator);

// ── TASK 2: AI features ──────────────────────────────────────────────────────
router.post('/:canvasId/ai-summary', ctrl.getAISummary);
router.post('/:canvasId/ai-stroke',  ctrl.getAIStrokeSuggestion);

module.exports = router;
