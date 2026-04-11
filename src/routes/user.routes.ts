import { Router } from 'express';
import { userController } from '../controllers/user.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { authRateLimit, apiRateLimit } from '../middleware/rateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import { z } from 'zod';

const router = Router();

const signupSchema = z.object({
  fullName: z.string().min(1).max(120),
  preferences: z.record(z.unknown()).optional(),
});

const updateMeSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  preferences: z.object({
    theme: z.enum(['system', 'dark', 'light']).optional(),
    cursorColor: z.string().optional(),
    defaultTool: z.string().optional(),
    gridEnabled: z.boolean().optional(),
    snapToGrid: z.boolean().optional(),
    fontSize: z.number().optional(),
  }).optional(),
});

// Auth
router.post('/auth/signup', authRateLimit, requireAuth, validate(signupSchema), (req, res, next) => userController.signup(req as any, res, next));
router.post('/auth/login', authRateLimit, requireAuth, (req, res, next) => userController.login(req as any, res, next));

// User profile
router.get('/users/me', requireAuth, (req, res, next) => userController.getMe(req as any, res, next));
router.put('/users/me', requireAuth, validate(updateMeSchema), (req, res, next) => userController.updateMe(req as any, res, next));
router.delete('/users/me', requireAuth, (req, res, next) => userController.deleteAccount(req as any, res, next));

// Notifications
router.get('/users/me/notifications', requireAuth, (req, res, next) => userController.getNotifications(req as any, res, next));
router.put('/users/me/notifications/read', requireAuth, (req, res, next) => userController.markNotificationsRead(req as any, res, next));

// Search users
router.get('/users/search', requireAuth, (req, res, next) => userController.searchUsers(req as any, res, next));

export default router;
