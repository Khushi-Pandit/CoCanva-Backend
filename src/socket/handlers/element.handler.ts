import { Server, Socket } from 'socket.io';
import { elementService } from '../../services/element.service';
import { roomManager } from '../rooms/RoomManager';
import { lockManager } from '../rooms/LockManager';
import { SocketData } from '../../types/socket.types';
import { logger } from '../../utils/logger';
import { Types } from 'mongoose';

type AuthSocket = Socket & { data: SocketData };

export function registerElementHandler(io: Server, socket: AuthSocket): void {
  const canEdit = () => ['editor', 'owner'].includes(socket.data.role);

  // ── element:add ────────────────────────────────────────────────────────────
  socket.on('element:add', async (payload: { canvasId: string; element: any }) => {
    if (!canEdit()) return;
    // Broadcast FIRST for low latency
    socket.to(payload.canvasId).emit('element:added', {
      element: payload.element,
      userId: socket.data.userId,
      socketId: socket.id,
    });
    // Then persist async
    try {
      await elementService.upsertElement(
        new Types.ObjectId(payload.canvasId),
        new Types.ObjectId(socket.data.userId),
        payload.element,
      );
    } catch (err) {
      socket.emit('element:persist_error', { elementId: payload.element.elementId, event: 'add' });
    }
  });

  // ── element:update ─────────────────────────────────────────────────────────
  socket.on('element:update', async (payload: { canvasId: string; element: any }) => {
    if (!canEdit()) return;

    const { elementId } = payload.element;

    // Check lock
    const lock = lockManager.getLock(payload.canvasId, elementId);
    if (lock && lock.socketId !== socket.id) {
      socket.emit('element:lock_conflict', {
        elementId,
        lockedBy: lock.userId,
        lockedByName: lock.userName,
      });
      return;
    }

    // Broadcast first
    socket.to(payload.canvasId).emit('element:updated', {
      element: payload.element,
      userId: socket.data.userId,
      socketId: socket.id,
    });

    // Persist async
    try {
      await elementService.upsertElement(
        new Types.ObjectId(payload.canvasId),
        new Types.ObjectId(socket.data.userId),
        payload.element,
      );
    } catch (err) {
      socket.emit('element:persist_error', { elementId, event: 'update' });
    }
  });

  // ── element:delete ─────────────────────────────────────────────────────────
  socket.on('element:delete', async (payload: { canvasId: string; elementIds: string[] }) => {
    if (!canEdit()) return;

    // Release locks for deleted elements
    for (const eid of payload.elementIds) lockManager.release(payload.canvasId, eid, socket.id);

    io.to(payload.canvasId).emit('element:deleted', {
      elementIds: payload.elementIds,
      userId: socket.data.userId,
    });

    try {
      await elementService.deleteElements(
        new Types.ObjectId(payload.canvasId),
        payload.elementIds,
        new Types.ObjectId(socket.data.userId),
      );
    } catch (err) {
      logger.error('element:delete persist error', { error: (err as Error).message });
    }
  });

  // ── elements:batch ─────────────────────────────────────────────────────────
  socket.on('elements:batch', async (payload: {
    canvasId: string;
    added: any[];
    updated: any[];
    deletedIds: string[];
  }) => {
    if (!canEdit()) return;

    io.to(payload.canvasId).emit('elements:batch', {
      added: payload.added,
      updated: payload.updated,
      deletedIds: payload.deletedIds,
      userId: socket.data.userId,
    });

    try {
      await elementService.bulkSave(
        new Types.ObjectId(payload.canvasId),
        new Types.ObjectId(socket.data.userId),
        [...payload.added, ...payload.updated],
        payload.deletedIds,
      );
    } catch (err) {
      logger.error('elements:batch persist error', { error: (err as Error).message });
    }
  });

  // ── element:lock / element:unlock ──────────────────────────────────────────
  socket.on('element:lock', ({ canvasId, elementId }: { canvasId: string; elementId: string }) => {
    const acquired = lockManager.acquire(canvasId, elementId, socket.id, socket.data.userId, socket.data.userName);
    if (acquired) {
      io.to(canvasId).emit('element:locked', {
        elementId,
        userId: socket.data.userId,
        userName: socket.data.userName,
        socketId: socket.id,
      });
    } else {
      const lock = lockManager.getLock(canvasId, elementId)!;
      socket.emit('element:lock_conflict', {
        elementId,
        lockedBy: lock.userId,
        lockedByName: lock.userName,
      });
    }
  });

  socket.on('element:unlock', ({ canvasId, elementId }: { canvasId: string; elementId: string }) => {
    const released = lockManager.release(canvasId, elementId, socket.id);
    if (released) {
      io.to(canvasId).emit('element:unlocked', { elementId, userId: socket.data.userId });
    }
  });

  // ── Ghost accept / dismiss ─────────────────────────────────────────────────
  socket.on('element:ghost:accept', async ({ canvasId, elementIds }: { canvasId: string; elementIds: string[] }) => {
    if (!canEdit()) return;
    await elementService.acceptGhostElements(
      new Types.ObjectId(canvasId),
      elementIds,
      new Types.ObjectId(socket.data.userId),
    );
    io.to(canvasId).emit('elements:batch', {
      added: [],
      updated: elementIds.map((id) => ({ elementId: id, isGhostSuggestion: false })),
      deletedIds: [],
      userId: socket.data.userId,
    });
  });

  socket.on('element:ghost:dismiss', async ({ canvasId, elementIds }: { canvasId: string; elementIds: string[] }) => {
    if (!canEdit()) return;
    await elementService.deleteElements(
      new Types.ObjectId(canvasId),
      elementIds,
      new Types.ObjectId(socket.data.userId),
    );
    io.to(canvasId).emit('element:deleted', { elementIds, userId: socket.data.userId });
  });

  // ── stroke:preview  (high-frequency, no DB write) ─────────────────────────
  socket.on('stroke:preview', (payload: { canvasId: string; points: any[]; style: any }) => {
    socket.to(payload.canvasId).emit('stroke:preview', {
      userId: socket.data.userId,
      socketId: socket.id,
      points: payload.points,
      style: payload.style,
    });
  });

  // ── cursor:move (no DB write) ──────────────────────────────────────────────
  socket.on('cursor:move', ({ canvasId, x, y }: { canvasId: string; x: number; y: number }) => {
    roomManager.updateCursor(canvasId, socket.id, x, y);
    socket.to(canvasId).emit('cursor:moved', {
      userId: socket.data.userId,
      socketId: socket.id,
      userName: socket.data.userName,
      userColor: socket.data.userColor,
      x, y,
    });
  });

  // ── selection:update ───────────────────────────────────────────────────────
  socket.on('selection:update', ({ canvasId, elementIds }: { canvasId: string; elementIds: string[] }) => {
    roomManager.updateSelection(canvasId, socket.id, elementIds);
    socket.to(canvasId).emit('selection:updated', {
      userId: socket.data.userId,
      socketId: socket.id,
      elementIds,
    });
  });

  // ── viewport:update (follow-me) ───────────────────────────────────────────
  socket.on('viewport:update', ({ canvasId, viewport }: { canvasId: string; viewport: any }) => {
    roomManager.updateViewport(canvasId, socket.id, viewport);
    socket.to(canvasId).emit('viewport:updated', {
      userId: socket.data.userId,
      socketId: socket.id,
      viewport,
    });
  });
}
