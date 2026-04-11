import { Socket } from 'socket.io';
import { verifyFirebaseToken } from '../../config/firebase';
import { UserModel } from '../../models/user.model';
import { SocketData } from '../../types/socket.types';
import { logger } from '../../utils/logger';

/**
 * Socket.IO authentication middleware.
 * Verified Firebase ID token from socket.handshake.auth.token.
 * Attaches userId, userName, userColor, fId, role to socket.data.
 */
export async function socketAuthMiddleware(
  socket: Socket & { data: SocketData },
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const token = socket.handshake.auth['token'] as string | undefined;
    const shareToken = socket.handshake.auth['shareToken'] as string | undefined;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const decoded = await verifyFirebaseToken(token);

    let user: any = await UserModel.findOne({ fId: decoded.uid }).lean();
    if (!user) {
      user = await UserModel.create({
        fId: decoded.uid,
        email: decoded.email ?? `${decoded.uid}@noemail.invalid`,
        fullName: decoded.name ?? 'Anonymous',
        avatarUrl: decoded.picture ?? null,
      }) as any;
    }

    socket.data = {
      userId: user._id.toString(),
      userName: user.fullName,
      userColor: (user.preferences?.cursorColor as string | undefined) ?? generateColor(user._id.toString()),
      fId: decoded.uid,
      currentCanvasId: null,
      role: 'viewer',
    };

    next();
  } catch (err) {
    logger.warn('Socket auth failed', { error: (err as Error).message });
    next(new Error('Authentication failed: ' + (err as Error).message));
  }
}

function generateColor(seed: string): string {
  const colors = [
    '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
  ];
  const hash = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}
