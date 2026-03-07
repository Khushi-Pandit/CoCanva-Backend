const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

router.use(verifyFirebaseToken);

// ── IMPORTANT: specific routes BEFORE param routes ────────────────────────────

// Dashboard
router.get( '/',            ctrl.getMyCanvases);   // GET  /api/v1/canvas
router.post('/',            ctrl.createCanvas);    // POST /api/v1/canvas

// Share token — must be before /:canvasId so "join" isn't treated as a canvasId
router.get('/join/:token',  ctrl.resolveShareToken);

// Canvas CRUD
router.get(   '/:canvasId',  ctrl.getCanvas);
router.put(   '/:canvasId',  ctrl.updateTitle);    // rename { title }
router.delete('/:canvasId',  ctrl.deleteCanvas);

// Canvas actions
router.post('/:canvasId/share',                    ctrl.generateShareLinks);
router.post('/:canvasId/save',                     ctrl.saveCanvasState);
router.post('/:canvasId/collaborator',             ctrl.addCollaborator);
router.delete('/:canvasId/collaborator/:userId',   ctrl.removeCollaborator);

module.exports = router;