import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { elementService } from '../services/element.service';
import { codegenService } from '../services/codegen.service';
import { thumbnailService } from '../services/thumbnail.service';
import { storageService } from '../services/storage.service';
import { Types } from 'mongoose';

export class ElementController {
  async getElements(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { minX, minY, maxX, maxY } = req.query as Record<string, string>;
      const elements = await elementService.getElements(String(req.params['id']), {
        minX: minX ? Number(minX) : undefined,
        minY: minY ? Number(minY) : undefined,
        maxX: maxX ? Number(maxX) : undefined,
        maxY: maxY ? Number(maxY) : undefined,
      });
      res.json({ elements });
    } catch (err) { next(err); }
  }

  async getElementById(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const el = await elementService.getElementById(String(req.params['id']), String(req.params['elementId']));
      res.json({ element: el });
    } catch (err) { next(err); }
  }

  async bulkSave(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { elements = [], deletedIds = [], viewport } = req.body as any;
      const result = await elementService.bulkSave(
        new Types.ObjectId(String(req.params['id'])),
        req.user!._id,
        elements,
        deletedIds,
      );
      res.json({ ...result, savedAt: new Date() });
    } catch (err) { next(err); }
  }

  async importElements(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { format, data } = req.body as { format: string; data: string };
      let elements: Record<string, unknown>[] = [];

      if (format === 'mermaid') {
        elements = codegenService.parseMermaid(data);
      } else {
        elements = [];
      }

      const saved = await elementService.bulkSave(
        new Types.ObjectId(String(req.params['id'])),
        req.user!._id,
        elements as any,
        [],
      );
      res.status(201).json({ ...saved, elements });
    } catch (err) { next(err); }
  }

  async exportElements(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { format } = req.query as { format?: string };
      const elements = await elementService.getElements(String(req.params['id']));

      if (format === 'mermaid') {
        res.type('text/plain').send(codegenService.toMermaid(elements));
        return;
      }
      if (format === 'plantuml') {
        res.type('text/plain').send(codegenService.toPlantUML(elements));
        return;
      }

      res.json({ elements, format: 'json' });
    } catch (err) { next(err); }
  }

  async uploadThumbnail(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { thumbnail } = req.body as { thumbnail?: string };
      const file = (req as any).file as Express.Multer.File | undefined;
      const data = file ? file.buffer : (thumbnail ?? '');
      const url = await thumbnailService.saveThumbnail(String(req.params['id']), data);
      res.json({ url });
    } catch (err) { next(err); }
  }

  async getPresignedUpload(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { filename, contentType, canvasId } = req.body as any;
      const result = await storageService.getPresignedUploadUrl({
        filename,
        contentType,
        canvasId,
        userId: req.user!._id.toString(),
      });
      res.json(result);
    } catch (err) { next(err); }
  }

  async deleteAsset(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await storageService.deleteAsset(
        decodeURIComponent(String(req.params['assetId'])),
        req.user!._id.toString(),
      );
      res.json({ message: 'Asset deleted' });
    } catch (err) { next(err); }
  }
}

export const elementController = new ElementController();
