const Canvas = require('../models/canvas.model');
const ActiveSession = require('../models/activeSession.model');
const admin = require('../config/firebase');

// Assign a unique color to each collaborator cursor
const CURSOR_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899',
  '#14B8A6', '#F59E0B', '#6366F1', '#D946EF',
];

let colorIndex = 0;
const getNextColor = () => {
  const color = CURSOR_COLORS[colorIndex % CURSOR_COLORS.length];
  colorIndex++;
  return color;
};

// Verify Firebase token and get user info
const verifyUser = async (token) => {
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
  } catch {
    return null;
  }
};

const registerSocketHandlers = (io) => {
  // Middleware: authenticate every socket connection
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication token missing'));
    }
    const user = await verifyUser(token);
    if (!user) {
      return next(new Error('Invalid token'));
    }
    socket.user = user; // attach decoded user to socket
    next();
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} | User: ${socket.user.uid}`);

    // ─────────────────────────────────────────
    // JOIN CANVAS ROOM
    // ─────────────────────────────────────────
    socket.on('canvas:join', async ({ canvasId, userName }) => {
      try {
        const canvas = await Canvas.findById(canvasId);
        if (!canvas) {
          socket.emit('error', { message: 'Canvas not found' });
          return;
        }

        // Check access: owner OR collaborator OR public
        const isOwner = canvas.owner.toString() === socket.user.uid;
        const isCollaborator = canvas.collaborators.some(
          (c) => c.user?.toString() === socket.user.uid
        );
        if (!canvas.isPublic && !isOwner && !isCollaborator) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Join Socket.io room
        socket.join(canvasId);
        socket.currentCanvasId = canvasId;

        const userColor = getNextColor();

        // Save active session to DB
        await ActiveSession.findOneAndUpdate(
          { socketId: socket.id },
          {
            canvasId,
            userId: socket.user.uid,
            socketId: socket.id,
            userName: userName || socket.user.name || 'Anonymous',
            userColor,
            lastSeen: new Date(),
          },
          { upsert: true, new: true }
        );

        // Send current canvas state to the joining user
        socket.emit('canvas:state', {
          elements: canvas.elements,
          viewport: canvas.viewport,
        });

        // Get all active users in this room
        const activeSessions = await ActiveSession.find({ canvasId });
        const activeUsers = activeSessions.map((s) => ({
          userId: s.userId,
          userName: s.userName,
          userColor: s.userColor,
          cursor: s.cursor,
        }));

        // Tell joining user about existing users
        socket.emit('users:active', activeUsers);

        // Tell existing users someone joined
        socket.to(canvasId).emit('user:joined', {
          userId: socket.user.uid,
          userName: userName || socket.user.name || 'Anonymous',
          userColor,
          socketId: socket.id,
        });

        console.log(`User ${socket.user.uid} joined canvas ${canvasId}`);
      } catch (err) {
        console.error('canvas:join error:', err);
        socket.emit('error', { message: 'Failed to join canvas' });
      }
    });

    // ─────────────────────────────────────────
    // ELEMENT ADDED (stroke / shape / text)
    // ─────────────────────────────────────────
    socket.on('element:add', async ({ canvasId, element }) => {
      try {
        // Broadcast to everyone else in room immediately (low latency)
        socket.to(canvasId).emit('element:add', { element, userId: socket.user.uid });

        // Persist to DB
        await Canvas.findByIdAndUpdate(canvasId, {
          $push: { elements: element },
        });
      } catch (err) {
        console.error('element:add error:', err);
      }
    });

    // ─────────────────────────────────────────
    // ELEMENT DELETED
    // ─────────────────────────────────────────
    socket.on('element:delete', async ({ canvasId, elementId }) => {
      try {
        socket.to(canvasId).emit('element:delete', { elementId, userId: socket.user.uid });

        await Canvas.findByIdAndUpdate(canvasId, {
          $pull: { elements: { elementId } },
        });
      } catch (err) {
        console.error('element:delete error:', err);
      }
    });

    // ─────────────────────────────────────────
    // ELEMENT MODIFIED
    // ─────────────────────────────────────────
    socket.on('element:modify', async ({ canvasId, element }) => {
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

    // ─────────────────────────────────────────
    // CLEAR CANVAS
    // ─────────────────────────────────────────
    socket.on('canvas:clear', async ({ canvasId }) => {
      try {
        socket.to(canvasId).emit('canvas:clear', { userId: socket.user.uid });
        await Canvas.findByIdAndUpdate(canvasId, { $set: { elements: [] } });
      } catch (err) {
        console.error('canvas:clear error:', err);
      }
    });

    // ─────────────────────────────────────────
    // CURSOR MOVE (throttled on frontend)
    // ─────────────────────────────────────────
    socket.on('cursor:move', async ({ canvasId, x, y }) => {
      // Broadcast to room (no DB write — too frequent)
      socket.to(canvasId).emit('cursor:move', {
        userId: socket.user.uid,
        socketId: socket.id,
        x,
        y,
      });

      // Update lastSeen + cursor in DB occasionally (batched)
      await ActiveSession.findOneAndUpdate(
        { socketId: socket.id },
        { cursor: { x, y }, lastSeen: new Date() }
      );
    });

    // ─────────────────────────────────────────
    // STROKE IN PROGRESS (live preview)
    // ─────────────────────────────────────────
    socket.on('stroke:drawing', ({ canvasId, points, color, width, strokeType }) => {
      // Pure broadcast — no DB write, just for live preview
      socket.to(canvasId).emit('stroke:drawing', {
        userId: socket.user.uid,
        points,
        color,
        width,
        strokeType,
      });
    });

    // ─────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const session = await ActiveSession.findOneAndDelete({ socketId: socket.id });
        if (session?.canvasId) {
          socket.to(session.canvasId.toString()).emit('user:left', {
            userId: session.userId,
            socketId: socket.id,
          });
        }
        console.log(`Socket disconnected: ${socket.id}`);
      } catch (err) {
        console.error('disconnect error:', err);
      }
    });
  });
};

module.exports = { registerSocketHandlers };