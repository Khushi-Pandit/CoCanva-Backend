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

const canEditRole = (role) => role === 'owner' || role === 'editor' || role === 'voice';

// ── Helper: resolve the effective role for a Firebase UID on a canvas ─────────
// BUG FIX: canvas.owner is a MongoDB User _id, NOT a Firebase UID.
// We must look up the User document by firebaseUid to get their MongoDB _id,
// then compare against canvas.owner and canvas.collaborators[].user.
// Without this, isOwner is ALWAYS false and collaborator is ALWAYS null,
// so every user is treated as having no access via the share token path only.
const resolveRole = async (canvas, firebaseUid, shareToken) => {
  // Lazy-require to avoid circular deps
  const User = require('../models/user.model');

  // Find the MongoDB user document for this Firebase UID
  const user = await User.findOne({ firebaseUid }).select('_id').lean();

  let isOwner      = false;
  let collaborator = null;

  if (user) {
    isOwner      = canvas.owner?.toString() === user._id.toString();
    collaborator = canvas.collaborators.find(
      (c) => c.user?.toString() === user._id.toString()
    );
  }

  // Share token role
  let shareTokenRole = null;
  if (shareToken) {
    const entry = canvas.shareTokens.find((t) => t.token === shareToken);
    if (entry) shareTokenRole = entry.role;
  }

  const hasAccess = isOwner || !!collaborator || !!shareTokenRole;

  let effectiveRole = null;
  if (isOwner)             effectiveRole = 'owner';
  else if (collaborator)   effectiveRole = collaborator.role;
  else if (shareTokenRole) effectiveRole = shareTokenRole;

  return { hasAccess, effectiveRole, mongoUserId: user?._id, isOwner, collaborator, shareTokenRole };
};

