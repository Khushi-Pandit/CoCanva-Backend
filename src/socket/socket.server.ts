import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getPubClient, getSubClient } from '../config/redis';
import { socketAuthMiddleware } from './middleware/socketAuth.middleware';
import { registerCanvasHandler } from './handlers/canvas.handler';
import { registerElementHandler } from './handlers/element.handler';
import { registerAIHandler } from './handlers/ai.handler';
import { registerVoiceHandler } from './handlers/voice.handler';
import { registerAnnotationHandler } from './handlers/annotation.handler';
import { roomManager } from './rooms/RoomManager';
import { lockManager } from './rooms/LockManager';
import { voiceRoomManager } from './rooms/VoiceRoomManager';
import { ActiveSessionModel } from '../models/active-session.model';
import { SocketData } from '../types/socket.types';
import { env } from '../config/env';
import { logger } from '../utils/logger';

type AuthSocket = Socket & { data: SocketData };

export function createSocketServer(httpServer: HTTPServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 5 * 1024 * 1024, // 5MB for large element batches
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    },
  });

  // ── Redis adapter for horizontal scaling ──────────────────────────────────
  try {
    io.adapter(createAdapter(getPubClient(), getSubClient()));
    logger.info('Socket.IO Redis adapter attached');
  } catch (err) {
    logger.warn('Redis adapter unavailable — running in single-server mode', {
      error: (err as Error).message,
    });
  }

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use(socketAuthMiddleware as any);

  // ── Connection handler ────────────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthSocket;

    logger.debug('Socket connected', {
      socketId: socket.id,
      userId: authSocket.data.userId,
    });

    // Register all domain handlers
    registerCanvasHandler(io, authSocket);
    registerElementHandler(io, authSocket);
    registerAIHandler(io, authSocket);
    registerVoiceHandler(io, authSocket);
    registerAnnotationHandler(io, authSocket);

    // ── Disconnect cleanup ──────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      logger.debug('Socket disconnected', { socketId: socket.id, reason });

      const { currentCanvasId, userId, userName } = authSocket.data;

      // Room presence cleanup
      const affectedCanvases = roomManager.cleanupSocket(socket.id);
      for (const canvasId of affectedCanvases) {
        io.to(canvasId).emit('user:left', { userId, socketId: socket.id, userName });
      }

      // Lock cleanup — broadcast lock releases
      const releasedLocks = lockManager.releaseAllForSocket(socket.id);
      for (const { canvasId, elementId } of releasedLocks) {
        io.to(canvasId).emit('element:unlocked', { elementId, userId });
      }

      // Voice cleanup
      const voiceAffected = voiceRoomManager.cleanupSocket(socket.id);
      for (const canvasId of voiceAffected) {
        const participants = voiceRoomManager.getParticipants(canvasId);
        io.to(canvasId).emit('voice:user_left', { socketId: socket.id, userId, participants, canvasId });
      }

      // Clean up active session
      await ActiveSessionModel.deleteOne({ socketId: socket.id }).catch(() => {});
    });

    // ── Ping/keep-alive ────────────────────────────────────────────────────
    socket.emit('connected', { socketId: socket.id, serverTime: new Date() });
  });

  logger.info('Socket.IO server initialized');
  return io;
}
