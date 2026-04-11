import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ICanvasElement } from '../types/element.types';
import {
  GhostSuggestResponse,
  LayoutElementUpdate,
  CodeDiagramResponse,
  DiagramCodeResponse,
} from '../types/ai.types';
import { v4 as uuidv4 } from 'uuid';
import dagre from 'dagre';
import { Socket } from 'socket.io';
import {
  pickProvider,
  streamChat as providerStreamChat,
  complete,
  completeJSON,
  getAvailableProviders,
  logProviderStatus,
} from './ai.providers';

// Log available providers at module load
logProviderStatus();

// ── Agent Action Types ─────────────────────────────────────────────────────────
export interface AIGeneratedElement {
  elementId: string;
  kind: 'flowchart' | 'shape' | 'text';
  shapeType?: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  text?: string;
  color: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
  rotation: number;
  fontSize?: number;
  fontFamily?: string;
  fromId?: string;
  toId?: string;
  dashed?: boolean;
  arrowEnd?: boolean;
  isGhostSuggestion: true;
  aiConfidence: number;
}

export type AIAction =
  | { type: 'add_elements'; elements: AIGeneratedElement[] }
  | { type: 'modify_elements'; updates: { elementId: string; patch: Record<string, unknown> }[] }
  | { type: 'delete_elements'; elementIds: string[] }
  | { type: 'explain'; elementId: string; explanation: string }
  | { type: 'suggest_next'; element: AIGeneratedElement };

export interface AgentChatResponse {
  message: string;
  actions: AIAction[];
  modelUsed: string;
}

export class AIService {
  // ── Canvas context builder ─────────────────────────────────────────────────

  buildCanvasContext(elements: ICanvasElement[]): string {
    const shapes    = elements.filter((e) => e.type === 'shape');
    const texts     = elements.filter((e) => e.type === 'text');
    const connectors = elements.filter((e) => e.type === 'connector');
    const stickies  = elements.filter((e) => e.type === 'sticky');

    const connDesc = connectors.map((c) => {
      const from = elements.find((e) => e.elementId === c.fromElementId);
      const to   = elements.find((e) => e.elementId === c.toElementId);
      return `"${from?.label || from?.subtype || '?'}" → "${to?.label || to?.subtype || '?'}"${c.label ? ` (${c.label})` : ''}`;
    });

    return [
      `Canvas contains ${elements.length} elements.`,
      `Shapes: ${shapes.map((s) => `${s.subtype}("${s.label || ''}")`).join(', ')}`,
      connDesc.length ? `Connections: ${connDesc.join('; ')}` : 'No connections.',
      `Text blocks: ${texts.map((t) => `"${(t.text ?? '').slice(0, 80)}"`).join(', ')}`,
      `Stickies: ${stickies.map((s) => `"${(s.text ?? '').slice(0, 60)}"`).join(', ')}`,
    ].join('\n');
  }

  /** Compact serialization for agent prompts — avoids large token counts */
  private buildCompactElements(elements: ICanvasElement[], selectedIds?: string[]): string {
    const selected = selectedIds?.length
      ? elements.filter(e => selectedIds.includes(e.elementId))
      : [];
    const others = elements.filter(e => !selectedIds?.includes(e.elementId)).slice(0, 40);
    const toDesc = (e: ICanvasElement) =>
      `{id:"${e.elementId}",type:"${e.type}",sub:"${e.subtype}",x:${Math.round(e.x)},y:${Math.round(e.y)},w:${Math.round(e.width)},h:${Math.round(e.height)},label:"${(e.label || e.text || '').slice(0, 40)}"}`;
    return [
      selected.length ? `SELECTED (${selected.length}): ${selected.map(toDesc).join(', ')}` : '',
      `ALL (${others.length}): ${others.map(toDesc).join(', ')}`,
    ].filter(Boolean).join('\n');
  }

