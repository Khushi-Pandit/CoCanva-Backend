import { Types } from 'mongoose';

export type ElementType =
  | 'stroke'
  | 'shape'
  | 'text'
  | 'image'
  | 'frame'
  | 'connector'
  | 'sticky'
  | 'widget';

export interface Point {
  x: number;
  y: number;
  p?: number; // pressure
  t?: number; // time
}

export interface Shadow {
  blur: number;
  color: string;
  offsetX: number;
  offsetY: number;
}

export type AnchorPosition = 'top' | 'right' | 'bottom' | 'left' | 'center';
export type RoutingAlgorithm = 'orthogonal' | 'curved' | 'straight';
export type ArrowHeadStyle = 'triangle' | 'open' | 'dot' | 'diamond' | 'none';

export interface ICanvasElement {
  _id: Types.ObjectId;
  canvasId: Types.ObjectId;
  elementId: string;         // UUID from client
  type: ElementType;
  subtype: string;
  shapeType: string;
  borderRadius: number;
  pageIndex: number;

  // Spatial
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;

  // Stroke path
  points: Point[];

  // Connector
  fromElementId: string | null;
  toElementId: string | null;
  fromAnchor: AnchorPosition | null;
  toAnchor: AnchorPosition | null;
  fromPoint: Point | null;
  toPoint: Point | null;
  waypoints: Point[];
  controlPoints: Point[];
  routingAlgorithm: RoutingAlgorithm;

  // Text
  text: string;
  label: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  textAlign: string;
  textColor: string;
  lineHeight: number;
  letterSpacing: number;

  // Style
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  opacity: number;
  dashed: boolean;
  dashArray: number[];
  roughness: number;
  roundness: number;
  shadow: Shadow | null;

  // Arrow
  arrowStart: boolean;
  arrowEnd: boolean;
  arrowHeadStyle: ArrowHeadStyle;
  arrowTailStyle: ArrowHeadStyle;

  // Image / Widget
  imageUrl: string | null;
  widgetType: string | null;
  widgetData: Record<string, unknown> | null;

  // Layer
  zIndex: number;
  groupId: string | null;
  frameId: string | null;

  // AI
  isGhostSuggestion: boolean;
  aiConfidence: number;
  aiReasoning: string;
  isFlowchartEl: boolean;

  // State
  isDeleted: boolean;
  isLocked: boolean;
  isPinned: boolean;

  // Audit
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ElementPatch = Partial<Omit<ICanvasElement, '_id' | 'canvasId' | 'elementId' | 'createdBy' | 'createdAt'>>;

export const CANVAS_ELEMENT_ALLOWED_FIELDS = new Set<string>([
  'elementId', 'type', 'subtype', 'shapeType', 'pageIndex', 'x', 'y', 'width', 'height', 'rotation',
  'points', 'fromElementId', 'toElementId', 'fromAnchor', 'toAnchor',
  'fromPoint', 'toPoint', 'waypoints', 'controlPoints', 'routingAlgorithm',
  'text', 'label', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
  'textAlign', 'textColor', 'lineHeight', 'letterSpacing',
  'strokeColor', 'fillColor', 'strokeWidth', 'opacity',
  'dashed', 'dashArray', 'roughness', 'roundness', 'borderRadius', 'shadow',
  'arrowStart', 'arrowEnd', 'arrowHeadStyle', 'arrowTailStyle',
  'imageUrl', 'widgetType', 'widgetData',
  'zIndex', 'groupId', 'frameId',
  'isGhostSuggestion', 'aiConfidence', 'aiReasoning', 'isFlowchartEl',
  'isDeleted', 'isLocked', 'isPinned',
  'updatedBy', 'version',
]);
