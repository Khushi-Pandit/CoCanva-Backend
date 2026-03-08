const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
require('dotenv').config();

const userRouter = require('./routes/user.routes');
const canvasRouter = require('./routes/canvas.routes');
const { registerSocketHandlers } = require('./socket/socketHandlers');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 4000;

connectDB();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// sendBeacon() sends Content-Type: text/plain with JSON body on page unload
// This parser handles those requests in the /save endpoint
app.use(express.text({ type: 'text/plain' }));

// REST Routes
app.use('/api/v1/user', userRouter);
app.use('/api/v1/canvas', canvasRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Socket.io
registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io enabled`);
});

module.exports = { app, server, io };