  // ── Agent Chat ─────────────────────────────────────────────────────────────
  /**
   * Main agent entrypoint. The AI sees the full canvas and returns structured
   * actions (add/modify/delete elements) alongside a human-readable message.
   * This enables "Draw a login flow" to actually generate shapes on the canvas.
   */
  async agentChat(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    elements: ICanvasElement[],
    selectedIds: string[] = [],
    requestedModel = 'auto',
  ): Promise<AgentChatResponse> {
    const available = getAvailableProviders();
    if (available.length === 0) {
      return { message: 'No AI providers configured. Please add at least one API key.', actions: [], modelUsed: 'none' };
    }

    const provider = pickProvider('agent', requestedModel);
    const compactElements = this.buildCompactElements(elements, selectedIds);
    const maxY = elements.reduce((m, e) => Math.max(m, e.y + (e.height ?? 60)), 0);
    const originY = maxY > 0 ? maxY + 80 : 100;
    const originX = 100;

    const systemPrompt = `You are DrawSync AI Agent — an intelligent creative partner embedded in a collaborative canvas tool.
You can SEE and MODIFY the canvas. Your job is to help users design, draw, and build diagrams.

CURRENT CANVAS STATE:
${compactElements || 'Canvas is empty.'}

PLACEMENT HINT: Place new elements starting around x=${originX}, y=${originY}. Space shapes 80-120px apart vertically. Auto-connect sequential flow shapes with connectors.

AVAILABLE SHAPE TYPES:
- kind:"flowchart" shapeType: rectangle, diamond, rounded_rect, parallelogram, cylinder, hexagon, oval, cloud, cross
- kind:"shape" type: rectangle, circle, triangle, diamond, line, arrow, star
- kind:"text" for standalone text labels

CONNECTOR SHAPE: kind:"flowchart", shapeType:"connector", requires fromId and toId pointing to other elementIds

COLOR PALETTE:
- Process/rectangle: color:"#2563eb" fillColor:"#dbeafe"
- Decision/diamond: color:"#d97706" fillColor:"#fef3c7"
- Start/End rounded_rect: color:"#059669" fillColor:"#d1fae5"
- Database/cylinder: color:"#0891b2" fillColor:"#cffafe"
- I/O parallelogram: color:"#7c3aed" fillColor:"#ede9fe"
- Connector: color:"#6b7280" fillColor:"transparent"

RESPONSE FORMAT — return ONLY this JSON, no markdown fences, no extra text:
{
  "message": "Human-readable explanation of what you did",
  "actions": [
    {
      "type": "add_elements",
      "elements": [
        {
          "elementId": "<uuid>",
          "kind": "flowchart",
          "shapeType": "rounded_rect",
          "x": 100, "y": 100, "width": 160, "height": 56,
          "label": "Start",
          "color": "#059669", "fillColor": "#d1fae5",
          "strokeWidth": 2, "opacity": 1, "rotation": 0,
          "fontSize": 13, "fontFamily": "Inter, sans-serif",
          "isGhostSuggestion": true, "aiConfidence": 0.95
        }
      ]
    }
  ]
}

RULES:
1. Draw/create/generate requests → use add_elements with proper shapes AND connectors between sequential steps
2. Modify/change requests → use modify_elements with elementId + patch
3. Delete/remove requests → use delete_elements with elementIds
4. Questions/explanations → empty actions array, answer in message
5. Flowchart conventions: rounded_rect=Start/End, diamond=Decision, rectangle=Process, parallelogram=I/O, cylinder=Database
6. Always add connectors between sequential flow steps (shapeType:"connector" with fromId/toId)
7. Stack vertically: increment Y by 120px per step, same X column
8. Return ONLY valid JSON — no text before {, no text after }`;

    const historyStr = history.slice(-6).map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n');
    const fullPrompt = historyStr
      ? `${systemPrompt}\n\nCONVERSATION HISTORY:\n${historyStr}\n\nUSER: ${message}`
      : `${systemPrompt}\n\nUSER: ${message}`;

    try {
      const result = await completeJSON<AgentChatResponse>(provider, fullPrompt, 6000);

      // Normalize all added elements — ensure valid IDs and ghost flag
      result.actions = (result.actions ?? []).map(action => {
        if (action.type === 'add_elements') {
          action.elements = action.elements.map(el => ({
            ...el,
            elementId: el.elementId || uuidv4(),
            isGhostSuggestion: true as const,
            aiConfidence: el.aiConfidence ?? 0.9,
            strokeWidth: el.strokeWidth ?? 2,
            opacity: el.opacity ?? 1,
            rotation: el.rotation ?? 0,
            color: el.color ?? '#2563eb',
            fillColor: el.fillColor ?? '#dbeafe',
          }));
        }
        return action;
      });

      logger.info('Agent chat', { provider, actions: result.actions.length, types: result.actions.map(a => a.type) });
      return { ...result, modelUsed: provider };
    } catch (err) {
      logger.error('Agent chat failed', { error: (err as Error).message, provider });
      return { message: 'I encountered an error processing your request. Please try again.', actions: [], modelUsed: provider };
    }
  }

