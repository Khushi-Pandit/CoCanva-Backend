'use strict';
/**
 * socketHandlers.js — Complete real-time collaboration engine
 *
 * Design principles:
 *   1. Broadcast first, persist async — lowest possible drawing latency.
 *   2. In-memory presence state (rooms Map) — no DB hit for cursor / viewport updates.
 *   3. DB writes only for permanent element operations (add / update / delete / batch).
 *   4. Soft-delete elements so undo/redo can recover them.
 *   5. Element locks prevent simultaneous edits on the same shape (optimistic concurrency).
 *   6. A single canvas:state snapshot is sent to each joiner from the DB (source of truth).
 *
 * ── VOICE (WebRTC) ────────────────────────────────────────────────────────────
 *   Voice is peer-to-peer via WebRTC. This server acts ONLY as a signaling relay.
 *   No audio data ever passes through the server — only SDP offer/answer and ICE
 *   candidates are forwarded so peers can establish a direct connection.
 *
 *   Signal flow:
 *     Caller              Server              Callee
 *       │── voice:join ──►│── voice:user_joined ──►│
 *       │◄─ voice:offer ──│◄─── voice:offer ───────│  (or caller sends offer)
 *       │── voice:answer─►│──── voice:answer ──────►│
 *       │── voice:ice ───►│──── voice:ice ─────────►│
 *       │◄─ voice:ice ────│◄─── voice:ice ──────────│
 *
 *   In-memory voiceRooms Map stores who is in the voice channel for each canvas.
 */

const Canvas        = require('../models/canvas.model');
const CanvasElement = require('../models/canvas-element.model');
const ActiveSession = require('../models/activesession.model');
const admin         = require('../config/firebase');
const User          = require('../models/user.model');
const logger        = require('../utils/logger');

// ── Cursor colours assigned round-robin ──────────────────────────────────────
const CURSOR_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#06B6D4',
  '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6', '#F59E0B',
  '#6366F1', '#D946EF',
];
let colorCursor = 0;
const nextColor = () => CURSOR_COLORS[(colorCursor++) % CURSOR_COLORS.length];

// ── In-memory state (fast path for presence / cursors / locks) ────────────────
/**
 * rooms: Map<canvasId:string, Map<socketId:string, SessionData>>
 *
 * SessionData = {
 *   socketId, userId (Mongo _id string), firebaseUid,
 *   userName, userColor, role, cursor: {x, y}
 * }
 */
const rooms = new Map();

/**
 * elementLocks: Map<`${canvasId}:${elementId}`, { socketId, userId, userName }>
 * Cleared on unlock, disconnect, or canvas:leave.
 */
const elementLocks = new Map();

/**
 * voiceRooms: Map<canvasId:string, Map<socketId:string, VoiceParticipant>>
 *
 * VoiceParticipant = {
 *   socketId, userId, userName, userColor,
 *   muted: boolean   ← self-reported mic state (for UI indicators)
 * }
 *
 * Kept in-memory only — voice sessions don't need to survive a server restart.
 */
const voiceRooms = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
const canEdit  = (role) => role === 'owner' || role === 'editor';

const getRoomUsers = (canvasId) => {
  const room = rooms.get(canvasId);
  if (!room) return [];
  return Array.from(room.values());
};

const addToRoom = (canvasId, socketId, session) => {
  if (!rooms.has(canvasId)) rooms.set(canvasId, new Map());
  rooms.get(canvasId).set(socketId, session);
};

const removeFromRoom = (canvasId, socketId) => {
  const room = rooms.get(canvasId);
  if (!room) return;
  room.delete(socketId);
  if (room.size === 0) rooms.delete(canvasId);
};

const releaseLocksForSocket = (socketId, canvasId) => {
  for (const [key, lock] of elementLocks) {
    if (lock.socketId === socketId && key.startsWith(`${canvasId}:`)) {
      elementLocks.delete(key);
    }
  }
};

