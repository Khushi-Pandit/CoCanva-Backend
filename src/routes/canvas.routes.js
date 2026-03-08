const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

router.use(verifyFirebaseToken);

// IMPORTANT: specific routes BEFORE param routes
router.get( '/',            ctrl.getMyCanvases);
router.post('/',            ctrl.createCanvas);

// FIX: "join" must come before /:canvasId — otherwise "join" is treated as a canvasId
router.get('/join/:token',  ctrl.resolveShareToken);

// Canvas CRUD
router.get(   '/:canvasId',  ctrl.getCanvas);
router.put(   '/:canvasId',  ctrl.updateTitle);
router.delete('/:canvasId',  ctrl.deleteCanvas);

// Canvas actions
router.post('/:canvasId/share',                  ctrl.generateShareLinks);
router.post('/:canvasId/save',                   ctrl.saveCanvasState);
router.post('/:canvasId/collaborator',           ctrl.addCollaborator);
router.delete('/:canvasId/collaborator/:userId', ctrl.removeCollaborator);

module.exports = router;