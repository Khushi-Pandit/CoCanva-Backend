import { Types } from 'mongoose';
import { CanvasPageModel, ICanvasPageDocument } from '../models/canvas-page.model';
import { CanvasModel } from '../models/canvas.model';
import { CanvasElementModel } from '../models/canvas-element.model';
import { complete, pickProvider, getAvailableProviders } from './ai.providers';
import { logger } from '../utils/logger';

export class PageService {
  // ── List pages ────────────────────────────────────────────────────────────
  async getPages(canvasId: string): Promise<ICanvasPageDocument[]> {
    return CanvasPageModel
      .find({ canvasId: new Types.ObjectId(canvasId) })
      .sort({ pageIndex: 1 });
  }

  // ── Ensure page 0 exists (truly atomic, race-condition safe) ──────────────
  async ensureFirstPage(canvasId: Types.ObjectId): Promise<ICanvasPageDocument> {
    // findOneAndUpdate with upsert is a single atomic MongoDB operation —
    // even if two requests arrive simultaneously, only one document is created.
    const doc = await CanvasPageModel.findOneAndUpdate(
      { canvasId, pageIndex: 0 },
      { $setOnInsert: { canvasId, pageIndex: 0, label: 'Page 1', createdAt: new Date() } },
      { upsert: true, new: true },
    );
    return doc!;
  }

  // ── Add page ──────────────────────────────────────────────────────────────
  async addPage(canvasId: string, userId: Types.ObjectId): Promise<ICanvasPageDocument> {
    const cid = new Types.ObjectId(canvasId);
    const pages = await CanvasPageModel.find({ canvasId: cid }).sort({ pageIndex: -1 }).limit(1);
    const nextIndex = pages.length === 0 ? 0 : pages[0].pageIndex + 1;
    const page = await CanvasPageModel.create({
      canvasId: cid,
      pageIndex: nextIndex,
      label: `Page ${nextIndex + 1}`,
    });
    // Update pageCount on canvas
    await CanvasModel.findByIdAndUpdate(cid, { $inc: { pageCount: 1 } });
    return page;
  }

  // ── Rename page ───────────────────────────────────────────────────────────
  async renamePage(canvasId: string, pageIndex: number, label: string): Promise<ICanvasPageDocument | null> {
    return CanvasPageModel.findOneAndUpdate(
      { canvasId: new Types.ObjectId(canvasId), pageIndex },
      { label },
      { new: true },
    );
  }

  // ── Delete page ───────────────────────────────────────────────────────────
  async deletePage(canvasId: string, pageIndex: number): Promise<void> {
    const cid = new Types.ObjectId(canvasId);
    // Soft-delete elements on this page
    await CanvasElementModel.updateMany(
      { canvasId: cid, pageIndex, isDeleted: false },
      { isDeleted: true },
    );
    // Remove page record
    await CanvasPageModel.deleteOne({ canvasId: cid, pageIndex });
    // Re-index subsequent pages
    const later = await CanvasPageModel
      .find({ canvasId: cid, pageIndex: { $gt: pageIndex } })
      .sort({ pageIndex: 1 });
    for (const p of later) {
      p.pageIndex -= 1;
      await p.save();
    }
    // Also shift element pageIndex for later pages
    const laterElements = await CanvasElementModel
      .find({ canvasId: cid, pageIndex: { $gt: pageIndex }, isDeleted: false });
    for (const el of laterElements) {
      el.pageIndex -= 1;
      await el.save();
    }
    await CanvasModel.findByIdAndUpdate(cid, { $inc: { pageCount: -1 } });
  }

  // ── Reorder pages ─────────────────────────────────────────────────────────
  async reorderPages(canvasId: string, orderedPageIndexes: number[]): Promise<void> {
    const cid = new Types.ObjectId(canvasId);
    // orderedPageIndexes = [oldIdx0, oldIdx1, ...] in new order
    const pages = await CanvasPageModel.find({ canvasId: cid });
    const pageMap = new Map(pages.map(p => [p.pageIndex, p]));
    const updates = orderedPageIndexes.map((oldIdx, newIdx) => {
      const page = pageMap.get(oldIdx);
      if (!page) return null;
      return CanvasPageModel.updateOne(
        { _id: page._id },
        { pageIndex: newIdx, label: page.label },
      );
    }).filter(Boolean);
    await Promise.all(updates);
  }

  // ── AI: Summarize a page ──────────────────────────────────────────────────
  async summarizePage(
    canvasId: string,
    pageIndex: number,
    textContent: string,
    pageLabel: string,
  ): Promise<string> {
    const cid = new Types.ObjectId(canvasId);
    if (!textContent.trim()) {
      const cached = await CanvasPageModel.findOne({ canvasId: cid, pageIndex });
      return cached?.summary ?? 'No content on this page yet.';
    }

    const available = getAvailableProviders();
    if (available.length === 0) return 'AI not configured.';

    const provider = pickProvider('summarize');
    const prompt = [
      `You are a smart note-taking assistant. Summarize the following page of notes concisely (2-4 sentences).`,
      `Page label: "${pageLabel}"`,
      `Content:\n${textContent.slice(0, 4000)}`,
    ].join('\n');

    let summary = '';
    try {
      summary = await complete(provider, prompt, 300);
    } catch (err) {
      logger.error('Page summarize failed', { error: (err as Error).message });
      summary = 'Could not generate summary.';
    }

    await CanvasPageModel.findOneAndUpdate(
      { canvasId: cid, pageIndex },
      { summary, summaryUpdatedAt: new Date() },
      { upsert: true, new: true },
    );
    return summary;
  }

  // ── AI: Ask a question about the entire notes ──────────────────────────────
  async askQuestion(canvasId: string, question: string, pageSummaries: string[]): Promise<string> {
    const available = getAvailableProviders();
    if (available.length === 0) return 'AI not configured.';

    const provider = pickProvider('chat');
    const context = pageSummaries.length > 0
      ? pageSummaries.map((s, i) => `Page ${i + 1}: ${s}`).join('\n')
      : 'No notes content available.';

    const prompt = [
      `You are a helpful study assistant. The user has notes with the following page summaries:`,
      context,
      `\nAnswer this question based on the notes:\n${question}`,
    ].join('\n');

    try {
      return await complete(provider, prompt, 600);
    } catch (err) {
      logger.error('Page Q&A failed', { error: (err as Error).message });
      return 'Could not generate an answer. Please try again.';
    }
  }

  // ── AI: Full notes summary ─────────────────────────────────────────────────
  async fullSummary(canvasId: string, title: string, pageSummaries: string[]): Promise<string> {
    const available = getAvailableProviders();
    if (available.length === 0) return 'AI not configured.';
    const provider = pickProvider('summarize');
    const context = pageSummaries.map((s, i) => `Page ${i + 1}: ${s}`).join('\n');
    const prompt = `Provide a comprehensive summary of these notes titled "${title}":\n${context}\n\nWrite 3-5 sentences.`;
    try {
      return await complete(provider, prompt, 500);
    } catch {
      return 'Could not generate summary.';
    }
  }
}

export const pageService = new PageService();
