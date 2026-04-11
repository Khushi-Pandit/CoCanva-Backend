import { ICanvasElement } from '../types/element.types';
import { LayoutElementUpdate } from '../types/ai.types';
import dagre from 'dagre';

export class LayoutService {
  /**
   * Applies Dagre layout to the elements.
   * Algorithm is selected based on diagram semantics or overridden by caller.
   */
  layout(elements: ICanvasElement[], rankdir?: string): LayoutElementUpdate[] {
    const direction = rankdir ?? this.detectBestAlgorithm(elements);
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 80, marginx: 20, marginy: 20 });

    const nodes = elements.filter(
      (e) => ['shape', 'sticky', 'frame', 'text'].includes(e.type) && !e.isDeleted,
    );
    const edges = elements.filter(
      (e) => e.type === 'connector' && e.fromElementId && e.toElementId && !e.isDeleted,
    );

    for (const el of nodes) {
      g.setNode(el.elementId, {
        label: el.label || el.text || el.subtype,
        width: (el.width || 160) + 20,
        height: (el.height || 60) + 20,
      });
    }

    for (const conn of edges) {
      if (conn.fromElementId && conn.toElementId) {
        g.setEdge(conn.fromElementId, conn.toElementId, { label: conn.label });
      }
    }

    try {
      dagre.layout(g);
    } catch {
      return []; // Layout failed — return empty to leave positions unchanged
    }

    const updates: LayoutElementUpdate[] = [];
    for (const el of nodes) {
      const node = g.node(el.elementId);
      if (node) {
        updates.push({
          elementId: el.elementId,
          x: Math.round(node.x - (node.width ?? 80) / 2),
          y: Math.round(node.y - (node.height ?? 30) / 2),
        });
      }
    }

    return updates;
  }

  /**
   * Heuristic: choose layout algorithm based on element distribution.
   * - Diamond shapes → LR (flowchart / decision tree)
   * - Many connectors → TB (hierarchy)
   * - Mostly shapes without connectors → circular-ish
   */
  private detectBestAlgorithm(elements: ICanvasElement[]): string {
    const diamonds = elements.filter((e) => e.subtype === 'diamond').length;
    const connectors = elements.filter((e) => e.type === 'connector').length;
    const shapes = elements.filter((e) => e.type === 'shape').length;

    if (diamonds > 2 && connectors > 3) return 'LR'; // flowchart
    if (connectors > shapes / 2) return 'TB';         // hierarchy
    return 'TB';
  }
}

export const layoutService = new LayoutService();
