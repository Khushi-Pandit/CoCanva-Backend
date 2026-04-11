import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from '../config/firebase';
import { UserModel } from '../models/user.model';
import { CanvasModel } from '../models/canvas.model';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../utils/errors';
import { cacheGet, cacheSet, CACHE_TTL, cacheDel } from '../config/redis';
import { AuthenticatedRequest } from '../types/user.types';
import { CanvasRole } from '../types/canvas.types';
import { logger } from '../utils/logger';
import { Types } from 'mongoose';
import { getSafeId } from '../utils/id.util';

/**
 * Extracts Firebase Bearer token, verifies it, resolves MongoDB user,
 * and attaches to req.user. Throws 401 if invalid.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) throw new UnauthorizedError('Bearer token required');

    const decoded = await verifyFirebaseToken(token);
    const user = await resolveOrCreateUser(decoded.uid, decoded);

    req.user = user;
    next();
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError((err as Error).message));
  }
}

/**
 * Same as requireAuth but does not throw if the token is missing.
 * Useful for public endpoints that optionally show extra data when authed.
 */
export async function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) { next(); return; }

    const decoded = await verifyFirebaseToken(token);
    const user = await resolveOrCreateUser(decoded.uid, decoded);
    req.user = user;
  } catch {
    // swallow — stays unauthenticated
  }
  next();
}

/**
 * Middleware factory — resolves the caller's role on a canvas and attaches
 * req.canvasRole. Enforces minimum required role if provided.
 *
 * Also resolves share token from the `x-share-token` header for guest access.
 */
export function requireCanvasRole(minRole?: CanvasRole) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const canvasId = req.params['id'] || req.params['canvasId'];
      if (!canvasId) throw new NotFoundError('Canvas ID missing');

      const canvas = await CanvasModel.findById(canvasId).lean();
      if (!canvas || canvas.deletedAt) throw new NotFoundError('Canvas not found');

      let role: CanvasRole | null = null;

      if (req.user) {
        const uidStr = getSafeId(req.user._id);
        const ownerIdStr = getSafeId(canvas.owner);
          
        if (ownerIdStr === uidStr) {
          role = 'owner';
        } else {
          const collab = canvas.collaborators?.find((c) => getSafeId(c.user) === uidStr);
          if (collab) role = collab.role as CanvasRole;
        }
      }

      // Check share token if no role yet — accept from header OR query param
      if (!role) {
        const shareToken =
          (req.query['shareToken'] as string | undefined) ||
          (req.headers['x-share-token'] as string | undefined);
        if (shareToken) {
          const tokenEntry = canvas.shareTokens.find(
            (t) =>
              t.token === shareToken &&
              !t.revokedAt &&
              (!t.expiresAt || new Date(t.expiresAt) > new Date()) &&
              (!t.maxUses || t.useCount < t.maxUses),
          );
          if (tokenEntry) {
            role = tokenEntry.role as CanvasRole;
            // Increment use count async
            CanvasModel.updateOne(
              { _id: canvasId, 'shareTokens.token': shareToken },
              { $inc: { 'shareTokens.$.useCount': 1 } },
            ).catch(() => {});
          }
        }
      }

      // Public canvas → viewer
      if (!role && canvas.isPublic) role = 'viewer';

      if (!role) throw new ForbiddenError('You do not have access to this canvas');

      if (minRole) {
        const roleOrder: CanvasRole[] = ['viewer', 'commenter', 'editor', 'owner'];
        if (roleOrder.indexOf(role) < roleOrder.indexOf(minRole)) {
          throw new ForbiddenError(`At least ${minRole} role required`);
        }
      }

      req.canvasRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return null;
}

async function resolveOrCreateUser(
  fId: string,
  decoded: { uid: string; email?: string; name?: string; picture?: string },
) {
  const cacheKey = `user:fid:${fId}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  let user = await UserModel.findOne({ fId }).lean();
  if (!user) {
    // Auto-create user on first auth (magic-link flow)
    user = await UserModel.create({
      fId,
      email: decoded.email ?? `${fId}@noemail.invalid`,
      fullName: decoded.name ?? 'New User',
      avatarUrl: decoded.picture ?? null,
    }) as any;
    logger.info('Auto-created user', { fId, email: (user as any).email });
  } else {
    // Update lastSeenAt async
    UserModel.updateOne({ fId }, { lastSeenAt: new Date() }).catch(() => {});
  }

  await cacheSet(cacheKey, user, CACHE_TTL.USER_PROFILE);
  return user as unknown as typeof user & { _id: Types.ObjectId };
}

export async function invalidateUserCache(fId: string): Promise<void> {
  await cacheDel(`user:fid:${fId}`);
}
