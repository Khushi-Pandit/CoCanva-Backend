import { uploadToR2, isStorageAvailable, generatePresignedDownloadUrl } from '../config/storage';
import { CanvasModel } from '../models/canvas.model';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export class ThumbnailService {
  /**
   * Accepts a base64-encoded PNG thumbnail and stores it in R2.
   * Falls back to storing the base64 URL directly if R2 is unavailable.
   */
  async saveThumbnail(
    canvasId: string,
    data: string | Buffer,
    contentType = 'image/png',
  ): Promise<string> {
    const key = `thumbnails/${canvasId}/${Date.now()}.png`;

    if (isStorageAvailable()) {
      let buf: Buffer;
      if (typeof data === 'string') {
        const base64 = data.replace(/^data:image\/\w+;base64,/, '');
        buf = Buffer.from(base64, 'base64');
      } else {
        buf = data;
      }

      await uploadToR2(key, buf, contentType);
      const url = await generatePresignedDownloadUrl(key, 86400); // 24 hours
      
      await CanvasModel.updateOne(
        { _id: canvasId },
        { thumbnail: null, thumbnailKey: key, thumbnailUpdatedAt: new Date() },
      );
      logger.info('Thumbnail saved to R2 via signed url logic', { canvasId, url });
      return url;
    } else {
      // Fallback: store as-is (base64 data URL) — not for production
      const fallbackUrl = typeof data === 'string'
        ? data
        : `${env.CDN_BASE_URL}/${key}`;
      await CanvasModel.updateOne(
        { _id: canvasId },
        { thumbnail: fallbackUrl, thumbnailUpdatedAt: new Date() },
      );
      logger.warn('R2 unavailable — thumbnail stored as data URL fallback', { canvasId });
      return fallbackUrl;
    }
  }
}

export const thumbnailService = new ThumbnailService();