// ── Voice helpers ─────────────────────────────────────────────────────────────

/** Returns an array of VoiceParticipant for the canvas voice room. */
const getVoiceParticipants = (canvasId) => {
  const vRoom = voiceRooms.get(canvasId);
  if (!vRoom) return [];
  return Array.from(vRoom.values());
};

/** Add a participant to the in-memory voice room. */
const addToVoiceRoom = (canvasId, socketId, participant) => {
  if (!voiceRooms.has(canvasId)) voiceRooms.set(canvasId, new Map());
  voiceRooms.get(canvasId).set(socketId, participant);
};

/** Remove a participant from the in-memory voice room. Returns removed entry or undefined. */
const removeFromVoiceRoom = (canvasId, socketId) => {
  const vRoom = voiceRooms.get(canvasId);
  if (!vRoom) return undefined;
  const entry = vRoom.get(socketId);
  vRoom.delete(socketId);
  if (vRoom.size === 0) voiceRooms.delete(canvasId);
  return entry;
};

/** Leave ALL voice rooms this socket was in (used on disconnect). */
const leaveAllVoiceRooms = (socket, io) => {
  for (const [canvasId, vRoom] of voiceRooms) {
    if (vRoom.has(socket.id)) {
      vRoom.delete(socket.id);
      if (vRoom.size === 0) voiceRooms.delete(canvasId);

      // Notify remaining participants
      io.to(canvasId).emit('voice:user_left', {
        socketId: socket.id,
        userId:   socket.mongoUser?._id?.toString(),
        userName: socket.displayName,
        participants: getVoiceParticipants(canvasId),
      });

      logger.debug(`[voice] ${socket.displayName} left voice room ${canvasId} (disconnect)`);
    }
  }
};

// Resolve effective role for a Firebase UID on a canvas document
const resolveRole = async (canvas, firebaseUid, shareToken) => {
  const user = await User.findOne({ fId: firebaseUid }).select('_id fullName').lean();
  if (!user) return { hasAccess: false, role: null, mongoUser: null };

  const uid = user._id.toString();
  const isOwner = canvas.owner?.toString() === uid;
  const collab  = canvas.collaborators.find((c) => c.user?.toString() === uid);

  let shareTokenRole = null;
  if (!isOwner && !collab && shareToken) {
    const entry = canvas.shareTokens.find((t) => t.token === shareToken);
    if (entry) shareTokenRole = entry.role;
  }

  const role = isOwner ? 'owner' : collab?.role ?? shareTokenRole ?? null;
  return { hasAccess: !!role, role, mongoUser: user };
};

// Whitelist element fields that are safe to write
const ELEMENT_ALLOWED_FIELDS = new Set([
  'elementId', 'type', 'subtype',
  'x', 'y', 'width', 'height', 'rotation',
  'points', 'fromElementId', 'toElementId', 'fromPoint', 'toPoint', 'controlPoints',
  'text', 'label', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
  'textAlign', 'textColor', 'lineHeight',
  'strokeColor', 'fillColor', 'strokeWidth', 'opacity',
  'dashed', 'dashArray', 'roughness', 'roundness',
  'arrowStart', 'arrowEnd', 'arrowHeadStyle',
  'imageUrl', 'imageData', 'zIndex', 'isDeleted',
]);

const sanitizeElement = (raw) => {
  const out = {};
  for (const key of ELEMENT_ALLOWED_FIELDS) {
    if (key in raw) out[key] = raw[key];
  }
  return out;
};

