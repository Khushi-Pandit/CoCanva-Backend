import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/user.types';
import { aiService } from '../services/ai.service';
import { elementService } from '../services/element.service';
import { layoutService } from '../services/layout.service';
import { CanvasElementModel } from '../models/canvas-element.model';
import { CanvasModel } from '../models/canvas.model';
import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { complete, pickProvider, getAvailableProviders } from '../services/ai.providers';

function pid(req: AuthenticatedRequest): string {
  return String(req.params['id']);
}

export class AIController {
  // ── Agent Chat (new primary endpoint) ─────────────────────────────────────
  async agentChat(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { message, history = [], model = 'auto', elements: clientElements = [], selectedElementIds = [], contextType = 'canvas', pageIndex = 0 } = req.body as any;
      if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return; }

      // Use client-sent elements (already serialized) as the canvas context
      // This avoids a DB round-trip and ensures the AI sees the most current state
      const dbElements = clientElements.length > 0
        ? clientElements   // Trust client for speed
        : await elementService.getElements(pid(req));

      let transcript = '';
      if (contextType === 'notes') {
        const canvas = await CanvasModel.findById(pid(req)).select('pageTranscripts').lean();
        // @ts-ignore - lean() returns plain object, bypass Map wrapper
        transcript = canvas?.pageTranscripts?.[String(pageIndex)] || '';
      }

      const result = await aiService.agentChat(
        String(message),
        history,
        dbElements,
        selectedElementIds,
        model,
        contextType,
        transcript
      );

      res.json(result);
    } catch (err) { next(err); }
  }

  // ── Legacy plain chat (kept for backwards compat) ─────────────────────────
  async chat(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const available = getAvailableProviders();
      if (available.length === 0) {
        res.status(503).json({ error: 'No AI providers configured. Add ANTHROPIC_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY.' });
        return;
      }
      const { message, history = [], model = 'auto' } = req.body as any;
      const elements = await elementService.getElements(pid(req));
      const context = aiService.buildCanvasContext(elements);
      const provider = pickProvider('chat', model);
      const systemPrompt = `You are DrawSync AI, an intelligent assistant embedded in a collaborative canvas. Canvas state: ${context}`;
      const text = await complete(provider, `${systemPrompt}\n\nUser: ${message}`, 2048);
      res.json({ message: text, requestId: uuidv4(), modelUsed: provider });
    } catch (err) { next(err); }
  }

  // ── Explain a specific element ─────────────────────────────────────────────
  async explainElement(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { elementId, elements: clientElements = [] } = req.body as any;
      if (!elementId) { res.status(400).json({ error: 'elementId is required' }); return; }

      const allElements = clientElements.length > 0
        ? clientElements
        : await elementService.getElements(pid(req));

      const target = allElements.find((e: any) => e.elementId === elementId || e._id?.toString() === elementId);
      if (!target) { res.status(404).json({ error: 'Element not found' }); return; }

      const explanation = await aiService.explainElement(target, allElements);
      res.json({ elementId, explanation });
    } catch (err) { next(err); }
  }

  // ── Suggest next element (Tab ghost) ─────────────────────────────────────
  async suggestNext(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { lastElementId, elements: clientElements = [] } = req.body as any;
      if (!lastElementId) { res.status(400).json({ error: 'lastElementId is required' }); return; }

      const allElements = clientElements.length > 0
        ? clientElements
        : await elementService.getElements(pid(req));

      const lastElement = allElements.find((e: any) => e.elementId === lastElementId || e._id?.toString() === lastElementId);
      if (!lastElement) { res.status(404).json({ error: 'Element not found' }); return; }

      const suggestion = await aiService.suggestNextElement(lastElement, allElements);
      res.json({ suggestion });
    } catch (err) { next(err); }
  }

  async summarize(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const elements = await elementService.getElements(pid(req));
      const canvas = await CanvasModel.findById(pid(req)).select('title').lean();
      const summary = await aiService.summarize(elements, canvas?.title ?? 'Canvas');
      res.json({ summary });
    } catch (err) { next(err); }
  }

  async summarizeNotesPage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { imageData, pageIndex = 0 } = req.body as { imageData: string; pageIndex: number };
      if (!imageData) {
        res.status(400).json({ error: 'imageData is required' });
        return;
      }
      const canvas = await CanvasModel.findById(pid(req)).select('title pageTranscripts').lean();
      // @ts-ignore - lean() returns plain object, bypass Map wrapper
      const transcript = canvas?.pageTranscripts?.[String(pageIndex)] || '';

      const summary = await aiService.summarizeNotesPage(imageData, transcript, canvas?.title ?? 'Notes');
      res.json({ summary });
    } catch (err) { next(err); }
  }

  async ghostSuggest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { message } = req.body as { message: string };
      const elements = await elementService.getElements(pid(req));
      const suggestions = await aiService.ghostSuggest(elements, message);

      const canvasObjId = new Types.ObjectId(pid(req));
      const ops = suggestions.suggestions.map((s) => ({
        updateOne: {
          filter: { canvasId: canvasObjId, elementId: s.elementId },
          update: {
            $set: { ...s, canvasId: canvasObjId, updatedBy: req.user!._id, isGhostSuggestion: true },
            $setOnInsert: { createdBy: req.user!._id, version: 1 },
          },
          upsert: true,
        },
      }));

      if (ops.length > 0) await CanvasElementModel.bulkWrite(ops as any);
      res.json(suggestions);
    } catch (err) { next(err); }
  }

  async autoLayout(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { algorithm, elementIds } = req.body as { algorithm?: string; elementIds?: string[] };
      let elements = await elementService.getElements(pid(req));
      if (elementIds?.length) elements = elements.filter((e) => elementIds.includes(e.elementId));

      const updates = layoutService.layout(elements, algorithm);
      const canvasObjId = new Types.ObjectId(pid(req));
      const ops = updates.map((u) => ({
        updateOne: {
          filter: { canvasId: canvasObjId, elementId: u.elementId },
          update: { $set: { x: u.x, y: u.y, updatedBy: req.user!._id } },
        },
      }));
      if (ops.length) await CanvasElementModel.bulkWrite(ops as any);
      res.json({ updates, count: updates.length });
    } catch (err) { next(err); }
  }

  async codeToDiagram(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, language, diagramType } = req.body as any;
      const result = await aiService.diagramFromCode(code, language, diagramType ?? 'auto');
      res.json(result);
    } catch (err) { next(err); }
  }

  async diagramToCode(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { language, elementIds } = req.body as any;
      let elements = await elementService.getElements(pid(req));
      if (elementIds?.length) elements = elements.filter((e: any) => elementIds.includes(e.elementId));
      const result = await aiService.codeFromDiagram(elements, language ?? 'typescript');
      res.json(result);
    } catch (err) { next(err); }
  }

  async acceptGhosts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { elementIds } = req.body as { elementIds: string[] };
      await elementService.acceptGhostElements(new Types.ObjectId(pid(req)), elementIds, req.user!._id);
      res.json({ message: 'Ghost elements accepted', count: elementIds.length });
    } catch (err) { next(err); }
  }

  async dismissGhosts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      await elementService.dismissGhosts(new Types.ObjectId(pid(req)), req.user!._id);
      res.json({ message: 'All ghost suggestions dismissed' });
    } catch (err) { next(err); }
  }

  async providers(_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ available: getAvailableProviders() });
    } catch (err) { next(err); }
  }
}

export const aiController = new AIController();
