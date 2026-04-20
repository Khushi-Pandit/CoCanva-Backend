import { Server, Socket } from 'socket.io';
import { voiceRoomManager } from '../rooms/VoiceRoomManager';
import { SocketData } from '../../types/socket.types';
import { CanvasModel } from '../../models/canvas.model';
import { logger } from '../../utils/logger';

type AuthSocket = Socket & { data: SocketData };

export function registerVoiceHandler(io: Server, socket: AuthSocket): void {
  // ── voice:join ─────────────────────────────────────────────────────────────
  socket.on('voice:join', ({ canvasId }: { canvasId: string }) => {
    const participants = voiceRoomManager.join(canvasId, {
      socketId: socket.id,
      userId: socket.data.userId,
      userName: socket.data.userName,
      userColor: socket.data.userColor,
      role: socket.data.role,
      cursor: null,
      selectedIds: [],
      viewport: null,
      isMuted: false,
      viewportCenter: null,
    });

    // Tell the joiner about existing participants
    socket.emit('voice:participants', { canvasId, participants });

    // Tell room about the new participant
    socket.to(canvasId).emit('voice:user_joined', {
      participant: {
        socketId: socket.id,
        userId: socket.data.userId,
        userName: socket.data.userName,
        userColor: socket.data.userColor,
        isMuted: false,
      },
      participants,
      canvasId,
    });

    logger.debug('Voice join', { socketId: socket.id, canvasId });
  });

  // ── voice:leave ────────────────────────────────────────────────────────────
  socket.on('voice:leave', ({ canvasId }: { canvasId: string }) => {
    const participants = voiceRoomManager.leave(canvasId, socket.id);

    socket.to(canvasId).emit('voice:user_left', {
      socketId: socket.id,
      userId: socket.data.userId,
      participants,
      canvasId,
    });
  });

  // ── WebRTC signaling relay (server never touches audio data) ───────────────
  socket.on('voice:offer', ({ canvasId, targetSocketId, sdp }: {
    canvasId: string;
    targetSocketId: string;
    sdp: RTCSessionDescriptionInit;
  }) => {
    io.to(targetSocketId).emit('voice:offer', {
      canvasId,
      fromSocketId: socket.id,
      fromUserId: socket.data.userId,
      sdp,
    });
  });

  socket.on('voice:answer', ({ canvasId, targetSocketId, sdp }: {
    canvasId: string;
    targetSocketId: string;
    sdp: RTCSessionDescriptionInit;
  }) => {
    io.to(targetSocketId).emit('voice:answer', {
      canvasId,
      fromSocketId: socket.id,
      sdp,
    });
  });

  socket.on('voice:ice', ({ canvasId, targetSocketId, candidate }: {
    canvasId: string;
    targetSocketId: string;
    candidate: RTCIceCandidateInit;
  }) => {
    io.to(targetSocketId).emit('voice:ice', {
      canvasId,
      fromSocketId: socket.id,
      candidate,
    });
  });

  // ── voice:mute_toggle ──────────────────────────────────────────────────────
  socket.on('voice:mute_toggle', ({ canvasId, muted }: { canvasId: string; muted: boolean }) => {
    const participants = voiceRoomManager.setMute(canvasId, socket.id, muted);
    io.to(canvasId).emit('voice:mute_changed', {
      socketId: socket.id,
      muted,
      participants,
    });
  });

  // ── voice:position (spatial audio) ────────────────────────────────────────
  socket.on('voice:position', ({ canvasId, x, y, zoom }: {
    canvasId: string;
    x: number;
    y: number;
    zoom: number;
  }) => {
    voiceRoomManager.updatePosition(canvasId, socket.id, x, y);
    // Broadcast position to room so peers can update their PannerNode
    socket.to(canvasId).emit('voice:position', {
      socketId: socket.id,
      userId: socket.data.userId,
      x, y, zoom,
    });
  });

  // ── voice:transcript_chunk ─────────────────────────────────────────────────
  socket.on('voice:transcript_chunk', async ({ canvasId, pageIndex, transcript, userName }: {
    canvasId: string;
    pageIndex: number;
    transcript: string;
    userName: string;
  }) => {
    logger.info('voice:transcript_chunk received', { canvasId, pageIndex, transcript: transcript?.substring(0, 50), userName });
    if (!transcript?.trim()) return;
    try {
      const canvas = await CanvasModel.findById(canvasId);
      if (!canvas) return;

      const pIdx = String(pageIndex);
      if (!canvas.pageTranscripts) {
        canvas.pageTranscripts = new Map<string, string>();
      }
      
      const existing = canvas.pageTranscripts.get(pIdx) || '';
      const separator = existing ? '\n' : '';
      const formatted = `${existing}${separator}[${userName}]: ${transcript.trim()}`;

      canvas.pageTranscripts.set(pIdx, formatted);
      canvas.markModified('pageTranscripts');
      await canvas.save();
      
      logger.debug('Saved transcript chunk to DB', { canvasId, pageIndex, length: transcript.length });
    } catch (e) {
      logger.error('Failed to save transcript chunk', { error: (e as Error).message });
    }
  });
}
