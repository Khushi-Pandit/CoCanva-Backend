import 'dotenv/config';
import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';

import { env } from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { connectRedis, disconnectRedis } from './config/redis';
import { initFirebase } from './config/firebase';
import { initStorage } from './config/storage';
import { setIO } from './config/socket';
import { logger } from './utils/logger';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware';
import { apiRateLimit } from './middleware/rateLimit.middleware';

// Routes
import userRoutes from './routes/user.routes';
import canvasRoutes from './routes/canvas.routes';
import elementRoutes from './routes/element.routes';
import annotationRoutes from './routes/annotation.routes';
import aiRoutes from './routes/ai.routes';
import searchRoutes from './routes/search.routes';
import branchRoutes from './routes/branch.routes';

// Socket
import { createSocketServer } from './socket/socket.server';

// Jobs
import { initAIJob, closeAIJob } from './jobs/ai.job';
import { initThumbnailJob, closeThumbnailJob } from './jobs/thumbnail.job';
import { initSnapshotJob, closeSnapshotJob } from './jobs/snapshot.job';
import { initCleanupJob, closeCleanupJob } from './jobs/cleanup.job';

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

app.set('trust proxy', 1);

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-share-token', 'x-request-id'],
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'drawsync-api',
    version: '1.0.0',
    timestamp: new Date(),
    env: env.NODE_ENV,
  });
});

// ── API v1 routes ─────────────────────────────────────────────────────────────

const v1 = express.Router();
v1.use(apiRateLimit);
v1.use(userRoutes);
v1.use(canvasRoutes);
v1.use(elementRoutes);
v1.use(annotationRoutes);
v1.use(aiRoutes);
v1.use(searchRoutes);
v1.use(branchRoutes);

app.use('/v1', v1);

// Legacy redirect
app.get('/', (_req: Request, res: Response) => {
  res.json({ name: 'DrawSync API', version: '1.0.0', docs: '/v1/health' });
});

// 404 + Error handlers
app.use(notFoundMiddleware);
app.use(errorMiddleware);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  logger.info('Starting DrawSync API…', { env: env.NODE_ENV, port: env.PORT });

  // Initialise config layer
  initFirebase();
  initStorage();

  // Connect to data stores
  await connectDB();

  let socketServer: ReturnType<typeof createSocketServer> | null = null;

  try {
    await connectRedis();
  } catch (err) {
    logger.warn('Redis unavailable — proceeding without Redis (single-server mode)', {
      error: (err as Error).message,
    });
  }

  // HTTP + WebSocket server
  const httpServer = http.createServer(app);
  socketServer = createSocketServer(httpServer);
  setIO(socketServer);

  // Background jobs
  try {
    initAIJob(socketServer);
    initThumbnailJob();
    initSnapshotJob();
    initCleanupJob();
  } catch (err) {
    logger.warn('BullMQ jobs could not start (Redis required)', {
      error: (err as Error).message,
    });
  }

  httpServer.listen(env.PORT, () => {
    logger.info(`✅ DrawSync API running`, {
      port: env.PORT,
      url: `http://localhost:${env.PORT}`,
      wsUrl: `ws://localhost:${env.PORT}`,
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully…`);

    // Stop accepting connections
    httpServer.close(async () => {
      try {
        await Promise.allSettled([
          closeAIJob(),
          closeThumbnailJob(),
          closeSnapshotJob(),
          closeCleanupJob(),
          disconnectDB(),
          disconnectRedis(),
        ]);
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', { error: (err as Error).message });
        process.exit(1);
      }
    });

    // Force exit after 30s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Unhandled rejections / exceptions
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed', { error: (err as Error).message });
  process.exit(1);
});
