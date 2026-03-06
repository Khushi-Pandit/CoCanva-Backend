const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

// All routes require auth except shared link
router.get('/shared/:token', ctrl.getSharedCanvas);

router.use(verifyFirebaseToken);

router.get('/my', ctrl.getMyCanvases);
router.post('/create', ctrl.createCanvas);
router.get('/:canvasId', ctrl.getCanvas);
router.delete('/:canvasId', ctrl.deleteCanvas);
router.patch('/:canvasId/title', ctrl.updateTitle);
router.post('/:canvasId/share', ctrl.generateShareLink);
router.post('/:canvasId/collaborator', ctrl.addCollaborator);
router.delete('/:canvasId/collaborator/:userId', ctrl.removeCollaborator);
router.post('/:canvasId/save', ctrl.saveCanvasState);

module.exports = router;