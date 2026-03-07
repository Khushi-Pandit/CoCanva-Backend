const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

router.use(verifyFirebaseToken);

// Dashboard routes
router.get('/',                                ctrl.getMyCanvases);      // list all my canvases
router.post('/',                               ctrl.createCanvas);       // create new canvas

// Share token resolution
router.get('/join/:token',                     ctrl.resolveShareToken);

// Canvas CRUD
router.get('/:canvasId',                       ctrl.getCanvas);
router.put('/:canvasId',                       ctrl.updateTitle);        // rename (PUT body: {title})
router.delete('/:canvasId',                    ctrl.deleteCanvas);

// Canvas actions
router.post('/:canvasId/share',                ctrl.generateShareLinks);
router.post('/:canvasId/save',                 ctrl.saveCanvasState);
router.post('/:canvasId/collaborator',         ctrl.addCollaborator);
router.delete('/:canvasId/collaborator/:userId', ctrl.removeCollaborator);

module.exports = router;