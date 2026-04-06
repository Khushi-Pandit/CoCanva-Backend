'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');

const connectDB              = require('./src/config/db');
const logger                 = require('./src/utils/logger');
const userRouter             = require('./src/routes/user.routes');
const canvasRouter           = require('./src/routes/canvas.routes');
const { registerSocketHandlers } = require('./src/socket/socketHandlers');

// ── Validation ───────────────────────────────────────────────────────────────
if (!process.env.MONGO_URL) {
  logger.error('MONGO_URL is not set in environment variables');
  process.exit(1);
}

// ── App & HTTP server ────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Socket.IO ────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',').map((o) => o.trim());

const io = new Server(server, {
  cors: {
    origin:      allowedOrigins,
    methods:     ['GET', 'POST'],
    credentials: true,
  },
  transports:        ['websocket', 'polling'],
  pingInterval:      10_000,
  pingTimeout:       5_000,
  maxHttpBufferSize: 5e6,       // 5 MB — for image payloads
  connectionStateRecovery: {   // reconnect without re-joining (Socket.IO v4.6+)
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: false,
  },
});

// ── Database ─────────────────────────────────────────────────────────────────
connectDB();

// ── Global middleware ────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// GZIP compression
app.use(compression());

// CORS
app.use(cors({
  origin:      allowedOrigins,
  credentials: true,
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
// sendBeacon() sends Content-Type: text/plain with a JSON body on page unload.
// The /save endpoint handles this case by JSON.parse-ing the string body.
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 min
  max:             500,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many requests — slow down.' },
});

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message: 'Too many auth requests — try again later.' },
});

app.use('/api/', globalLimiter);
app.use('/api/v1/user/signup', authLimiter);
app.use('/api/v1/user/login',  authLimiter);

// ── REST Routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/user',   userRouter);
app.use('/api/v1/canvas', canvasRouter);

app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: Date.now(), uptime: process.uptime() })
);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

// ── Socket.IO handlers ────────────────────────────────────────────────────────
registerSocketHandlers(io);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Socket.IO ready`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000); // force exit after 10 s
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = { app, server, io };
