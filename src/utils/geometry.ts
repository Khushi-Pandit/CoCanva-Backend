import { Point } from '../types/element.types';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export function distance(a: Point, b: Point): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function boundingBoxFromPoints(points: Point[]): BoundingBox {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Ramer-Douglas-Peucker stroke simplification.
 * Reduces point count by ~60-80% with imperceptible quality loss.
 */
export function simplifyStroke(points: Point[], tolerance = 1.5): Point[] {
  if (points.length <= 2) return points;

  const sqTolerance = tolerance * tolerance;

  function getSqDist(p: Point, a: Point, b: Point): number {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { dx = p.x - b.x; dy = p.y - b.y; }
      else if (t > 0) { dx = p.x - (a.x + dx * t); dy = p.y - (a.y + dy * t); }
      else { dx = p.x - a.x; dy = p.y - a.y; }
    } else {
      dx = p.x - a.x;
      dy = p.y - a.y;
    }
    return dx * dx + dy * dy;
  }

  function rdp(pts: Point[], first: number, last: number, simplified: Point[]): void {
    let maxSqDist = sqTolerance;
    let idx = 0;
    for (let i = first + 1; i < last; i++) {
      const d = getSqDist(pts[i], pts[first], pts[last]);
      if (d > maxSqDist) { maxSqDist = d; idx = i; }
    }
    if (maxSqDist > sqTolerance) {
      if (idx - first > 1) rdp(pts, first, idx, simplified);
      simplified.push(pts[idx]);
      if (last - idx > 1) rdp(pts, idx, last, simplified);
    }
  }

  const simplified: Point[] = [points[0]];
  rdp(points, 0, points.length - 1, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Returns centre point of a bounding rect (x, y, width, height).
 */
export function rectCenter(x: number, y: number, w: number, h: number): Point {
  return { x: x + w / 2, y: y + h / 2 };
}
