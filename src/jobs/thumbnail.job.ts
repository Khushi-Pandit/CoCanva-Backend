import { Queue, Worker, Job } from 'bullmq';
import { createRedisClient } from '../config/redis';
import { thumbnailService } from '../services/thumbnail.service';
import { logger } from '../utils/logger';

export const THUMBNAIL_QUEUE_NAME = 'thumbnails';

interface ThumbnailJob {
  canvasId: string;
  imageData: string; // base64
  contentType: string;
}

let thumbnailQueue: Queue | null = null;
let thumbnailWorker: Worker | null = null;

export function initThumbnailJob(): void {
  const connection = createRedisClient();

  thumbnailQueue = new Queue(THUMBNAIL_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });

  thumbnailWorker = new Worker<ThumbnailJob>(
    THUMBNAIL_QUEUE_NAME,
    async (job: Job<ThumbnailJob>) => {
      const { canvasId, imageData, contentType } = job.data;
      await thumbnailService.saveThumbnail(canvasId, imageData, contentType);
      logger.debug('Thumbnail job completed', { canvasId });
    },
    { connection, concurrency: 3 },
  );

  thumbnailWorker.on('failed', (job, err) => {
    logger.error('Thumbnail job failed', { jobId: job?.id, error: err.message });
  });

  logger.info('Thumbnail job queue initialized');
}

export async function enqueueThumbnail(canvasId: string, imageData: string): Promise<void> {
  await thumbnailQueue?.add('generate', { canvasId, imageData, contentType: 'image/png' });
}

export async function closeThumbnailJob(): Promise<void> {
  await thumbnailWorker?.close();
  await thumbnailQueue?.close();
}