  // ── Explain a specific element ─────────────────────────────────────────────
  async explainElement(
    element: ICanvasElement,
    allElements: ICanvasElement[],
  ): Promise<string> {
    const available = getAvailableProviders();
    if (available.length === 0) return 'No AI providers configured.';
    const provider = pickProvider('explain');

    const connectedFrom = allElements.filter(e => e.toElementId === element.elementId);
    const connectedTo   = allElements.filter(e => e.fromElementId === element.elementId);
    const context = [
      connectedFrom.length ? `Receives from: ${connectedFrom.map(e => e.label || e.subtype).join(', ')}` : '',
      connectedTo.length   ? `Connects to: ${connectedTo.map(e => e.label || e.subtype).join(', ')}`   : '',
    ].filter(Boolean).join('. ');

    const prompt = `Explain in 1-2 sentences what this diagram element likely represents.
Element: type=${element.type}, shape=${element.subtype}, label="${element.label || element.text || '(no label)'}"
${context ? `Context: ${context}` : ''}
Be concise and avoid markdown.`;

    return await complete(provider, prompt, 300);
  }

  // ── Suggest next element (Tab ghost) ──────────────────────────────────────
  async suggestNextElement(
    lastElement: ICanvasElement,
    allElements: ICanvasElement[],
  ): Promise<AIGeneratedElement | null> {
    const available = getAvailableProviders();
    if (available.length === 0) return null;
    const provider = pickProvider('suggest_next');

    const compactAll = allElements.slice(0, 20).map(e =>
      `{type:"${e.type}",sub:"${e.subtype}",label:"${(e.label || e.text || '').slice(0, 30)}"}`
    ).join(', ');

    const nextY = lastElement.y + (lastElement.height ?? 60) + 80;
    const newId = uuidv4();

    const prompt = `Predict the single most likely next diagram element.

Last placed: type="${lastElement.type}" shape="${lastElement.subtype}" label="${lastElement.label || lastElement.text || ''}" x=${Math.round(lastElement.x)} y=${Math.round(lastElement.y)}
All elements: ${compactAll || 'just this one'}

Return ONLY a JSON object (no markdown):
{"elementId":"${newId}","kind":"flowchart","shapeType":"rectangle","x":${Math.round(lastElement.x)},"y":${nextY},"width":160,"height":56,"label":"Next Step","color":"#2563eb","fillColor":"#dbeafe","strokeWidth":2,"opacity":1,"rotation":0,"fontSize":13,"fontFamily":"Inter, sans-serif","isGhostSuggestion":true,"aiConfidence":0.82}`;

    try {
      const result = await completeJSON<AIGeneratedElement>(provider, prompt, 512);
      result.elementId = result.elementId || uuidv4();
      result.isGhostSuggestion = true;
      return result;
    } catch {
      return null;
    }
  }

  // ── Chat with streaming ────────────────────────────────────────────────────
  async chatStream(
    socket: Socket,
    requestId: string,
    canvasId: string,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    canvasContext: string,
    requestedModel = 'auto',
  ): Promise<void> {
    const available = getAvailableProviders();
    if (available.length === 0) {
      socket.emit('ai:error', { requestId, error: 'No AI providers configured. Add at least one API key.' });
      return;
    }
    const provider = pickProvider('chat', requestedModel);
    const systemPrompt = `You are DrawSync AI, an intelligent assistant embedded in a collaborative canvas platform.
Canvas state: ${canvasContext}
Be concise, precise, and helpful. When suggesting diagram changes, describe them clearly.`;
    logger.info('AI chat stream', { provider, requestedModel, canvasId });
    await providerStreamChat(socket, requestId, canvasId, provider, systemPrompt, history, message);
  }

  // ── Ghost AI Collaborator ─────────────────────────────────────────────────
  async ghostSuggest(elements: ICanvasElement[], message: string): Promise<GhostSuggestResponse> {
    const available = getAvailableProviders();
    if (available.length === 0) return { suggestions: [], summary: 'No AI providers configured.' };

    const provider = pickProvider('ghost');
    const sanitized = elements.slice(0, 50).map((e) => ({
      elementId: e.elementId, type: e.type, subtype: e.subtype,
      x: e.x, y: e.y, width: e.width, height: e.height,
      label: e.label, text: e.text?.slice(0, 100),
      fromElementId: e.fromElementId, toElementId: e.toElementId,
    }));

    const prompt = `You are a diagram assistant. Current canvas elements:\n${JSON.stringify(sanitized, null, 2)}\n\nUser says: "${message}"\n\nRespond ONLY with JSON:\n{"suggestions":[{"elementId":"<uuid>","type":"shape","subtype":"rectangle","x":200,"y":300,"width":160,"height":60,"label":"Label","fillColor":"#E3F2FD","strokeColor":"#1565C0","fromElementId":null,"toElementId":null,"confidence":0.9,"reasoning":"Why"}],"summary":"Summary"}`;

    try {
      const text = await complete(provider, prompt, 2048);
      const cleaned = text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(cleaned) as GhostSuggestResponse;
      parsed.suggestions = (parsed.suggestions ?? []).map((s: any) => ({
        ...s,
        elementId: s.elementId ?? uuidv4(),
        isGhostSuggestion: true as const,
        aiConfidence: s.confidence ?? 0.8,
        aiReasoning: s.reasoning ?? '',
      }));
      return parsed;
    } catch {
      return { suggestions: [], summary: 'AI could not generate suggestions at this time.' };
    }
  }

