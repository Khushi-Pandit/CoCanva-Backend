import { Server, Socket } from 'socket.io';
import { AnnotationModel } from '../../models/annotation.model';
import { SocketData } from '../../types/socket.types';
import { Types } from 'mongoose';

type AuthSocket = Socket & { data: SocketData };

export function registerAnnotationHandler(io: Server, socket: AuthSocket): void {
  // ── annotation:add ─────────────────────────────────────────────────────────
  socket.on('annotation:add', async (payload: {
    canvasId: string;
    annotation: {
      text: string;
      region?: { x: number; y: number; width: number; height: number };
      attachedToElementId?: string;
      parentId?: string;
    };
  }) => {
    try {
      const annotation = await AnnotationModel.create({
        canvasId: payload.canvasId,
        text: payload.annotation.text,
        region: payload.annotation.region ?? null,
        attachedToElementId: payload.annotation.attachedToElementId ?? null,
        parentId: payload.annotation.parentId
          ? new Types.ObjectId(payload.annotation.parentId)
          : null,
        author: new Types.ObjectId(socket.data.userId),
      });

      const populated = await annotation.populate('author', 'fullName avatarUrl avatarId');

      io.to(payload.canvasId).emit('annotation:added', {
        annotation: populated,
        userId: socket.data.userId,
      });
    } catch (err) {
      socket.emit('error', { code: 'ANNOTATION_ERROR', message: (err as Error).message });
    }
  });

  // ── annotation:resolve ─────────────────────────────────────────────────────
  socket.on('annotation:resolve', async (payload: { canvasId: string; annotationId: string }) => {
    try {
      const annotation = await AnnotationModel.findByIdAndUpdate(
        payload.annotationId,
        { resolvedAt: new Date(), resolvedBy: new Types.ObjectId(socket.data.userId) },
        { new: true },
      );

      if (annotation) {
        io.to(payload.canvasId).emit('annotation:resolved', {
          annotationId: payload.annotationId,
          resolvedBy: socket.data.userId,
        });
      }
    } catch (err) {
      socket.emit('error', { code: 'ANNOTATION_ERROR', message: (err as Error).message });
    }
  });
}
