// FILE: src/socket/socketHandlers.js
// UPDATED: improved reconnect handling, viewport sync, undo tracking

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
        if (!hasAccess) { socket.emit('error', { message: 'Access denied.' }); return; }

        let effectiveRole = 'viewer';
        if (isOwner)             effectiveRole = 'owner';
        else if (collaborator)   effectiveRole = collaborator.role;
        else if (shareTokenRole) effectiveRole = shareTokenRole;

        // Auto-add collaborator if joined via share token
        if (!isOwner && !collaborator && shareTokenRole) {
          canvas.collaborators.push({ user: socket.user.uid, role: shareTokenRole });
          await canvas.save().catch(() => {});
        }

        socket.join(canvasId);
        socket.currentCanvasId = canvasId;
        socket.userRole        = effectiveRole;

        const userColor    = getNextColor();
        const resolvedName = userName || socket.user.name || 'Anonymous';
        socket.userName    = resolvedName;
        socket.userColor   = userColor;

        await ActiveSession.findOneAndUpdate(
          { socketId: socket.id },
          {
            canvasId, userId: socket.user.uid, socketId: socket.id,
            userName: resolvedName, userColor, role: effectiveRole, lastSeen: new Date(),
          },
          { upsert: true, new: true }
        );

        // Send full canvas state to the joining user
        socket.emit('canvas:state', {
          elements: canvas.elements,
          viewport: canvas.viewport,
        });
        socket.emit('canvas:role', { role: effectiveRole });

        // Broadcast updated user list to EVERYONE in the room
        const activeSessions = await ActiveSession.find({ canvasId });
        const usersList = activeSessions.map(s => ({
          userId:    s.userId,
          userName:  s.userName,
          userColor: s.userColor,
          role:      s.role,
          socketId:  s.socketId,
          cursor:    s.cursor,
        }));
        io.to(canvasId).emit('users:active', usersList);

        // Notify others
        socket.to(canvasId).emit('user:joined', {
          userId: socket.user.uid, userName: resolvedName,
          userColor, socketId: socket.id, role: effectiveRole,
        });

        console.log(`User ${resolvedName} joined canvas ${canvasId} as ${effectiveRole}`);
      } catch (err) {
        console.error('canvas:join error:', err);
        socket.emit('error', { message: 'Failed to join canvas' });
      }
    });

    // ── ELEMENT ADD ──────────────────────────────────────────────────────────
    socket.on('element:add', async ({ canvasId, element }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        // Tag element with creator so frontend can do per-user undo
        const taggedElement = { ...element, createdBy: socket.user.uid };
        socket.to(canvasId).emit('element:add', { element: taggedElement, userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, {
          $push: { elements: taggedElement },
          updatedAt: new Date(),
        });
      } catch (err) { console.error('element:add error:', err); }
    });

    // ── ELEMENT DELETE ───────────────────────────────────────────────────────
    socket.on('element:delete', async ({ canvasId, elementId }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('element:delete', { elementId, userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, {
          $pull: { elements: { elementId } },
          updatedAt: new Date(),
        });
      } catch (err) { console.error('element:delete error:', err); }
    });

    // ── ELEMENT MODIFY ───────────────────────────────────────────────────────
    socket.on('element:modify', async ({ canvasId, element }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('element:modify', { element, userId: socket.user.uid });
        await Canvas.findOneAndUpdate(
          { _id: canvasId, 'elements.elementId': element.elementId },
          { $set: { 'elements.$': element, updatedAt: new Date() } }
        );
      } catch (err) { console.error('element:modify error:', err); }
    });

    // ── CANVAS CLEAR ─────────────────────────────────────────────────────────
    socket.on('canvas:clear', async ({ canvasId }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        io.to(canvasId).emit('canvas:clear', { userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, {
          $set: { elements: [], updatedAt: new Date() },
        });
      } catch (err) { console.error('canvas:clear error:', err); }
    });

    // ── CANVAS SAVE ──────────────────────────────────────────────────────────
    socket.on('canvas:save', async ({ canvasId, elements, viewport }) => {
      if (!canEdit(socket.userRole)) return;
      try {
        await Canvas.findByIdAndUpdate(canvasId, { elements, viewport, updatedAt: new Date() }, { new: true });
        const savedAt = new Date();
        socket.to(canvasId).emit('canvas:saved', { userId: socket.user.uid, savedAt });
        socket.emit('canvas:saved', { userId: socket.user.uid, savedAt });
      } catch (err) { console.error('canvas:save error:', err); }
    });

    // ── CURSOR MOVE ──────────────────────────────────────────────────────────
    socket.on('cursor:move', ({ canvasId, x, y }) => {
      socket.to(canvasId).emit('cursor:move', {
        userId:    socket.user.uid,
        socketId:  socket.id,
        userName:  socket.userName  || 'Anonymous',
        userColor: socket.userColor || '#3B82F6',
        x, y,
      });
      // Fire-and-forget cursor update
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

    // ── VIEWPORT SYNC (optional: sync viewport for pair sessions) ────────────
    socket.on('viewport:sync', ({ canvasId, viewport }) => {
      socket.to(canvasId).emit('viewport:sync', {
        userId:   socket.user.uid,
        viewport,
      });
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const session = await ActiveSession.findOneAndDelete({ socketId: socket.id });
        if (session?.canvasId) {
          const roomId = session.canvasId.toString();
          const remaining = await ActiveSession.find({ canvasId: roomId });
          io.to(roomId).emit('users:active', remaining.map(s => ({
            userId: s.userId, userName: s.userName, userColor: s.userColor,
            role: s.role, socketId: s.socketId,
          })));
          socket.to(roomId).emit('user:left', {
            userId: session.userId, socketId: socket.id,
          });
        }
        console.log(`Socket disconnected: ${socket.id}`);
      } catch (err) { console.error('disconnect error:', err); }
    });
  });
};

module.exports = { registerSocketHandlers };