  // ── Canvas Summarize ───────────────────────────────────────────────────────
  async summarize(elements: ICanvasElement[], title: string): Promise<string> {
    const available = getAvailableProviders();
    if (available.length === 0) return 'No AI providers configured.';
    const provider = pickProvider('summarize');
    const context = this.buildCanvasContext(elements);
    return await complete(provider, `Summarize this canvas titled "${title}".\n${context}\n\nProvide a 2-3 paragraph summary.`, 500);
  }

  // ── Code → Diagram ────────────────────────────────────────────────────────
  async codeFromDiagram(elements: ICanvasElement[], language: string): Promise<DiagramCodeResponse> {
    const available = getAvailableProviders();
    if (available.length === 0) return { code: '', language, mermaid: '' };
    const provider = pickProvider('code');
    const context = this.buildCanvasContext(elements);
    try {
      return await completeJSON<DiagramCodeResponse>(provider, `Convert this canvas diagram to ${language} code. Canvas: ${context}\nReturn JSON: {"code":"<code>","language":"${language}","mermaid":"<mermaid>"}`, 3000);
    } catch { return { code: '', language, mermaid: '' }; }
  }

  // ── Diagram → Code ───────────────────────────────────────────────────────
  async diagramFromCode(code: string, language: string, diagramType: string): Promise<CodeDiagramResponse> {
    const available = getAvailableProviders();
    if (available.length === 0) return { elements: [], summary: 'No AI providers configured.' };
    const provider = pickProvider('diagram');
    const prompt = `Convert this ${language} code into canvas diagram elements. Diagram type: ${diagramType || 'auto'}\n\`\`\`${language}\n${code.slice(0, 4000)}\n\`\`\`\nReturn JSON: {"elements":[{"elementId":"<uuid>","type":"shape","subtype":"rectangle","x":100,"y":100,"width":160,"height":60,"label":"Name","fillColor":"#E8F5E9"}],"summary":"What was generated"}`;
    try {
      const result = await completeJSON<CodeDiagramResponse>(provider, prompt, 4000);
      result.elements = (result.elements ?? []).map((e: any) => ({ ...e, elementId: e.elementId ?? uuidv4(), version: 1, isDeleted: false, isGhostSuggestion: false }));
      return result;
    } catch { return { elements: [], summary: 'Could not parse diagram from code.' }; }
  }

  // ── Auto Layout ───────────────────────────────────────────────────────────
  autoLayout(elements: ICanvasElement[], algorithm = 'TB'): LayoutElementUpdate[] {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: algorithm, nodesep: 40, ranksep: 60 });

    const shapes = elements.filter((e) => e.type === 'shape' || e.type === 'sticky' || e.type === 'frame');
    const connectors = elements.filter((e) => e.type === 'connector');

    for (const el of shapes) g.setNode(el.elementId, { width: el.width || 160, height: el.height || 60, label: el.label });
    for (const conn of connectors) {
      if (conn.fromElementId && conn.toElementId) g.setEdge(conn.fromElementId, conn.toElementId);
    }
    dagre.layout(g);

    const updates: LayoutElementUpdate[] = [];
    for (const el of shapes) {
      const node = g.node(el.elementId);
      if (node) updates.push({ elementId: el.elementId, x: node.x - (node.width ?? 80) / 2, y: node.y - (node.height ?? 30) / 2 });
    }
    return updates;
  }

  // ── Annotation resolution suggestion ──────────────────────────────────────
  async suggestAnnotationResolution(annotationText: string, threadContext: string): Promise<string> {
    const available = getAvailableProviders();
    if (available.length === 0) return 'No AI providers configured.';
    const provider = pickProvider('annotation');
    return await complete(provider, `Canvas annotation thread:\nContext: ${threadContext}\nComment: ${annotationText}\nSuggest a brief resolution (2-3 sentences max).`, 300);
  }

  getAvailable() { return getAvailableProviders(); }
}

export const aiService = new AIService();
