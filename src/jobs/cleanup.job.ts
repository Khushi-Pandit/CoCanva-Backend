import { Queue, Worker, Job } from 'bullmq';
import { createRedisClient } from '../config/redis';
import { CanvasModel } from '../models/canvas.model';
import { CanvasElementModel } from '../models/canvas-element.model';
import { logger } from '../utils/logger';

export const CLEANUP_QUEUE_NAME = 'cleanup';

let cleanupQueue: Queue | null = null;
let cleanupWorker: Worker | null = null;

export function initCleanupJob(): void {
  const connection = createRedisClient();

  cleanupQueue = new Queue(CLEANUP_QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: 10, removeOnFail: 20 },
  });

  cleanupWorker = new Worker(
    CLEANUP_QUEUE_NAME,
    async (job: Job) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);

      // Hard-delete canvases soft-deleted more than 30 days ago
      const oldCanvases = await CanvasModel.find({
        deletedAt: { $lte: thirtyDaysAgo },
      }).select('_id').lean();

      for (const canvas of oldCanvases) {
        await CanvasElementModel.deleteMany({ canvasId: canvas._id });
        await CanvasModel.deleteOne({ _id: canvas._id });
        logger.info('Hard-deleted canvas', { canvasId: canvas._id });
      }

      // Hard-delete soft-deleted elements older than 30 days
      const result = await CanvasElementModel.deleteMany({
        isDeleted: true,
        updatedAt: { $lte: thirtyDaysAgo },
      });

      logger.info('Cleanup job completed', {
        canvasesDeleted: oldCanvases.length,
        elementsDeleted: result.deletedCount,
      });
    },
    { connection, concurrency: 1 },
  );

  // Schedule daily cleanup using repeatable job
  cleanupQueue.add('daily-cleanup', {}, {
    repeat: { pattern: '0 2 * * *' }, // 2 AM daily
    jobId: 'daily-cleanup',
  }).catch(() => {});

  cleanupWorker.on('completed', (job) => {
    logger.debug('Cleanup job completed', { jobId: job.id });
  });

  cleanupWorker.on('failed', (job, err) => {
    logger.error('Cleanup job failed', { jobId: job?.id, error: err.message });
  });

  logger.info('Cleanup job queue initialized (runs daily at 2 AM)');
}

export async function closeCleanupJob(): Promise<void> {
  await cleanupWorker?.close();
  await cleanupQueue?.close();
}
