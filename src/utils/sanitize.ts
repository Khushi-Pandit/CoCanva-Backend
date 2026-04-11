import { CANVAS_ELEMENT_ALLOWED_FIELDS } from '../types/element.types';

/**
 * Strips any top-level fields from an element object that are not in the
 * allowed-fields set. Prevents NoSQL injection and prototype pollution.
 */
export function sanitizeElement(raw: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of CANVAS_ELEMENT_ALLOWED_FIELDS) {
    if (key in raw) {
      clean[key] = raw[key];
    }
  }
  return clean;
}

/**
 * Sanitize an array of elements.
 */
export function sanitizeElements(
  raws: Record<string, unknown>[],
): Record<string, unknown>[] {
  return raws.map((r) => sanitizeElement(r));
}

/**
 * Remove MongoDB operator keys ($where, $expr, etc.) from arbitrary query
 * objects to prevent injection.
 */
export function sanitizeMongoFilter(
  filter: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (!key.startsWith('$')) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Truncate a string to a safe length.
 */
export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) : str;
}

/**
 * Normalise a tag: lowercase, trim, replace spaces with hyphens, max 50 chars.
 */
export function normaliseTag(tag: string): string {
  return tag.toLowerCase().trim().replace(/\s+/g, '-').slice(0, 50);
}
