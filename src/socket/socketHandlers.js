// FILE: src/socket/socketHandlers.js

const Canvas        = require('../models/canvas.model');
const ActiveSession = require('../models/activeSession.model');
const admin         = require('../config/firebase');

const CURSOR_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F59E0B', '#6366F1', '#D946EF',
];
let colorIndex = 0;
const getNextColor = () => CURSOR_COLORS[(colorIndex++) % CURSOR_COLORS.length];

const verifyUser = async (token) => {
  try { return await admin.auth().verifyIdToken(token); }
  catch { return null; }
};

// owner + editor + voice can mutate canvas
const canEdit = (role) => role === 'owner' || role === 'editor' || role === 'voice';

const registerSocketHandlers = (io) => {

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication token missing'));
    const user = await verifyUser(token);
    if (!user) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} | User: ${socket.user.uid}`);

    // ── JOIN CANVAS ──────────────────────────────────────────────────────────
    socket.on('canvas:join', async ({ canvasId, userName, shareToken }) => {
      try {
        const canvas = await Canvas.findById(canvasId);
        if (!canvas) { socket.emit('error', { message: 'Canvas not found' }); return; }

        const isOwner      = canvas.owner.toString() === socket.user.uid;
        const collaborator = canvas.collaborators.find(c => c.user?.toString() === socket.user.uid);

        let shareTokenRole = null;
        if (shareToken) {
          const entry = canvas.shareTokens.find(t => t.token === shareToken);
          if (entry) shareTokenRole = entry.role;
        }

        const hasAccess = isOwner || !!collaborator || !!shareTokenRole;
        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied. Ask the owner for an invite link.' });
          return;
        }

        let effectiveRole = 'viewer';
        if (isOwner)             effectiveRole = 'owner';
        else if (collaborator)   effectiveRole = collaborator.role;
        else if (shareTokenRole) effectiveRole = shareTokenRole;

        socket.join(canvasId);
        socket.currentCanvasId = canvasId;
        socket.userRole        = effectiveRole;

        const userColor    = getNextColor();
        const resolvedName = userName || socket.user.name || 'Anonymous';

        // Store on socket for cursor:move / stroke:drawing enrichment
        socket.userName  = resolvedName;
        socket.userColor = userColor;

        await ActiveSession.findOneAndUpdate(
          { socketId: socket.id },
          {
            canvasId, userId: socket.user.uid, socketId: socket.id,
            userName: resolvedName, userColor, role: effectiveRole, lastSeen: new Date(),
          },
          { upsert: true, new: true }
        );

        // Send current canvas state to joining user
        socket.emit('canvas:state', { elements: canvas.elements, viewport: canvas.viewport });
        socket.emit('canvas:role',  { role: effectiveRole });

        // Send active users list (with socketId so frontend can build userInfoMap)
        const activeSessions = await ActiveSession.find({ canvasId });
        socket.emit('users:active', activeSessions.map(s => ({
          userId: s.userId, userName: s.userName, userColor: s.userColor,
          role: s.role, socketId: s.socketId, cursor: s.cursor,
        })));

        // Notify others
        socket.to(canvasId).emit('user:joined', {
          userId: socket.user.uid, userName: resolvedName,
          userColor, socketId: socket.id, role: effectiveRole,
        });

        console.log(`User ${socket.user.uid} joined canvas ${canvasId} as ${effectiveRole}`);
      } catch (err) {
        console.error('canvas:join error:', err);
        socket.emit('error', { message: 'Failed to join canvas' });
      }
    });

    // ── ELEMENT ADD ──────────────────────────────────────────────────────────
    // Broadcast to ALL in room (including viewers) so they see new elements
    socket.on('element:add', async ({ canvasId, element }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        // Broadcast to everyone else in the room (viewers included)
        socket.to(canvasId).emit('element:add', { element, userId: socket.user.uid });
        // Persist to DB
        await Canvas.findByIdAndUpdate(canvasId, { $push: { elements: element } });
      } catch (err) { console.error('element:add error:', err); }
    });

    // ── ELEMENT DELETE ───────────────────────────────────────────────────────
    socket.on('element:delete', async ({ canvasId, elementId }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('element:delete', { elementId, userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, { $pull: { elements: { elementId } } });
      } catch (err) { console.error('element:delete error:', err); }
    });

    // ── ELEMENT MODIFY ───────────────────────────────────────────────────────
    socket.on('element:modify', async ({ canvasId, element }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('element:modify', { element, userId: socket.user.uid });
        await Canvas.findOneAndUpdate(
          { _id: canvasId, 'elements.elementId': element.elementId },
          { $set: { 'elements.$': element } }
        );
      } catch (err) { console.error('element:modify error:', err); }
    });

    // ── CANVAS CLEAR ─────────────────────────────────────────────────────────
    socket.on('canvas:clear', async ({ canvasId }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('canvas:clear', { userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, { $set: { elements: [] } });
      } catch (err) { console.error('canvas:clear error:', err); }
    });

    // ── CANVAS SAVE (from frontend auto-save / manual save) ──────────────────
    // When one user explicitly saves, optionally notify others that state is fresh
    socket.on('canvas:save', async ({ canvasId, elements, viewport }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        await Canvas.findByIdAndUpdate(
          canvasId,
          { elements, viewport },
          { new: true }
        );
        // Optionally tell others the canvas was just saved (useful for "last saved" indicators)
        socket.to(canvasId).emit('canvas:saved', { userId: socket.user.uid, savedAt: new Date() });
        socket.emit('canvas:saved', { userId: socket.user.uid, savedAt: new Date() });
      } catch (err) { console.error('canvas:save error:', err); }
    });

    // ── CURSOR MOVE ──────────────────────────────────────────────────────────
    socket.on('cursor:move', async ({ canvasId, x, y }) => {
      socket.to(canvasId).emit('cursor:move', {
        userId:    socket.user.uid,
        socketId:  socket.id,
        userName:  socket.userName  || 'Anonymous',
        userColor: socket.userColor || '#3B82F6',
        x, y,
      });
      // Fire-and-forget DB update (no await — don't block emit)
      ActiveSession.findOneAndUpdate(
        { socketId: socket.id },
        { cursor: { x, y }, lastSeen: new Date() }
      ).catch(() => {});
    });

    // ── STROKE DRAWING (live preview) ────────────────────────────────────────
    socket.on('stroke:drawing', ({ canvasId, points, color, width, strokeType }) => {
      if (!canEdit(socket.userRole)) return;
      socket.to(canvasId).emit('stroke:drawing', {
        userId:    socket.user.uid,
        socketId:  socket.id,
        userName:  socket.userName  || 'Anonymous',
        userColor: socket.userColor || '#3B82F6',
        points, color, width, strokeType,
      });
    });

    // ── VOICE SIGNALS ────────────────────────────────────────────────────────
    socket.on('voice:signal', ({ targetSocketId, signal }) => {
      if (socket.userRole === 'viewer') return;
      io.to(targetSocketId).emit('voice:signal', { fromSocketId: socket.id, signal });
    });

    socket.on('voice:join', ({ canvasId }) => {
      if (socket.userRole === 'viewer') return;
      socket.to(canvasId).emit('voice:user-joined', { socketId: socket.id, userId: socket.user.uid });
    });

    socket.on('voice:leave', ({ canvasId }) => {
      socket.to(canvasId).emit('voice:user-left', { socketId: socket.id });
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const session = await ActiveSession.findOneAndDelete({ socketId: socket.id });
        if (session?.canvasId) {
          const roomId = session.canvasId.toString();
          socket.to(roomId).emit('user:left',       { userId: session.userId, socketId: socket.id });
          socket.to(roomId).emit('voice:user-left', { socketId: socket.id });
        }
        console.log(`Socket disconnected: ${socket.id}`);
      } catch (err) { console.error('disconnect error:', err); }
    });
  });
};

module.exports = { registerSocketHandlers };