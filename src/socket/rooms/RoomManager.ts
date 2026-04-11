import { PeerState } from '../../types/socket.types';

/**
 * In-memory presence state per canvas room.
 * Maps canvasId → Map<socketId, PeerState>.
 */
export class RoomManager {
  private rooms: Map<string, Map<string, PeerState>> = new Map();

  join(canvasId: string, peer: PeerState): PeerState[] {
    if (!this.rooms.has(canvasId)) this.rooms.set(canvasId, new Map());
    this.rooms.get(canvasId)!.set(peer.socketId, peer);
    return this.getPeers(canvasId);
  }

  leave(canvasId: string, socketId: string): PeerState[] {
    this.rooms.get(canvasId)?.delete(socketId);
    if (this.rooms.get(canvasId)?.size === 0) this.rooms.delete(canvasId);
    return this.getPeers(canvasId);
  }

  updateCursor(canvasId: string, socketId: string, x: number, y: number): void {
    const peer = this.rooms.get(canvasId)?.get(socketId);
    if (peer) peer.cursor = { x, y };
  }

  updateSelection(canvasId: string, socketId: string, elementIds: string[]): void {
    const peer = this.rooms.get(canvasId)?.get(socketId);
    if (peer) peer.selectedIds = elementIds;
  }

  updateViewport(
    canvasId: string,
    socketId: string,
    viewport: { x: number; y: number; zoom: number },
  ): void {
    const peer = this.rooms.get(canvasId)?.get(socketId);
    if (peer) peer.viewport = viewport;
  }

  getPeers(canvasId: string): PeerState[] {
    return Array.from(this.rooms.get(canvasId)?.values() ?? []);
  }

  getPeer(canvasId: string, socketId: string): PeerState | undefined {
    return this.rooms.get(canvasId)?.get(socketId);
  }

  /** Called on socket disconnect — returns list of canvasIds affected */
  cleanupSocket(socketId: string): string[] {
    const affected: string[] = [];
    for (const [canvasId, peers] of this.rooms) {
      if (peers.has(socketId)) {
        peers.delete(socketId);
        if (peers.size === 0) this.rooms.delete(canvasId);
        affected.push(canvasId);
      }
    }
    return affected;
  }

  getRoomSize(canvasId: string): number {
    return this.rooms.get(canvasId)?.size ?? 0;
  }
}

export const roomManager = new RoomManager();
