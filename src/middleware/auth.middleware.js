'use strict';
const admin = require('../config/firebase');
const User  = require('../models/user.model');
const logger = require('../utils/logger');

/**
 * verifyFirebaseToken
 * Requires a valid Firebase ID token (Bearer).
 * Sets req.user to the full MongoDB User document.
 */
exports.verifyFirebaseToken = async (req, res, next) => {
  try {
    const authHeader = (req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader;

    if (!token) {
      return res.status(401).json({ message: 'No authentication token provided' });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    const user = await User.findOne({ fId: decoded.uid }).lean();
    if (!user) {
      return res.status(401).json({ message: 'User account not found. Please sign up first.' });
    }

    req.user        = user;      // MongoDB User document
    req.firebaseUid = decoded.uid;
    return next();
  } catch (err) {
    if (err.code && err.code.startsWith('auth/')) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    logger.error('Auth middleware error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * optionalAuth
 * Parses the Firebase token if present but does NOT block unauthenticated requests.
 * Sets req.user and req.firebaseUid when a valid token is found.
 */
exports.optionalAuth = async (req, _res, next) => {
  try {
    const authHeader = (req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader;

    if (!token) return next();

    const decoded = await admin.auth().verifyIdToken(token).catch(() => null);
    if (!decoded) return next();

    const user = await User.findOne({ fId: decoded.uid }).lean();
    if (user) {
      req.user        = user;
      req.firebaseUid = decoded.uid;
    }
    return next();
  } catch {
    return next();
  }
};