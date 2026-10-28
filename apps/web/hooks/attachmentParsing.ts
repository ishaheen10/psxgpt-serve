import type { DataAttachment } from '../types';

export function parseAttachments(value: unknown): DataAttachment[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as DataAttachment[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
