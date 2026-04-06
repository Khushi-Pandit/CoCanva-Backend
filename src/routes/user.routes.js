'use strict';
const router = require('express').Router();
const { verifyFirebaseToken } = require('../middleware/auth.middleware');
const ctrl = require('../controller/user.controller');

// POST /api/v1/user/signup — verifies token server-side, no DB auth middleware needed
router.post('/signup', ctrl.userSignup);

// POST /api/v1/user/login — verifyFirebaseToken middleware sets req.user
router.post('/login', verifyFirebaseToken, ctrl.loginUser);

// Protected routes
router.get( '/me', verifyFirebaseToken, ctrl.getMe);
router.put( '/me', verifyFirebaseToken, ctrl.updateMe);

module.exports = router;