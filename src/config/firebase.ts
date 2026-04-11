import * as admin from 'firebase-admin';
import { env } from './env';
import { logger } from '../utils/logger';

let firebaseApp: admin.app.App | null = null;

export function initFirebase(): void {
  if (env.DEV_AUTH_BYPASS) {
    logger.warn('⚠️  DEV_AUTH_BYPASS=true — Firebase auth validation is DISABLED');
    return;
  }

  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    logger.error('FIREBASE_SERVICE_ACCOUNT_JSON is required when DEV_AUTH_BYPASS=false');
    process.exit(1);
  }

  try {
    const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    logger.info('Firebase Admin initialized', {
      projectId: serviceAccount.project_id,
    });
  } catch (err) {
    logger.error('Failed to initialize Firebase', { error: (err as Error).message });
    throw err;
  }
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  if (env.DEV_AUTH_BYPASS) {
    // Return a mock decoded token in dev mode
    return {
      uid: env.DEV_AUTH_USER_ID,
      email: 'dev@drawsync.app',
      name: 'Dev User',
      picture: null,
      iss: 'dev',
      aud: 'dev',
      auth_time: Math.floor(Date.now() / 1000),
      sub: env.DEV_AUTH_USER_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { identities: {}, sign_in_provider: 'custom' },
    } as unknown as admin.auth.DecodedIdToken;
  }

  const auth = admin.auth(firebaseApp!);
  return auth.verifyIdToken(token);
}

export function getFirebaseAuth(): admin.auth.Auth {
  if (!firebaseApp) throw new Error('Firebase not initialized');
  return admin.auth(firebaseApp);
}
