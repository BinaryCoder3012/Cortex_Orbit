export const catalogNo = (id: number) => `CO-${String(id).padStart(4, '0')}`;
export const accessionNo = (id: number) => `ACC-${String(id).padStart(4, '0')}`;

/** Folds case, punctuation, plurals and ".js" so "React Hooks" and "react hook" collide. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\.js\b/g, 'js')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

export function pct(r: number): string {
  return `${Math.round(r * 100)}%`;
}
