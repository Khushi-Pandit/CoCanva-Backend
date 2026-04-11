import { ICanvasElement } from '../types/element.types';

export class CodegenService {
  /**
   * Converts diagram elements to Mermaid syntax.
   */
  toMermaid(elements: ICanvasElement[]): string {
    const shapes = elements.filter((e) => e.type === 'shape' && !e.isDeleted);
    const connectors = elements.filter((e) => e.type === 'connector' && !e.isDeleted);

    const mermaidNodes = shapes.map((el) => {
      const id = el.elementId.replace(/-/g, '_');
      const label = (el.label || el.elementId).replace(/"/g, "'");
      switch (el.subtype) {
        case 'diamond': return `  ${id}{${label}}`;
        case 'ellipse':
        case 'circle': return `  ${id}((${label}))`;
        case 'rectangle':
        case 'rounded-rectangle': return `  ${id}[${label}]`;
        default: return `  ${id}[${label}]`;
      }
    });

    const mermaidEdges = connectors.map((el) => {
      const from = el.fromElementId?.replace(/-/g, '_') ?? '';
      const to = el.toElementId?.replace(/-/g, '_') ?? '';
      const label = el.label ? `|${el.label}|` : '';
      const arrow = el.dashed ? '-.->' : '-->';
      return `  ${from} ${arrow}${label} ${to}`;
    });

    return `flowchart TB\n${[...mermaidNodes, ...mermaidEdges].join('\n')}`;
  }

  /**
   * Converts diagram elements to PlantUML syntax.
   */
  toPlantUML(elements: ICanvasElement[]): string {
    const shapes = elements.filter((e) => e.type === 'shape' && !e.isDeleted);
    const connectors = elements.filter((e) => e.type === 'connector' && !e.isDeleted);

    const nodes = shapes.map((el) => {
      const label = el.label || el.elementId;
      switch (el.subtype) {
        case 'diamond': return `diamond ${el.elementId} as "${label}"`;
        case 'ellipse': return `usecase ${el.elementId} as "${label}"`;
        default: return `rectangle ${el.elementId} as "${label}"`;
      }
    });

    const edges = connectors.map((el) => {
      const arrow = el.dashed ? '..>' : '-->';
      const label = el.label ? ` : ${el.label}` : '';
      return `${el.fromElementId} ${arrow} ${el.toElementId}${label}`;
    });

    return `@startuml\n${[...nodes, ...edges].join('\n')}\n@enduml`;
  }

  /**
   * Parses a Mermaid flowchart string into raw element data.
   * Supports basic flowchart TD/LR syntax.
   */
  parseMermaid(mermaid: string): Array<Record<string, unknown>> {
    const elements: Array<Record<string, unknown>> = [];
    const nodeRegex = /^\s*(\w+)([({[<]+)([^)\]}>]+)[)\]}>]+/;
    const edgeRegex = /^\s*(\w+)\s*(-->|-.->|--[^>]*>|\.\.>)\|?([^|]*)\|?\s*(\w+)/;

    const lines = mermaid.split('\n');
    const nodePos = new Map<string, { x: number; y: number }>();
    let xOff = 100, yOff = 100;

    for (const line of lines) {
      const nodeMatch = line.match(nodeRegex);
      if (nodeMatch) {
        const [, id, open, label] = nodeMatch;
        const subtype =
          open.startsWith('{') ? 'diamond' :
          open.startsWith('(') ? 'ellipse' : 'rectangle';
        nodePos.set(id, { x: xOff, y: yOff });
        elements.push({
          elementId: id,
          type: 'shape', subtype,
          label: label.trim(),
          x: xOff, y: yOff,
          width: 160, height: 60,
          fillColor: '#f3f4f6', strokeColor: '#6366f1',
        });
        xOff += 200;
        if (xOff > 1000) { xOff = 100; yOff += 120; }
      }

      const edgeMatch = line.match(edgeRegex);
      if (edgeMatch) {
        const [, from, arrowType, edgeLabel, to] = edgeMatch;
        elements.push({
          elementId: `conn-${from}-${to}`,
          type: 'connector', subtype: 'curved',
          fromElementId: from, toElementId: to,
          label: edgeLabel?.trim() ?? '',
          dashed: arrowType.includes('.'),
        });
      }
    }

    return elements;
  }
}

export const codegenService = new CodegenService();
