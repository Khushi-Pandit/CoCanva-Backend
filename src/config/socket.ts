import { Server } from 'socket.io';

let io: Server | null = null;

export function setIO(socketIo: Server) {
  io = socketIo;
}

export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.IO has not been initialized yet');
  }
  return io;
}
