'use strict';
const mongoose = require('mongoose');
const logger   = require('../utils/logger');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      // Recommended production settings
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS:          45000,
    });
    logger.info('MongoDB connected successfully');
  } catch (err) {
    logger.error('MongoDB initial connection failed:', err.message);
    process.exit(1);
  }
};

// Log connection events after initial connect
mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
mongoose.connection.on('reconnected',  () => logger.info('MongoDB reconnected'));
mongoose.connection.on('error',        (err) => logger.error('MongoDB error:', err.message));

module.exports = connectDB;