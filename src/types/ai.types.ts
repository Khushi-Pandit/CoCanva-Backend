import { ICanvasElement } from './element.types';

export type AIRequestType =
  | 'chat'
  | 'ghost_suggest'
  | 'summarize'
  | 'layout'
  | 'code_to_diagram'
  | 'diagram_to_code'
  | 'annotation_resolve'
  | 'presentation_gen';

export interface AIJobPayload {
  requestId: string;
  canvasId: string;
  userId: string;
  socketId: string;
  type: AIRequestType;
  message: string;
  context?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  elements?: Partial<ICanvasElement>[];
  language?: string;
  algorithm?: string;
  elementIds?: string[];
}

export interface GhostElementSuggestion {
  elementId: string;
  type: string;
  subtype: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  text?: string;
  fillColor?: string;
  strokeColor?: string;
  fromElementId?: string;
  toElementId?: string;
  confidence: number;
  reasoning: string;
  isGhostSuggestion: true;
  aiConfidence: number;
  aiReasoning: string;
}

export interface GhostSuggestResponse {
  suggestions: GhostElementSuggestion[];
  summary: string;
}

export interface LayoutElementUpdate {
  elementId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface CodeDiagramResponse {
  elements: Partial<ICanvasElement>[];
  summary: string;
}

export interface DiagramCodeResponse {
  code: string;
  language: string;
  mermaid?: string;
  plantuml?: string;
}