const registerSocketHandlers = (io) => {

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication token missing'));
    const decoded = await verifyUser(token);
    if (!decoded) return next(new Error('Invalid or expired token'));
    socket.user = decoded;
    // BUG FIX: Firebase Admin decoded token has `name` as display_name,
    // but it may be undefined if the user has no display name set.
    // Store it explicitly so we never fall back to 'Anonymous'.
    socket.user.displayName = decoded.name || decoded.email?.split('@')[0] || `User_${decoded.uid.slice(0, 6)}`;
    next();
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} | UID: ${socket.user.uid} | Name: ${socket.user.displayName}`);

    // ── JOIN CANVAS ──────────────────────────────────────────────────────────
    socket.on('canvas:join', async ({ canvasId, userName, shareToken }) => {
      try {
        // BUG FIX: Always fetch a fresh copy of canvas from DB.
        // If owner draws and saves, the DB is updated. New joiner must get
        // the latest elements — not a stale in-memory copy.
        const canvas = await Canvas.findById(canvasId).lean();
        if (!canvas) {
          socket.emit('error', { message: 'Canvas not found' });
          return;
        }

        const { hasAccess, effectiveRole, mongoUserId, isOwner, collaborator, shareTokenRole } =
          await resolveRole(canvas, socket.user.uid, shareToken);

        if (!hasAccess || !effectiveRole) {
          socket.emit('error', { message: 'Access denied.' });
          return;
        }

        // Auto-add as collaborator in DB if joined via share token
        if (!isOwner && !collaborator && shareTokenRole && mongoUserId) {
          await Canvas.findByIdAndUpdate(canvasId, {
            $push: { collaborators: { user: mongoUserId, role: shareTokenRole } },
          }).catch((err) => console.error('auto-add collaborator error:', err));
        }

        socket.join(canvasId);
        socket.currentCanvasId = canvasId;
        socket.userRole        = effectiveRole;

        const userColor = getNextColor();
        // BUG FIX: prefer the userName sent by the client (comes from Firebase
        // Auth user.displayName on the frontend), then fall back to token fields.
        // socket.user.name is NOT a standard Firebase Admin field — use displayName.
        const resolvedName = (userName && userName.trim() && userName !== 'Anonymous')
          ? userName.trim()
          : socket.user.displayName;

        socket.userName  = resolvedName;
        socket.userColor = userColor;

        // Upsert active session
        await ActiveSession.findOneAndUpdate(
          { socketId: socket.id },
          {
            canvasId,
            userId:    mongoUserId,
            socketId:  socket.id,
            userName:  resolvedName,
            userColor,
            role:      effectiveRole,
            lastSeen:  new Date(),
          },
          { upsert: true, new: true }
        );

        // BUG FIX: Send the CURRENT canvas state from DB (lean() gives plain
        // object with latest elements saved via element:add / canvas:save).
        // Previously stale in-memory canvas was sometimes used.
        socket.emit('canvas:state', {
          elements: canvas.elements || [],
          viewport: canvas.viewport  || { x: 0, y: 0, zoom: 1 },
        });
        socket.emit('canvas:role', { role: effectiveRole });

        // Broadcast updated user list to everyone in the room
        const activeSessions = await ActiveSession.find({ canvasId });
        const usersList = activeSessions.map((s) => ({
          userId:    s.userId,
          userName:  s.userName,
          userColor: s.userColor,
          role:      s.role,
          socketId:  s.socketId,
          cursor:    s.cursor,
        }));
        io.to(canvasId).emit('users:active', usersList);

        // Notify others that someone joined
        socket.to(canvasId).emit('user:joined', {
          userId:    socket.user.uid,
          userName:  resolvedName,
          userColor,
          socketId:  socket.id,
          role:      effectiveRole,
        });

        console.log(`[join] ${resolvedName} (${socket.user.uid}) → canvas ${canvasId} as ${effectiveRole}`);
      } catch (err) {
        console.error('canvas:join error:', err);
        socket.emit('error', { message: 'Failed to join canvas' });
      }
    });

    // ── ELEMENT ADD ──────────────────────────────────────────────────────────
    socket.on('element:add', async ({ canvasId, element }) => {
      if (!canEditRole(socket.userRole)) return;
      try {
        const taggedElement = { ...element, createdBy: socket.user.uid };
        // Broadcast to other clients immediately (low latency)
        socket.to(canvasId).emit('element:add', { element: taggedElement, userId: socket.user.uid });
        // Persist to DB
        await Canvas.findByIdAndUpdate(canvasId, {
          $push: { elements: taggedElement },
          updatedAt: new Date(),
        });
      } catch (err) { console.error('element:add error:', err); }
    });

    // ── ELEMENT DELETE ───────────────────────────────────────────────────────
    socket.on('element:delete', async ({ canvasId, elementId }) => {
      if (!canEditRole(socket.userRole)) return;
      try {
        socket.to(canvasId).emit('element:delete', { elementId, userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, {
          $pull: { elements: { $or: [{ elementId }, { id: elementId }] } },
          updatedAt: new Date(),
        });
      } catch (err) { console.error('element:delete error:', err); }
    });

    // ── ELEMENT MODIFY ───────────────────────────────────────────────────────
    socket.on('element:modify', async ({ canvasId, element }) => {
      if (!canEditRole(socket.userRole)) return;
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
      if (!canEditRole(socket.userRole)) return;
      try {
        io.to(canvasId).emit('canvas:clear', { userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, {
          $set: { elements: [], updatedAt: new Date() },
        });
      } catch (err) { console.error('canvas:clear error:', err); }
    });

    // ── CANVAS SAVE ──────────────────────────────────────────────────────────
    socket.on('canvas:save', async ({ canvasId, elements, viewport }) => {
      if (!canEditRole(socket.userRole)) return;
      try {
        await Canvas.findByIdAndUpdate(
          canvasId,
          { elements, viewport, updatedAt: new Date() },
          { new: true }
        );
        const savedAt = new Date();
        io.to(canvasId).emit('canvas:saved', { userId: socket.user.uid, savedAt });
      } catch (err) { console.error('canvas:save error:', err); }
    });

    // ── CURSOR MOVE ──────────────────────────────────────────────────────────
    socket.on('cursor:move', ({ canvasId, x, y }) => {
      socket.to(canvasId).emit('cursor:move', {
        userId:    socket.user.uid,
        socketId:  socket.id,
        userName:  socket.userName  || socket.user.displayName,
        userColor: socket.userColor || '#3B82F6',
        x, y,
      });
      ActiveSession.findOneAndUpdate(
        { socketId: socket.id },
        { cursor: { x, y }, lastSeen: new Date() }
      ).catch(() => {});
    });

    // ── STROKE DRAWING (live preview) ────────────────────────────────────────
    socket.on('stroke:drawing', ({ canvasId, points, color, width, strokeType }) => {
      if (!canEditRole(socket.userRole)) return;
      socket.to(canvasId).emit('stroke:drawing', {
        userId:    socket.user.uid,
        socketId:  socket.id,
        userName:  socket.userName  || socket.user.displayName,
        userColor: socket.userColor || '#3B82F6',
        points, color, width, strokeType,
      });
    });

    // ── VIEWPORT SYNC ────────────────────────────────────────────────────────
    socket.on('viewport:sync', ({ canvasId, viewport }) => {
      socket.to(canvasId).emit('viewport:sync', {
        userId: socket.user.uid,
        viewport,
      });
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const session = await ActiveSession.findOneAndDelete({ socketId: socket.id });
        if (session?.canvasId) {
          const roomId   = session.canvasId.toString();
          const remaining = await ActiveSession.find({ canvasId: roomId });
          io.to(roomId).emit('users:active', remaining.map((s) => ({
            userId:    s.userId,
            userName:  s.userName,
            userColor: s.userColor,
            role:      s.role,
            socketId:  s.socketId,
          })));
          socket.to(roomId).emit('user:left', {
            userId:   session.userId,
            socketId: socket.id,
          });
        }
        console.log(`Socket disconnected: ${socket.id}`);
      } catch (err) { console.error('disconnect error:', err); }
    });
  });
};

module.exports = { registerSocketHandlers };