import { Server, Socket } from 'socket.io';
import { voiceRoomManager } from '../rooms/VoiceRoomManager';
import { SocketData } from '../../types/socket.types';
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
}
