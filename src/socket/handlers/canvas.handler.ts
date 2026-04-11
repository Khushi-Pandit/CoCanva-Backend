import { Server, Socket } from 'socket.io';
import { CanvasModel } from '../../models/canvas.model';
import { elementService } from '../../services/element.service';
import { canvasService } from '../../services/canvas.service';
import { CanvasElementModel } from '../../models/canvas-element.model';
import { roomManager } from '../rooms/RoomManager';
import { lockManager } from '../rooms/LockManager';
import { SocketData } from '../../types/socket.types';
import { logger } from '../../utils/logger';
import { Types } from 'mongoose';
import { ActiveSessionModel } from '../../models/active-session.model';

type AuthSocket = Socket & { data: SocketData };

export function registerCanvasHandler(io: Server, socket: AuthSocket): void {
  // ── canvas:join ────────────────────────────────────────────────────────────
  socket.on('canvas:join', async ({ canvasId, shareToken }: { canvasId: string; shareToken?: string }) => {
    try {
      const canvas = await CanvasModel.findById(canvasId).lean();
      if (!canvas || canvas.deletedAt) {
        socket.emit('error', { code: 'NOT_FOUND', message: 'Canvas not found' });
        return;
      }

      const role = canvasService.resolveRole(
        canvas as any,
        socket.data.userId ? new Types.ObjectId(socket.data.userId) : undefined,
        shareToken,
      );

      if (!role) {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Access denied' });
        return;
      }

      // Leave previous canvas room
      if (socket.data.currentCanvasId) {
        socket.leave(socket.data.currentCanvasId);
        const remaining = roomManager.leave(socket.data.currentCanvasId, socket.id);
        socket.to(socket.data.currentCanvasId).emit('user:left', {
          userId: socket.data.userId,
          socketId: socket.id,
          userName: socket.data.userName,
        });
      }

      socket.data.currentCanvasId = canvasId;
      socket.data.role = role;
      await socket.join(canvasId);

      // Register in room manager
      const peers = roomManager.join(canvasId, {
        socketId: socket.id,
        userId: socket.data.userId,
        userName: socket.data.userName,
        userColor: socket.data.userColor,
        role,
        cursor: null,
        selectedIds: [],
        viewport: null,
      });

      // Persist session to DB
      await ActiveSessionModel.updateOne(
        { socketId: socket.id },
        {
          $set: {
            canvasId, userId: new Types.ObjectId(socket.data.userId),
            socketId: socket.id, userName: socket.data.userName,
            userColor: socket.data.userColor, role, lastSeen: new Date(),
          },
          $setOnInsert: { joinedAt: new Date() },
        },
        { upsert: true },
      );

      // Load canvas state
      const elements = await elementService.getElements(canvasId);

      // Emit to joining client
      socket.emit('canvas:joined', {
        canvasId,
        title: canvas.title,
        role,
        lastViewport: canvas.lastViewport,
        settings: canvas.settings,
      });

      socket.emit('canvas:state', { elements, canvasId, snapshotSeq: 0 });
      socket.emit('users:active', peers);
      socket.emit('canvas:role', { role, canvasId });

      // Announce to room
      socket.to(canvasId).emit('user:joined', {
        userId: socket.data.userId,
        userName: socket.data.userName,
        userColor: socket.data.userColor,
        role,
        socketId: socket.id,
      });

      logger.debug('Socket joined canvas', { socketId: socket.id, canvasId, role });
    } catch (err) {
      logger.error('canvas:join error', { error: (err as Error).message });
      socket.emit('error', { code: 'JOIN_FAILED', message: (err as Error).message });
    }
  });

  // ── canvas:leave ───────────────────────────────────────────────────────────
  socket.on('canvas:leave', () => {
    const canvasId = socket.data.currentCanvasId;
    if (!canvasId) return;

    socket.leave(canvasId);
    roomManager.leave(canvasId, socket.id);
    lockManager.releaseAllForSocket(socket.id);
    socket.data.currentCanvasId = null;

    socket.to(canvasId).emit('user:left', {
      userId: socket.data.userId,
      socketId: socket.id,
      userName: socket.data.userName,
    });
  });

  // ── canvas:save ────────────────────────────────────────────────────────────
  // Throttle: server enforces max 1 per 2s per socket
  let lastSaveTime = 0;
  socket.on('canvas:save', async (payload: {
    canvasId: string;
    elements: any[];
    deletedIds: string[];
    viewport?: { x: number; y: number; zoom: number };
  }) => {
    const now = Date.now();
    if (now - lastSaveTime < 2000) {
      socket.emit('error', { code: 'RATE_LIMIT', message: 'Save throttled — max 1/2s' });
      return;
    }
    lastSaveTime = now;

    try {
      const canvasId = new Types.ObjectId(payload.canvasId);
      const userId = new Types.ObjectId(socket.data.userId);
      const canvas = await CanvasModel.findById(payload.canvasId).lean();
      const branchId = canvas?.currentBranch ?? null;

      const result = await elementService.bulkSave(
        canvasId, userId, payload.elements, payload.deletedIds,
        branchId ? new Types.ObjectId(branchId.toString()) : undefined,
        socket.id,
      );

      if (payload.viewport) {
        await CanvasModel.updateOne({ _id: payload.canvasId }, { lastViewport: payload.viewport });
      }

      socket.emit('canvas:saved', {
        savedAt: new Date(),
        elementCount: result.upserted,
        savedBy: socket.data.userId,
      });

      io.to(payload.canvasId).emit('canvas:saved', {
        savedAt: new Date(),
        elementCount: result.upserted,
        savedBy: socket.data.userId,
      });
    } catch (err) {
      logger.error('canvas:save error', { error: (err as Error).message });
    }
  });

  // ── canvas:clear ───────────────────────────────────────────────────────────
  socket.on('canvas:clear', async ({ canvasId }: { canvasId: string }) => {
    if (!['editor', 'owner'].includes(socket.data.role)) return;
    try {
      await CanvasElementModel.updateMany(
        { canvasId, isDeleted: false },
        { $set: { isDeleted: true, updatedBy: new Types.ObjectId(socket.data.userId) } },
      );
      io.to(canvasId).emit('canvas:cleared', {
        userId: socket.data.userId,
        userName: socket.data.userName,
      });
    } catch (err) {
      logger.error('canvas:clear error', { error: (err as Error).message });
    }
  });

  // ── canvas:undo / canvas:redo ──────────────────────────────────────────────
  socket.on('canvas:undo', async (payload: { canvasId: string; restored: any[]; deletedIds: string[] }) => {
    if (!['editor', 'owner'].includes(socket.data.role)) return;
    try {
      const canvasId = new Types.ObjectId(payload.canvasId);
      const userId = new Types.ObjectId(socket.data.userId);
      await elementService.bulkSave(canvasId, userId, payload.restored, payload.deletedIds);
      io.to(payload.canvasId).emit('canvas:undo', {
        restored: payload.restored,
        deletedIds: payload.deletedIds,
        userId: socket.data.userId,
      });
    } catch (err) {
      logger.error('canvas:undo error', { error: (err as Error).message });
    }
  });

  // ── elements:batch ─────────────────────────────────────────────────────────
  socket.on('elements:batch', async (payload: { canvasId: string; added: any[]; updated: any[]; deletedIds: string[] }) => {
    if (!['editor', 'owner'].includes(socket.data.role)) return;
    try {
      const canvasId = new Types.ObjectId(payload.canvasId);
      const userId = new Types.ObjectId(socket.data.userId);
      
      const upserts = [...(payload.added || []), ...(payload.updated || [])];
      
      await elementService.bulkSave(
        canvasId, 
        userId, 
        upserts, 
        payload.deletedIds || [],
        undefined,
        socket.id
      );

      socket.to(payload.canvasId).emit('elements:batch', {
        added: payload.added || [],
        updated: payload.updated || [],
        deletedIds: payload.deletedIds || [],
        userId: socket.data.userId,
      });
    } catch (err) {
      logger.error('elements:batch error', { error: (err as Error).message });
    }
  });

  socket.on('canvas:redo', async (payload: { canvasId: string; restored: any[]; deletedIds: string[] }) => {
    if (!['editor', 'owner'].includes(socket.data.role)) return;
    try {
      const canvasId = new Types.ObjectId(payload.canvasId);
      const userId = new Types.ObjectId(socket.data.userId);
      await elementService.bulkSave(canvasId, userId, payload.restored, payload.deletedIds);
      io.to(payload.canvasId).emit('canvas:redo', {
        restored: payload.restored,
        deletedIds: payload.deletedIds,
        userId: socket.data.userId,
      });
    } catch (err) {
      logger.error('canvas:redo error', { error: (err as Error).message });
    }
  });
}
