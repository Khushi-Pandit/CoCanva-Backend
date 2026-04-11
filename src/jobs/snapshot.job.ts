import { Queue, Worker, Job } from 'bullmq';
import { createRedisClient } from '../config/redis';
import { CanvasElementModel } from '../models/canvas-element.model';
import { CanvasEventModel } from '../models/canvas-event.model';
import { CanvasSnapshotModel } from '../models/canvas-snapshot.model';
import { CanvasBranchModel } from '../models/canvas-branch.model';
import { logger } from '../utils/logger';

export const SNAPSHOT_QUEUE_NAME = 'snapshots';
const SNAPSHOT_INTERVAL = 50; // every 50 events

interface SnapshotJob {
  canvasId: string;
  branchId: string;
}

let snapshotQueue: Queue | null = null;
let snapshotWorker: Worker | null = null;

export function initSnapshotJob(): void {
  const connection = createRedisClient();

  snapshotQueue = new Queue(SNAPSHOT_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  });

  snapshotWorker = new Worker<SnapshotJob>(
    SNAPSHOT_QUEUE_NAME,
    async (job: Job<SnapshotJob>) => {
      const { canvasId, branchId } = job.data;

      // Count events since last snapshot
      const lastSnapshot = await CanvasSnapshotModel.findOne(
        { canvasId, branchId },
        {},
        { sort: { sequenceNo: -1 } },
      ).lean();

      const lastSeq = lastSnapshot?.sequenceNo ?? 0;
      const eventCount = await CanvasEventModel.countDocuments({
        canvasId, branchId, sequenceNo: { $gt: lastSeq },
      });

      if (eventCount < SNAPSHOT_INTERVAL) {
        logger.debug('Snapshot skipped — not enough events', { canvasId, eventCount });
        return;
      }

      // Take snapshot of current live elements
      const elements = await CanvasElementModel.find({ canvasId, isDeleted: false }).lean();
      const newSeq = lastSeq + eventCount;

      await CanvasSnapshotModel.create({ canvasId, branchId, sequenceNo: newSeq, elements });
      logger.info('Canvas snapshot taken', { canvasId, sequenceNo: newSeq, elementCount: elements.length });
    },
    { connection, concurrency: 2 },
  );

  snapshotWorker.on('failed', (job, err) => {
    logger.error('Snapshot job failed', { jobId: job?.id, error: err.message });
  });

  logger.info('Snapshot job queue initialized');
}

export async function enqueueSnapshot(canvasId: string, branchId: string): Promise<void> {
  await snapshotQueue?.add('snapshot', { canvasId, branchId }, {
    jobId: `snapshot:${canvasId}:${branchId}`, // deduplication
  });
}

export async function closeSnapshotJob(): Promise<void> {
  await snapshotWorker?.close();
  await snapshotQueue?.close();
}
