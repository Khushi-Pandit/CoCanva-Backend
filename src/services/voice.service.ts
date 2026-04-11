import { VoicePeer } from '../types/socket.types';

/**
 * In-memory voice room state.
 * Tracks participants, mute status, and spatial viewport positions.
 */
export class VoiceService {
  private rooms: Map<string, Map<string, VoicePeer>> = new Map();

  join(canvasId: string, peer: VoicePeer): VoicePeer[] {
    if (!this.rooms.has(canvasId)) this.rooms.set(canvasId, new Map());
    this.rooms.get(canvasId)!.set(peer.socketId, peer);
    return this.getParticipants(canvasId);
  }

  leave(canvasId: string, socketId: string): VoicePeer[] {
    this.rooms.get(canvasId)?.delete(socketId);
    return this.getParticipants(canvasId);
  }

  updatePosition(
    canvasId: string,
    socketId: string,
    x: number,
    y: number,
  ): void {
    const peer = this.rooms.get(canvasId)?.get(socketId);
    if (peer) peer.viewportCenter = { x, y };
  }

  updateMute(canvasId: string, socketId: string, muted: boolean): VoicePeer[] {
    const peer = this.rooms.get(canvasId)?.get(socketId);
    if (peer) peer.isMuted = muted;
    return this.getParticipants(canvasId);
  }

  getParticipants(canvasId: string): VoicePeer[] {
    return Array.from(this.rooms.get(canvasId)?.values() ?? []);
  }

  cleanupSocket(socketId: string): string[] {
    const affected: string[] = [];
    for (const [canvasId, peers] of this.rooms) {
      if (peers.has(socketId)) {
        peers.delete(socketId);
        affected.push(canvasId);
      }
    }
    return affected;
  }
}

export const voiceService = new VoiceService();