// ── Main registration ─────────────────────────────────────────────────────────
const registerSocketHandlers = (io) => {

  // ── Socket.IO auth middleware ─────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('AUTH_MISSING: No token provided'));

    try {
      const decoded = await admin.auth().verifyIdToken(token);
      const mongoUser = await User.findOne({ fId: decoded.uid })
        .select('_id fullName email avatarUrl avatarId')
        .lean();

      if (!mongoUser) {
        return next(new Error('AUTH_NO_ACCOUNT: User not registered'));
      }

      socket.firebaseUid  = decoded.uid;
      socket.mongoUser    = mongoUser;
      socket.displayName  =
        mongoUser.fullName ||
        decoded.name       ||
        decoded.email?.split('@')[0] ||
        `User_${decoded.uid.slice(0, 6)}`;

      return next();
    } catch (err) {
      return next(new Error(`AUTH_INVALID: ${err.message}`));
    }
  });

  // ── Connection ────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.debug(`[socket] connected  ${socket.id}  uid=${socket.firebaseUid}`);

    // ── canvas:join ───────────────────────────────────────────────────────────
    socket.on('canvas:join', async ({ canvasId, shareToken } = {}) => {
      try {
        if (!canvasId) {
          return socket.emit('error', { code: 'BAD_REQUEST', message: 'canvasId required' });
        }

        const canvas = await Canvas.findById(canvasId).lean();
        if (!canvas) {
          return socket.emit('error', { code: 'NOT_FOUND', message: 'Canvas not found' });
        }

        const { hasAccess, role, mongoUser } =
          await resolveRole(canvas, socket.firebaseUid, shareToken || null);

        if (!hasAccess || !role) {
          return socket.emit('error', { code: 'FORBIDDEN', message: 'Access denied' });
        }

        if (role !== 'owner') {
          const alreadyCollab = canvas.collaborators.some(
            (c) => c.user?.toString() === mongoUser._id.toString()
          );
          if (!alreadyCollab && shareToken) {
            Canvas.findByIdAndUpdate(canvasId, {
              $push: { collaborators: { user: mongoUser._id, role } },
            }).exec().catch((e) => logger.error('auto-add collaborator:', e));
          }
        }

        if (socket.currentCanvasId && socket.currentCanvasId !== canvasId) {
          await handleLeave(socket, io);
        }

        if (socket.currentCanvasId) {
          socket.leave(socket.currentCanvasId);
          removeFromRoom(socket.currentCanvasId, socket.id);
          releaseLocksForSocket(socket.id, socket.currentCanvasId);
        }

        socket.join(canvasId);
        socket.currentCanvasId = canvasId;
        socket.userRole        = role;

        const userColor = socket.userColor || nextColor();
        socket.userColor = userColor;

        const sessionData = {
          canvasId,
          userId:    mongoUser._id,
          socketId:  socket.id,
          userName:  socket.displayName,
          userColor,
          role,
          lastSeen:  new Date(),
        };
        await ActiveSession.findOneAndUpdate(
          { socketId: socket.id },
          sessionData,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        addToRoom(canvasId, socket.id, {
          socketId:    socket.id,
          userId:      mongoUser._id.toString(),
          firebaseUid: socket.firebaseUid,
          userName:    socket.displayName,
          userColor,
          role,
          cursor:      { x: 0, y: 0 },
        });

        socket.emit('canvas:role', { role, canvasId });
        socket.emit('canvas:joined', {
          canvasId,
          title:        canvas.title,
          role,
          lastViewport: canvas.lastViewport,
        });

        const elements = await CanvasElement.find({ canvasId, isDeleted: false })
          .select('-__v')
          .sort({ zIndex: 1, createdAt: 1 })
          .lean();
        socket.emit('canvas:state', { elements, canvasId });

        const usersList = getRoomUsers(canvasId);
        io.to(canvasId).emit('users:active', usersList);

        socket.to(canvasId).emit('user:joined', {
          userId:    mongoUser._id.toString(),
          userName:  socket.displayName,
          userColor,
          role,
          socketId:  socket.id,
        });

        // Send current voice room participants so the joiner knows who is already on voice
        socket.emit('voice:participants', {
          canvasId,
          participants: getVoiceParticipants(canvasId),
        });

        logger.debug(`[canvas:join] ${socket.displayName} → ${canvasId} as ${role}`);
      } catch (err) {
        logger.error('canvas:join error:', err);
        socket.emit('error', { code: 'SERVER_ERROR', message: 'Failed to join canvas' });
      }
    });

    // ── canvas:leave ──────────────────────────────────────────────────────────
    socket.on('canvas:leave', async () => {
      await handleLeave(socket, io);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // VOICE — WebRTC signaling events
    // All events are namespaced with "voice:" prefix.
    // The server NEVER inspects SDP or ICE content — it only routes them.
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * voice:join
     * Emitted when the user clicks "Join Voice" in the UI.
     * payload: { canvasId: string }
     *
     * Server:
     *   1. Adds the socket to the in-memory voice room.
     *   2. Broadcasts voice:user_joined to ALL sockets in the canvas room
     *      (including the joiner) with the updated participant list.
     *   3. Every EXISTING voice participant who receives voice:user_joined
     *      is expected to initiate an offer to the new peer (many-to-many mesh).
     */
    socket.on('voice:join', ({ canvasId } = {}) => {
      if (!canvasId) return;
      if (!socket.currentCanvasId || socket.currentCanvasId !== canvasId) return;

      // Idempotent — ignore if already in voice
      const vRoom = voiceRooms.get(canvasId);
      if (vRoom && vRoom.has(socket.id)) return;

      const participant = {
        socketId:  socket.id,
        userId:    socket.mongoUser._id.toString(),
        userName:  socket.displayName,
        userColor: socket.userColor,
        muted:     false,
      };

      addToVoiceRoom(canvasId, socket.id, participant);

      // Notify everyone in the canvas (including joiner) about the new list
      io.to(canvasId).emit('voice:user_joined', {
        participant,
        participants: getVoiceParticipants(canvasId),
        canvasId,
      });

      logger.debug(`[voice] ${socket.displayName} joined voice room ${canvasId}. total=${getVoiceParticipants(canvasId).length}`);
    });

    /**
     * voice:leave
     * Emitted when the user clicks "Leave Voice" in the UI.
     * payload: { canvasId: string }
     */
    socket.on('voice:leave', ({ canvasId } = {}) => {
      if (!canvasId) return;

      const removed = removeFromVoiceRoom(canvasId, socket.id);
      if (!removed) return; // wasn't in voice room

      io.to(canvasId).emit('voice:user_left', {
        socketId:     socket.id,
        userId:       socket.mongoUser._id.toString(),
        userName:     socket.displayName,
        participants: getVoiceParticipants(canvasId),
        canvasId,
      });

      logger.debug(`[voice] ${socket.displayName} left voice room ${canvasId}. remaining=${getVoiceParticipants(canvasId).length}`);
    });

    /**
     * voice:offer
     * Caller sends an SDP offer to a specific peer.
     * payload: { canvasId: string, targetSocketId: string, sdp: RTCSessionDescriptionInit }
     *
     * The server forwards it to targetSocketId only, attaching the caller's socketId
     * so the callee knows who to answer.
     */
    socket.on('voice:offer', ({ canvasId, targetSocketId, sdp } = {}) => {
      if (!canvasId || !targetSocketId || !sdp) return;

      io.to(targetSocketId).emit('voice:offer', {
        canvasId,
        fromSocketId: socket.id,
        fromUserId:   socket.mongoUser._id.toString(),
        fromUserName: socket.displayName,
        sdp,
      });

      logger.debug(`[voice] offer  ${socket.id} → ${targetSocketId}`);
    });

    /**
     * voice:answer
     * Callee sends an SDP answer back to the original caller.
     * payload: { canvasId: string, targetSocketId: string, sdp: RTCSessionDescriptionInit }
     */
    socket.on('voice:answer', ({ canvasId, targetSocketId, sdp } = {}) => {
      if (!canvasId || !targetSocketId || !sdp) return;

      io.to(targetSocketId).emit('voice:answer', {
        canvasId,
        fromSocketId: socket.id,
        fromUserId:   socket.mongoUser._id.toString(),
        sdp,
      });

      logger.debug(`[voice] answer ${socket.id} → ${targetSocketId}`);
    });

    /**
     * voice:ice
     * Trickle ICE candidates — forwarded as-is to the target peer.
     * payload: { canvasId: string, targetSocketId: string, candidate: RTCIceCandidateInit }
     */
    socket.on('voice:ice', ({ canvasId, targetSocketId, candidate } = {}) => {
      if (!canvasId || !targetSocketId || !candidate) return;

      io.to(targetSocketId).emit('voice:ice', {
        canvasId,
        fromSocketId: socket.id,
        candidate,
      });
    });

    /**
     * voice:mute_toggle
     * User mutes/unmutes themselves. The server updates the in-memory state
     * and broadcasts so all peers can reflect the mic indicator in the UI.
     * payload: { canvasId: string, muted: boolean }
     */
    socket.on('voice:mute_toggle', ({ canvasId, muted } = {}) => {
      if (!canvasId) return;

      const vRoom = voiceRooms.get(canvasId);
      if (!vRoom || !vRoom.has(socket.id)) return;

      const participant = vRoom.get(socket.id);
      participant.muted = !!muted;

      io.to(canvasId).emit('voice:mute_changed', {
        socketId:     socket.id,
        userId:       socket.mongoUser._id.toString(),
        userName:     socket.displayName,
        muted:        participant.muted,
        participants: getVoiceParticipants(canvasId),
        canvasId,
      });

      logger.debug(`[voice] ${socket.displayName} muted=${participant.muted}`);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // END VOICE EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    // ── element:add ──────────────────────────────────────────────────────────
    socket.on('element:add', async ({ canvasId, element } = {}) => {
      if (!canEdit(socket.userRole)) return;
      if (!element?.elementId) return;

      const userId = socket.mongoUser._id.toString();

      socket.to(canvasId).emit('element:added', {
        element,
        userId,
        socketId: socket.id,
      });

      try {
        await CanvasElement.findOneAndUpdate(
          { canvasId, elementId: element.elementId },
          {
            $set: {
              ...sanitizeElement(element),
              canvasId,
              updatedBy: socket.mongoUser._id,
            },
            $setOnInsert: { createdBy: socket.mongoUser._id },
            $inc: { version: 1 },
          },
          { upsert: true, new: true }
        );
        Canvas.findByIdAndUpdate(canvasId, { $inc: { elementCount: 1 } }).exec().catch(() => {});
      } catch (err) {
        logger.error('element:add persist:', err);
        socket.emit('element:persist_error', { elementId: element.elementId, event: 'add' });
      }
    });

    // ── element:update ───────────────────────────────────────────────────────
    socket.on('element:update', async ({ canvasId, element } = {}) => {
      if (!canEdit(socket.userRole)) return;
      if (!element?.elementId) return;

      const userId = socket.mongoUser._id.toString();

      const lockKey = `${canvasId}:${element.elementId}`;
      const lock = elementLocks.get(lockKey);
      if (lock && lock.socketId !== socket.id) {
        return socket.emit('element:lock_conflict', {
          elementId: element.elementId,
          lockedBy:  lock.userId,
        });
      }

      socket.to(canvasId).emit('element:updated', { element, userId, socketId: socket.id });

      try {
        await CanvasElement.findOneAndUpdate(
          { canvasId, elementId: element.elementId },
          {
            $set: {
              ...sanitizeElement(element),
              updatedBy: socket.mongoUser._id,
            },
            $inc: { version: 1 },
          }
        );
      } catch (err) {
        logger.error('element:update persist:', err);
        socket.emit('element:persist_error', { elementId: element.elementId, event: 'update' });
      }
    });

    // ── element:delete ───────────────────────────────────────────────────────
    socket.on('element:delete', async ({ canvasId, elementIds } = {}) => {
      if (!canEdit(socket.userRole)) return;
      if (!Array.isArray(elementIds) || !elementIds.length) return;

      const userId = socket.mongoUser._id.toString();

      socket.to(canvasId).emit('element:deleted', { elementIds, userId, socketId: socket.id });

      try {
        await CanvasElement.updateMany(
          { canvasId, elementId: { $in: elementIds } },
          { $set: { isDeleted: true, updatedBy: socket.mongoUser._id } }
        );
        const count = await CanvasElement.countDocuments({ canvasId, isDeleted: false });
        Canvas.findByIdAndUpdate(canvasId, { elementCount: count }).exec().catch(() => {});
        elementIds.forEach((eid) => elementLocks.delete(`${canvasId}:${eid}`));
      } catch (err) {
        logger.error('element:delete persist:', err);
      }
    });

    // ── elements:batch ───────────────────────────────────────────────────────
    socket.on('elements:batch', async ({ canvasId, added = [], updated = [], deletedIds = [] } = {}) => {
      if (!canEdit(socket.userRole)) return;

      const userId = socket.mongoUser._id.toString();

      socket.to(canvasId).emit('elements:batch', {
        added, updated, deletedIds, userId, socketId: socket.id,
      });

      try {
        const ops = [];

        for (const el of added) {
          if (!el.elementId) continue;
          ops.push({
            updateOne: {
              filter: { canvasId, elementId: el.elementId },
              update: {
                $set: { ...sanitizeElement(el), canvasId, updatedBy: socket.mongoUser._id },
                $setOnInsert: { createdBy: socket.mongoUser._id },
                $inc: { version: 1 },
              },
              upsert: true,
            },
          });
        }

        for (const el of updated) {
          if (!el.elementId) continue;
          ops.push({
            updateOne: {
              filter: { canvasId, elementId: el.elementId },
              update: {
                $set: { ...sanitizeElement(el), updatedBy: socket.mongoUser._id },
                $inc: { version: 1 },
              },
            },
          });
        }

        for (const elementId of deletedIds) {
          ops.push({
            updateOne: {
              filter: { canvasId, elementId },
              update: { $set: { isDeleted: true, updatedBy: socket.mongoUser._id } },
            },
          });
          elementLocks.delete(`${canvasId}:${elementId}`);
        }

        if (ops.length) {
          await CanvasElement.bulkWrite(ops, { ordered: false });
          const count = await CanvasElement.countDocuments({ canvasId, isDeleted: false });
          Canvas.findByIdAndUpdate(canvasId, { elementCount: count }).exec().catch(() => {});
        }
      } catch (err) {
        logger.error('elements:batch persist:', err);
      }
    });

    // ── element:lock ─────────────────────────────────────────────────────────
    socket.on('element:lock', ({ canvasId, elementId } = {}) => {
      if (!canEdit(socket.userRole) || !elementId) return;

      const key  = `${canvasId}:${elementId}`;
      const lock = elementLocks.get(key);

      if (lock && lock.socketId !== socket.id) {
        return socket.emit('element:lock_conflict', {
          elementId,
          lockedBy:     lock.userId,
          lockedByName: lock.userName,
        });
      }

      elementLocks.set(key, {
        socketId: socket.id,
        userId:   socket.mongoUser._id.toString(),
        userName: socket.displayName,
      });

      socket.to(canvasId).emit('element:locked', {
        elementId,
        userId:   socket.mongoUser._id.toString(),
        userName: socket.displayName,
        socketId: socket.id,
      });
    });

    // ── element:unlock ───────────────────────────────────────────────────────
    socket.on('element:unlock', ({ canvasId, elementId } = {}) => {
      const key = `${canvasId}:${elementId}`;
      const lock = elementLocks.get(key);
      if (lock && lock.socketId === socket.id) {
        elementLocks.delete(key);
        socket.to(canvasId).emit('element:unlocked', {
          elementId,
          userId: socket.mongoUser._id.toString(),
        });
      }
    });

    // ── canvas:clear ─────────────────────────────────────────────────────────
    socket.on('canvas:clear', async ({ canvasId } = {}) => {
      if (!canEdit(socket.userRole)) return;
      try {
        await CanvasElement.updateMany({ canvasId }, {
          $set: { isDeleted: true, updatedBy: socket.mongoUser._id },
        });
        await Canvas.findByIdAndUpdate(canvasId, { elementCount: 0 });

        for (const key of elementLocks.keys()) {
          if (key.startsWith(`${canvasId}:`)) elementLocks.delete(key);
        }

        io.to(canvasId).emit('canvas:cleared', {
          userId:   socket.mongoUser._id.toString(),
          userName: socket.displayName,
        });
      } catch (err) {
        logger.error('canvas:clear:', err);
      }
    });

    // ── canvas:save ──────────────────────────────────────────────────────────
    socket.on('canvas:save', async ({ canvasId, elements = [], deletedIds = [], viewport } = {}) => {
      if (!canEdit(socket.userRole)) return;

      try {
        const ops = [];

        for (const el of elements) {
          if (!el.elementId) continue;
          ops.push({
            updateOne: {
              filter: { canvasId, elementId: el.elementId },
              update: {
                $set: { ...sanitizeElement(el), canvasId, updatedBy: socket.mongoUser._id },
                $setOnInsert: { createdBy: socket.mongoUser._id },
                $inc: { version: 1 },
              },
              upsert: true,
            },
          });
        }

        for (const elementId of deletedIds) {
          ops.push({
            updateOne: {
              filter: { canvasId, elementId },
              update: { $set: { isDeleted: true, updatedBy: socket.mongoUser._id } },
            },
          });
        }

        if (ops.length) {
          await CanvasElement.bulkWrite(ops, { ordered: false });
        }

        const count = await CanvasElement.countDocuments({ canvasId, isDeleted: false });
        const metaUpdate = { elementCount: count };
        if (viewport) metaUpdate.lastViewport = viewport;
        await Canvas.findByIdAndUpdate(canvasId, metaUpdate);

        const savedAt = new Date();
        io.to(canvasId).emit('canvas:saved', {
          savedAt,
          elementCount: count,
          savedBy:      socket.mongoUser._id.toString(),
        });
      } catch (err) {
        logger.error('canvas:save socket:', err);
        socket.emit('error', { code: 'SAVE_FAILED', message: 'Canvas save failed' });
      }
    });

    // ── stroke:preview ───────────────────────────────────────────────────────
    socket.on('stroke:preview', ({ canvasId, points, style } = {}) => {
      if (!canEdit(socket.userRole)) return;
      socket.to(canvasId).emit('stroke:preview', {
        userId:    socket.mongoUser._id.toString(),
        socketId:  socket.id,
        userName:  socket.displayName,
        userColor: socket.userColor,
        points,
        style,
      });
    });

    // ── cursor:move ───────────────────────────────────────────────────────────
    socket.on('cursor:move', ({ canvasId, x, y } = {}) => {
      const room = rooms.get(canvasId);
      if (room) {
        const session = room.get(socket.id);
        if (session) session.cursor = { x, y };
      }

      socket.to(canvasId).emit('cursor:moved', {
        userId:    socket.mongoUser._id.toString(),
        socketId:  socket.id,
        userName:  socket.displayName,
        userColor: socket.userColor,
        x,
        y,
      });
    });

    // ── selection:update ──────────────────────────────────────────────────────
    socket.on('selection:update', ({ canvasId, elementIds = [] } = {}) => {
      socket.to(canvasId).emit('selection:updated', {
        userId:     socket.mongoUser._id.toString(),
        socketId:   socket.id,
        elementIds,
      });
    });

    // ── viewport:update ────────────────────────────────────────────────────────
    socket.on('viewport:update', ({ canvasId, viewport } = {}) => {
      socket.to(canvasId).emit('viewport:updated', {
        userId:   socket.mongoUser._id.toString(),
        socketId: socket.id,
        viewport,
      });
    });

    // ── canvas:undo ───────────────────────────────────────────────────────────
    socket.on('canvas:undo', async ({ canvasId, restored = [], deletedIds = [] } = {}) => {
      if (!canEdit(socket.userRole)) return;

      const userId = socket.mongoUser._id.toString();
      socket.to(canvasId).emit('canvas:undo', { restored, deletedIds, userId, socketId: socket.id });

      try {
        const ops = [
          ...restored.map((el) => ({
            updateOne: {
              filter: { canvasId, elementId: el.elementId },
              update: {
                $set: { ...sanitizeElement(el), isDeleted: false, updatedBy: socket.mongoUser._id },
                $inc: { version: 1 },
              },
              upsert: true,
            },
          })),
          ...deletedIds.map((elementId) => ({
            updateOne: {
              filter: { canvasId, elementId },
              update: { $set: { isDeleted: true, updatedBy: socket.mongoUser._id } },
            },
          })),
        ];
        if (ops.length) await CanvasElement.bulkWrite(ops, { ordered: false });
      } catch (err) {
        logger.error('canvas:undo persist:', err);
      }
    });

    // ── canvas:redo ───────────────────────────────────────────────────────────
    socket.on('canvas:redo', async ({ canvasId, restored = [], deletedIds = [] } = {}) => {
      if (!canEdit(socket.userRole)) return;

      const userId = socket.mongoUser._id.toString();
      socket.to(canvasId).emit('canvas:redo', { restored, deletedIds, userId, socketId: socket.id });

      try {
        const ops = [
          ...restored.map((el) => ({
            updateOne: {
              filter: { canvasId, elementId: el.elementId },
              update: {
                $set: { ...sanitizeElement(el), isDeleted: false, updatedBy: socket.mongoUser._id },
                $inc: { version: 1 },
              },
              upsert: true,
            },
          })),
          ...deletedIds.map((elementId) => ({
            updateOne: {
              filter: { canvasId, elementId },
              update: { $set: { isDeleted: true, updatedBy: socket.mongoUser._id } },
            },
          })),
        ];
        if (ops.length) await CanvasElement.bulkWrite(ops, { ordered: false });
      } catch (err) {
        logger.error('canvas:redo persist:', err);
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      logger.debug(`[socket] disconnected ${socket.id}  reason=${reason}`);

      // Clean up voice rooms before canvas leave
      leaveAllVoiceRooms(socket, io);

      await handleLeave(socket, io);
    });
  }); // end io.on('connection')

  // ── handleLeave (shared by canvas:leave and disconnect) ───────────────────
  async function handleLeave(socket, io) {
    const canvasId = socket.currentCanvasId;
    if (!canvasId) return;

    socket.currentCanvasId = null;
    socket.userRole        = null;

    removeFromRoom(canvasId, socket.id);
    releaseLocksForSocket(socket.id, canvasId);

    // If still in voice room for this canvas, clean that up too
    const voiceRemoved = removeFromVoiceRoom(canvasId, socket.id);
    if (voiceRemoved) {
      io.to(canvasId).emit('voice:user_left', {
        socketId:     socket.id,
        userId:       socket.mongoUser?._id?.toString(),
        userName:     socket.displayName,
        participants: getVoiceParticipants(canvasId),
        canvasId,
      });
    }

    try {
      await ActiveSession.deleteOne({ socketId: socket.id });
    } catch (err) {
      logger.error('handleLeave ActiveSession.deleteOne:', err);
    }

    const remaining = getRoomUsers(canvasId);
    io.to(canvasId).emit('users:active', remaining);
    socket.to(canvasId).emit('user:left', {
      userId:   socket.mongoUser?._id?.toString(),
      socketId: socket.id,
      userName: socket.displayName,
    });

    socket.leave(canvasId);
  }
};

module.exports = { registerSocketHandlers };