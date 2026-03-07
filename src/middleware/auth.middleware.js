// BACKEND/src/middleware/auth.middleware.js
// Ye exact content hona chahiye — replace kar apne file mein

const admin = require('../config/firebase');
const User  = require('../models/user.model');

exports.verifyFirebaseToken = async (req, res, next) => {
  try {
    // Support both "Bearer <token>" and raw token
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : authHeader.trim();

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Verify with Firebase Admin
    const decoded = await admin.auth().verifyIdToken(token);

    // Find user in MongoDB
    const user = await User.findOne({ fId: decoded.uid });
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user    = user;
    req.decoded = decoded;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};