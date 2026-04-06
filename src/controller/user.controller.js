'use strict';
const admin  = require('../config/firebase');
const User   = require('../models/user.model');
const logger = require('../utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────
const sanitizeUser = (user) => ({
  _id:       user._id,
  fullName:  user.fullName,
  email:     user.email,
  avatarUrl: user.avatarUrl ?? null,
  avatarId:  user.avatarId  ?? 0,
  createdAt: user.createdAt,
});

// ── POST /api/v1/user/signup ──────────────────────────────────────────────────
// The Firebase ID token MUST be verified server-side — the fId is extracted
// from the verified token, never accepted from the request body (security).
exports.userSignup = async (req, res) => {
  try {
    const authHeader = (req.headers.authorization || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
    if (!token) return res.status(401).json({ message: 'No token provided' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const { fullName } = req.body;
    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ message: 'fullName is required' });
    }

    // Idempotent: return existing user if already registered
    let user = await User.findOne({ fId: decoded.uid });
    if (user) {
      return res.status(200).json({ message: 'User already registered', user: sanitizeUser(user) });
    }

    user = await User.create({
      fId:      decoded.uid,
      email:    decoded.email,
      fullName: fullName.trim(),
    });

    return res.status(201).json({ message: 'Account created', user: sanitizeUser(user) });
  } catch (err) {
    logger.error('userSignup error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── POST /api/v1/user/login ───────────────────────────────────────────────────
// Token is verified by the verifyFirebaseToken middleware.
// req.user is the MongoDB User document.
exports.loginUser = async (req, res) => {
  try {
    return res.json({ message: 'Login successful', user: sanitizeUser(req.user) });
  } catch (err) {
    logger.error('loginUser error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── GET /api/v1/user/me ───────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    return res.json({ user: sanitizeUser(req.user) });
  } catch (err) {
    logger.error('getMe error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ── PUT /api/v1/user/me ───────────────────────────────────────────────────────
exports.updateMe = async (req, res) => {
  try {
    const allowed = {};
    if (req.body.fullName)  allowed.fullName  = String(req.body.fullName).trim().slice(0, 120);
    if (req.body.avatarUrl) allowed.avatarUrl = String(req.body.avatarUrl).trim();
    if (typeof req.body.avatarId === 'number') allowed.avatarId = req.body.avatarId;

    if (!Object.keys(allowed).length) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, allowed, { new: true }).lean();
    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    logger.error('updateMe error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};