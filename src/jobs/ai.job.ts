import { Queue, Worker, Job } from 'bullmq';
import { createRedisClient } from '../config/redis';
import { aiService } from '../services/ai.service';
import { elementService } from '../services/element.service';
import { AIJobPayload } from '../types/ai.types';
import { logger } from '../utils/logger';

export const AI_QUEUE_NAME = 'ai-requests';

let aiQueue: Queue | null = null;
let aiWorker: Worker | null = null;

export function getAIQueue(): Queue {
  if (!aiQueue) throw new Error('AI queue not initialized');
  return aiQueue;
}

export function initAIJob(io: import('socket.io').Server): void {
  const connection = createRedisClient();

  aiQueue = new Queue(AI_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  aiWorker = new Worker<AIJobPayload>(
    AI_QUEUE_NAME,
    async (job: Job<AIJobPayload>) => {
      const payload = job.data;
      const socket = io.sockets.sockets.get(payload.socketId);

      logger.info('Processing AI job', { jobId: job.id, type: payload.type });

      if (!socket) {
        logger.warn('Target socket disconnected — skipping AI job', { socketId: payload.socketId });
        return;
      }

      try {
        switch (payload.type) {
          case 'ghost_suggest': {
            const elements = await elementService.getElements(payload.canvasId);
            const result = await aiService.ghostSuggest(elements, payload.message);

            io.to(payload.canvasId).emit('element:ghost:added', {
              elements: result.suggestions,
              confidence: result.suggestions[0]?.aiConfidence ?? 0,
              reasoning: result.summary,
              requestId: payload.requestId,
            });

            socket.emit('ai:stream', {
              requestId: payload.requestId,
              canvasId: payload.canvasId,
              chunk: result.summary,
              done: true,
            });
            break;
          }

          case 'chat': {
            const elements = await elementService.getElements(payload.canvasId);
            const context = aiService.buildCanvasContext(elements);
            await aiService.chatStream(
              socket,
              payload.requestId,
              payload.canvasId,
              payload.message,
              payload.history ?? [],
              context,
            );
            break;
          }

          default:
            logger.warn('Unknown AI job type', { type: payload.type });
        }
      } catch (err) {
        logger.error('AI job failed', { jobId: job.id, error: (err as Error).message });
        socket.emit('ai:error', { requestId: payload.requestId, error: (err as Error).message });
        throw err;
      }
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 60, duration: 3600000 }, // 60/hour global
    },
  );

  aiWorker.on('completed', (job) => {
    logger.debug('AI job completed', { jobId: job.id });
  });

  aiWorker.on('failed', (job, err) => {
    logger.error('AI job failed permanently', { jobId: job?.id, error: err.message });
  });

  logger.info('AI job queue initialized');
}

export async function closeAIJob(): Promise<void> {
  await aiWorker?.close();
  await aiQueue?.close();
}
