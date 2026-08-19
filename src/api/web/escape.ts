const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** Every interpolation in every template goes through this. Titles and notes are user input. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]!);
}

/** For attribute values built from user data (ids, cursors). */
export function attr(value: unknown): string {
  return esc(value);
}
