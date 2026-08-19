import { InvalidCursor } from '../../../application/errors.js';

export interface Keyset {
  readonly createdAt: Date;
  readonly id: string;
}

export function encodeCursor(k: Keyset): string {
  return Buffer.from(`${k.createdAt.toISOString()}|${k.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Keyset {
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const createdAt = iso ? new Date(iso) : new Date(NaN);
  if (!id || Number.isNaN(createdAt.getTime())) throw new InvalidCursor(raw);
  return { createdAt, id };
}
