import { Server, Socket } from 'socket.io';
import { aiService } from '../../services/ai.service';
import { elementService } from '../../services/element.service';
import { SocketData, AIRequestPayload } from '../../types/socket.types';
import { logger } from '../../utils/logger';
import { Types } from 'mongoose';
import { CanvasElementModel } from '../../models/canvas-element.model';
import { env } from '../../config/env';

type AuthSocket = Socket & { data: SocketData };

// Track in-flight requests so we can cancel them
const activeRequests = new Map<string, AbortController>();

export function registerAIHandler(io: Server, socket: AuthSocket): void {
  socket.on('ai:request', async (payload: AIRequestPayload) => {
    if (!env.ANTHROPIC_API_KEY) {
      socket.emit('ai:error', { requestId: payload.requestId, error: 'AI not configured' });
      return;
    }

    const { requestId, canvasId, type, message, history = [], context } = payload;

    try {
      const elements = await elementService.getElements(canvasId);
      const canvasContext = context ?? aiService.buildCanvasContext(elements);

      switch (type) {
        case 'chat': {
          // Stream response back via ai:stream events
          await aiService.chatStream(socket, requestId, canvasId, message, history, canvasContext);
          break;
        }

        case 'ghost_suggest': {
          socket.emit('ai:stream', { requestId, canvasId, chunk: '⟳ Analysing canvas…', done: false });

          const result = await aiService.ghostSuggest(elements, message);

          // Persist ghost elements
          if (result.suggestions.length > 0) {
            const canvasObjId = new Types.ObjectId(canvasId);
            const userId = new Types.ObjectId(socket.data.userId);
            const ops = result.suggestions.map((s) => ({
              updateOne: {
                filter: { canvasId: canvasObjId, elementId: s.elementId },
                update: {
                  $set: { ...s, canvasId: canvasObjId, updatedBy: userId, isGhostSuggestion: true },
                  $setOnInsert: { createdBy: userId, version: 1 },
                },
                upsert: true,
              },
            }));
            await CanvasElementModel.bulkWrite(ops as any);
          }

          // Broadcast to ALL room members
          io.to(canvasId).emit('element:ghost:added', {
            elements: result.suggestions,
            confidence: result.suggestions[0]?.aiConfidence ?? 0,
            reasoning: result.summary,
            requestId,
          });

          socket.emit('ai:stream', { requestId, canvasId, chunk: result.summary, done: true });
          break;
        }

        case 'summarize': {
          const summary = await aiService.summarize(elements, canvasId);
          socket.emit('ai:stream', { requestId, canvasId, chunk: summary, done: true });
          break;
        }

        case 'layout': {
          const { layoutService } = await import('../../services/layout.service');
          const updates = layoutService.layout(elements, payload.context);
          socket.emit('ai:stream', {
            requestId, canvasId,
            chunk: `Auto-layout applied to ${updates.length} elements.`,
            done: true,
            elements: updates,
          });
          break;
        }

        case 'diagram_to_code': {
          const result = await aiService.codeFromDiagram(elements, message || 'typescript');
          socket.emit('ai:stream', { requestId, canvasId, chunk: result.code, done: true });
          break;
        }

        case 'code_to_diagram': {
          const result = await aiService.diagramFromCode(message, context ?? 'typescript', '');
          io.to(canvasId).emit('element:ghost:added', {
            elements: result.elements,
            confidence: 0.85,
            reasoning: result.summary,
            requestId,
          });
          socket.emit('ai:stream', { requestId, canvasId, chunk: result.summary, done: true });
          break;
        }

        default:
          socket.emit('ai:error', { requestId, error: `Unknown AI request type: ${type}` });
      }
    } catch (err) {
      logger.error('AI request error', { type, error: (err as Error).message });
      socket.emit('ai:error', { requestId, error: (err as Error).message });
    }
  });

  socket.on('ai:stop', ({ requestId }: { requestId: string }) => {
    const ctrl = activeRequests.get(requestId);
    if (ctrl) {
      ctrl.abort();
      activeRequests.delete(requestId);
    }
  });
}
