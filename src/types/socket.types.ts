import { ICanvasElement } from './element.types';
import { CanvasRole } from './canvas.types';

// ── Client → Server events ────────────────────────────────────────────────────

export interface CanvasJoinPayload {
  canvasId: string;
  shareToken?: string;
}

export interface CanvasSavePayload {
  canvasId: string;
  elements: Partial<ICanvasElement>[];
  deletedIds: string[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface ElementAddPayload {
  canvasId: string;
  element: Partial<ICanvasElement>;
}

export interface ElementUpdatePayload {
  canvasId: string;
  element: Partial<ICanvasElement> & { elementId: string; version?: number };
}

export interface ElementDeletePayload {
  canvasId: string;
  elementIds: string[];
}

export interface ElementsBatchPayload {
  canvasId: string;
  added: Partial<ICanvasElement>[];
  updated: Partial<ICanvasElement>[];
  deletedIds: string[];
}

export interface ElementLockPayload {
  canvasId: string;
  elementId: string;
}

export interface StrokePreviewPayload {
  canvasId: string;
  points: Array<{ x: number; y: number; p?: number }>;
  style: Record<string, unknown>;
}

export interface CursorMovePayload {
  canvasId: string;
  x: number;
  y: number;
}

export interface SelectionUpdatePayload {
  canvasId: string;
  elementIds: string[];
}

export interface ViewportUpdatePayload {
  canvasId: string;
  viewport: { x: number; y: number; zoom: number };
}

export interface AIRequestPayload {
  canvasId: string;
  requestId: string;
  type: 'chat' | 'ghost_suggest' | 'summarize' | 'layout' | 'code_to_diagram' | 'diagram_to_code';
  message: string;
  context?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface VoiceOfferPayload {
  canvasId: string;
  targetSocketId: string;
  sdp: RTCSessionDescriptionInit;
}

export interface VoiceIcePayload {
  canvasId: string;
  targetSocketId: string;
  candidate: RTCIceCandidateInit;
}

// ── Server → Client events ────────────────────────────────────────────────────

export interface PeerState {
  socketId: string;
  userId: string;
  userName: string;
  userColor: string;
  role: CanvasRole;
  cursor: { x: number; y: number } | null;
  selectedIds: string[];
  viewport: { x: number; y: number; zoom: number } | null;
  isMuted?: boolean;
}

export interface VoicePeer extends PeerState {
  isMuted: boolean;
  viewportCenter: { x: number; y: number } | null;
}

// ── Socket data attached to each socket ──────────────────────────────────────

export interface SocketData {
  userId: string;
  userName: string;
  userColor: string;
  fId: string;
  currentCanvasId: string | null;
  role: CanvasRole;
}
