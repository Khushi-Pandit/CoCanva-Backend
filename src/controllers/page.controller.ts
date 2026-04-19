import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { pageService } from '../services/page.service';

export class PageController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const pages = await pageService.getPages(String(req.params['id']));
      res.json({ pages });
    } catch (err) { next(err); }
  }

  async ensureFirst(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { Types } = await import('mongoose');
      const page = await pageService.ensureFirstPage(new Types.ObjectId(String(req.params['id'])));
      res.json({ page });
    } catch (err) { next(err); }
  }

  async add(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const page = await pageService.addPage(String(req.params['id']), req.user!._id);
      res.status(201).json({ page });
    } catch (err) { next(err); }
  }

  async rename(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { label } = req.body as { label: string };
      const page = await pageService.renamePage(
        String(req.params['id']),
        Number(req.params['pageIndex']),
        label ?? '',
      );
      res.json({ page });
    } catch (err) { next(err); }
  }

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await pageService.deletePage(String(req.params['id']), Number(req.params['pageIndex']));
      res.json({ message: 'Page deleted' });
    } catch (err) { next(err); }
  }

  async reorder(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { order } = req.body as { order: number[] };
      await pageService.reorderPages(String(req.params['id']), order);
      res.json({ message: 'Reordered' });
    } catch (err) { next(err); }
  }

  async summarize(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { textContent, pageLabel } = req.body as { textContent: string; pageLabel: string };
      const summary = await pageService.summarizePage(
        String(req.params['id']),
        Number(req.params['pageIndex']),
        textContent ?? '',
        pageLabel ?? `Page ${Number(req.params['pageIndex']) + 1}`,
      );
      res.json({ summary });
    } catch (err) { next(err); }
  }

  async ask(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { question, pageSummaries } = req.body as { question: string; pageSummaries: string[] };
      const answer = await pageService.askQuestion(
        String(req.params['id']),
        question ?? '',
        pageSummaries ?? [],
      );
      res.json({ answer });
    } catch (err) { next(err); }
  }

  async fullSummary(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { title, pageSummaries } = req.body as { title: string; pageSummaries: string[] };
      const summary = await pageService.fullSummary(
        String(req.params['id']),
        title ?? 'Untitled Notes',
        pageSummaries ?? [],
      );
      res.json({ summary });
    } catch (err) { next(err); }
  }
}

export const pageController = new PageController();
