'use strict';
const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/canvas.controller');

// ── PUBLIC — no auth required ─────────────────────────────────────────────────
router.get('/join/:token', ctrl.resolveShareToken);

// ── All routes below require a valid Firebase token ───────────────────────────
router.use(verifyFirebaseToken);

// Canvas list
router.get('/',       ctrl.getMyCanvases);
router.get('/shared', ctrl.getSharedWithMe);

// Canvas CRUD
router.post(  '/',          ctrl.createCanvas);
router.get(   '/:canvasId', ctrl.getCanvas);
router.put(   '/:canvasId', ctrl.updateCanvas);
router.delete('/:canvasId', ctrl.deleteCanvas);

// Duplicate
router.post('/:canvasId/duplicate', ctrl.duplicateCanvas);

// Elements: load + bulk save
router.get( '/:canvasId/elements', ctrl.getElements);
router.post('/:canvasId/save',     ctrl.saveCanvasState);

// Thumbnail
router.post('/:canvasId/thumbnail', ctrl.saveThumbnail);

// Sharing
router.post(  '/:canvasId/share',       ctrl.generateShareLinks);
router.delete('/:canvasId/share/:role', ctrl.revokeShareLink);

// Collaborators
router.post(  '/:canvasId/collaborator',         ctrl.addCollaborator);
router.put(   '/:canvasId/collaborator/:userId',  ctrl.updateCollaboratorRole);
router.delete('/:canvasId/collaborator/:userId',  ctrl.removeCollaborator);

// Self-remove from a shared canvas
router.post('/:canvasId/leave', ctrl.leaveCanvas);

// ── AI ────────────────────────────────────────────────────────────────────────
// NEW: Conversational AI chat with canvas context awareness
router.post('/:canvasId/ai-chat',    ctrl.aiChat);
// Legacy summary + stroke suggestion (kept for backwards compatibility)
router.post('/:canvasId/ai-summary', ctrl.getAISummary);
router.post('/:canvasId/ai-stroke',  ctrl.getAIStrokeSuggestion);

module.exports = router;