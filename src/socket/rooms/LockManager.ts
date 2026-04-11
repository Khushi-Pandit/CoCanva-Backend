/**
 * In-memory element lock manager.
 * Maps `${canvasId}:${elementId}` → { socketId, userId, userName, lockedAt }
 */
export class LockManager {
  private locks: Map<string, { socketId: string; userId: string; userName: string; lockedAt: Date }> = new Map();

  private key(canvasId: string, elementId: string): string {
    return `${canvasId}:${elementId}`;
  }

  /**
   * Try to acquire a lock. Returns true if successful, false if already locked by someone else.
   */
  acquire(
    canvasId: string,
    elementId: string,
    socketId: string,
    userId: string,
    userName: string,
  ): boolean {
    const k = this.key(canvasId, elementId);
    const existing = this.locks.get(k);

    if (!existing || existing.socketId === socketId) {
      this.locks.set(k, { socketId, userId, userName, lockedAt: new Date() });
      return true;
    }
    return false;
  }

  release(canvasId: string, elementId: string, socketId: string): boolean {
    const k = this.key(canvasId, elementId);
    const lock = this.locks.get(k);
    if (lock?.socketId === socketId) {
      this.locks.delete(k);
      return true;
    }
    return false;
  }

  getLock(canvasId: string, elementId: string) {
    return this.locks.get(this.key(canvasId, elementId)) ?? null;
  }

  isLockedBy(canvasId: string, elementId: string, socketId: string): boolean {
    return this.locks.get(this.key(canvasId, elementId))?.socketId === socketId;
  }

  /** Release all locks held by a socket (on disconnect) */
  releaseAllForSocket(socketId: string): Array<{ canvasId: string; elementId: string }> {
    const released: Array<{ canvasId: string; elementId: string }> = [];
    for (const [k, lock] of this.locks) {
      if (lock.socketId === socketId) {
        this.locks.delete(k);
        const [canvasId, elementId] = k.split(':');
        released.push({ canvasId, elementId });
      }
    }
    return released;
  }
}

export const lockManager = new LockManager();
