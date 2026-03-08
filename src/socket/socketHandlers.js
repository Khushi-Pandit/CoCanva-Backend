// FILE: src/socket/socketHandlers.js
//
// Key fix: share-link users ka role ab DB se verify hota hai (shareToken lookup)
// instead of canvas.isPublic check — jo always false tha aur sab deny ho rahe the.

const Canvas = require('../models/canvas.model');
const ActiveSession = require('../models/activeSession.model');
const admin = require('../config/firebase');

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

// Can this role mutate canvas content?
const canEdit = (role) => role === 'editor' || role === 'owner';

const registerSocketHandlers = (io) => {
  // ── Auth middleware ──────────────────────────────────────────────────────
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
    // Client sends: { canvasId, userName, shareToken? }
    // shareToken is the raw token from sessionStorage (set by join/[token]/page.tsx)
    // We verify it against DB — never trust role sent from client directly.
    socket.on('canvas:join', async ({ canvasId, userName, shareToken }) => {
      try {
        const canvas = await Canvas.findById(canvasId);
        if (!canvas) {
          socket.emit('error', { message: 'Canvas not found' });
          return;
        }

        const isOwner      = canvas.owner.toString() === socket.user.uid;
        const collaborator = canvas.collaborators.find(
          c => c.user?.toString() === socket.user.uid
        );

        // Resolve share token role from DB (never trust client-sent role)
        let shareTokenRole = null;
        if (shareToken) {
          const entry = canvas.shareTokens.find(t => t.token === shareToken);
          if (entry) shareTokenRole = entry.role;
        }

        // Access check: must be owner OR collaborator OR valid share token
        const hasAccess = isOwner || !!collaborator || !!shareTokenRole;
        if (!hasAccess) {
          socket.emit('error', { message: 'Access denied. Ask the owner for an invite link.' });
          return;
        }

        // Determine effective role — priority: owner > collaborator > shareToken
        let effectiveRole = 'viewer';
        if (isOwner)           effectiveRole = 'owner';
        else if (collaborator) effectiveRole = collaborator.role;
        else if (shareTokenRole) effectiveRole = shareTokenRole;

        socket.join(canvasId);
        socket.currentCanvasId = canvasId;
        socket.userRole = effectiveRole;

        const userColor = getNextColor();

        await ActiveSession.findOneAndUpdate(
          { socketId: socket.id },
          {
            canvasId,
            userId:    socket.user.uid,
            socketId:  socket.id,
            userName:  userName || socket.user.name || 'Anonymous',
            userColor,
            role:      effectiveRole,
            lastSeen:  new Date(),
          },
          { upsert: true, new: true }
        );

        // Send current canvas state to the joining user
        socket.emit('canvas:state', {
          elements: canvas.elements,
          viewport: canvas.viewport,
        });

        // Tell the frontend what role this user has
        socket.emit('canvas:role', { role: effectiveRole });

        // Send active users list to the joining user
        const activeSessions = await ActiveSession.find({ canvasId });
        socket.emit('users:active', activeSessions.map(s => ({
          userId:    s.userId,
          userName:  s.userName,
          userColor: s.userColor,
          role:      s.role,
          cursor:    s.cursor,
        })));

        // Notify others that someone joined
        socket.to(canvasId).emit('user:joined', {
          userId:    socket.user.uid,
          userName:  userName || socket.user.name || 'Anonymous',
          userColor,
          socketId:  socket.id,
          role:      effectiveRole,
        });

        console.log(`User ${socket.user.uid} joined canvas ${canvasId} as ${effectiveRole}`);
      } catch (err) {
        console.error('canvas:join error:', err);
        socket.emit('error', { message: 'Failed to join canvas' });
      }
    });

    // ── ELEMENT ADD ──────────────────────────────────────────────────────────
    socket.on('element:add', async ({ canvasId, element }) => {
      if (!canEdit(socket.userRole)) return; // viewers cannot draw
      try {
        socket.to(canvasId).emit('element:add', { element, userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, { $push: { elements: element } });
      } catch (err) {
        console.error('element:add error:', err);
      }
    });

    // ── ELEMENT DELETE ───────────────────────────────────────────────────────
    socket.on('element:delete', async ({ canvasId, elementId }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('element:delete', { elementId, userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, { $pull: { elements: { elementId } } });
      } catch (err) {
        console.error('element:delete error:', err);
      }
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
      } catch (err) {
        console.error('element:modify error:', err);
      }
    });

    // ── CANVAS CLEAR ─────────────────────────────────────────────────────────
    socket.on('canvas:clear', async ({ canvasId }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('canvas:clear', { userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, { $set: { elements: [] } });
      } catch (err) {
        console.error('canvas:clear error:', err);
      }
    });

    // ── CURSOR MOVE ──────────────────────────────────────────────────────────
    socket.on('cursor:move', async ({ canvasId, x, y }) => {
      socket.to(canvasId).emit('cursor:move', {
        userId:   socket.user.uid,
        socketId: socket.id,
        x, y,
      });
      await ActiveSession.findOneAndUpdate(
        { socketId: socket.id },
        { cursor: { x, y }, lastSeen: new Date() }
      );
    });

    // ── STROKE DRAWING (live preview) ────────────────────────────────────────
    socket.on('stroke:drawing', ({ canvasId, points, color, width, strokeType }) => {
      if (!canEdit(socket.userRole)) return;
      socket.to(canvasId).emit('stroke:drawing', {
        userId: socket.user.uid,
        points, color, width, strokeType,
      });
    });

    // ── VOICE SIGNALS (WebRTC) ───────────────────────────────────────────────
    socket.on('voice:signal', ({ canvasId, targetSocketId, signal }) => {
      if (socket.userRole === 'viewer') return;
      io.to(targetSocketId).emit('voice:signal', {
        fromSocketId: socket.id,
        signal,
      });
    });

    socket.on('voice:join', ({ canvasId }) => {
      if (socket.userRole === 'viewer') return;
      socket.to(canvasId).emit('voice:user-joined', {
        socketId: socket.id,
        userId:   socket.user.uid,
      });
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
          socket.to(roomId).emit('user:left', {
            userId:   session.userId,
            socketId: socket.id,
          });
          socket.to(roomId).emit('voice:user-left', { socketId: socket.id });
        }
        console.log(`Socket disconnected: ${socket.id}`);
      } catch (err) {
        console.error('disconnect error:', err);
      }
    });
  });
};

module.exports = { registerSocketHandlers };