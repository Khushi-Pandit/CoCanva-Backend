import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

const MONGOOSE_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize: env.NODE_ENV === 'production' ? 10 : 5,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
};

export async function connectDB(): Promise<void> {
  try {
    mongoose.set('strictQuery', true);

    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connected', { host: mongoose.connection.host });
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error', { error: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected — attempting reconnect…');
    });

    await mongoose.connect(env.MONGO_URL, MONGOOSE_OPTIONS);
  } catch (err) {
    logger.error('Failed to connect to MongoDB', { error: (err as Error).message });
    throw err;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}

export { mongoose };
