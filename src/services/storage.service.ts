import {
  generatePresignedUploadUrl,
  deleteFromR2,
  isStorageAvailable,
} from '../config/storage';
import { ForbiddenError, ServiceUnavailableError } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';

export class StorageService {
  /**
   * Generates a pre-signed R2 upload URL.
   * Returns { uploadUrl, assetUrl, assetId } for the client to PUT to directly.
   */
  async getPresignedUploadUrl(opts: {
    filename: string;
    contentType: string;
    canvasId: string;
    userId: string;
  }): Promise<{ uploadUrl: string; assetUrl: string; assetId: string }> {
    if (!isStorageAvailable()) {
      throw new ServiceUnavailableError('File storage is not configured');
    }

    const ext = opts.filename.split('.').pop() ?? 'bin';
    const assetId = uuidv4();
    const key = `assets/${opts.userId}/${opts.canvasId}/${assetId}.${ext}`;

    const uploadUrl = await generatePresignedUploadUrl(key, opts.contentType, 300);
    const assetUrl = `${env.CDN_BASE_URL}/${key}`;

    return { uploadUrl, assetUrl, assetId };
  }

  /**
   * Deletes an asset from R2. Only owner may delete.
   */
  async deleteAsset(key: string, requestingUserId: string): Promise<void> {
    // Key must start with assets/<userId>/
    const ownerPrefix = `assets/${requestingUserId}/`;
    if (!key.startsWith(ownerPrefix)) {
      throw new ForbiddenError('Cannot delete another user\'s asset');
    }

    if (!isStorageAvailable()) {
      throw new ServiceUnavailableError('File storage is not configured');
    }

    await deleteFromR2(key);
  }
}

export const storageService = new StorageService();
