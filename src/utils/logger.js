// src/utils/logger.js
const winston = require('winston');
const path    = require('path');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts} [${level}]: ${stack || message}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat,
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), logFormat),
    }),
  ],
});

// In production also write to rotating files
if (process.env.NODE_ENV === 'production') {
  const DailyRotateFile = require('winston-daily-rotate-file');
  logger.add(new DailyRotateFile({
    filename:     path.join('logs', 'error-%DATE%.log'),
    datePattern:  'YYYY-MM-DD',
    level:        'error',
    maxFiles:     '14d',
    zippedArchive: true,
  }));
  logger.add(new DailyRotateFile({
    filename:     path.join('logs', 'combined-%DATE%.log'),
    datePattern:  'YYYY-MM-DD',
    maxFiles:     '14d',
    zippedArchive: true,
  }));
}

module.exports = logger;