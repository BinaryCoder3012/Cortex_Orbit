import { allChunks } from './repo.ts';

// Okapi BM25 over every stored passage. Small vaults (tens of thousands of
// passages) fit comfortably in memory; the index rebuilds lazily after ingest.

const STOP = new Set(
  'a an and are as at be but by for from has have how i if in into is it its of on or that the their them then there these this to was were what when where which who why will with you your can do does not no so than too very just about also more most other some such only own same should now'.split(' '),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+#\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// a deliberately light stemmer: enough to fold plurals and -ing/-ed forms
function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

interface Doc {
  id: number;
  sourceId: number;
  text: string;
  tf: Map<string, number>;
  len: number;
}

let index: { docs: Doc[]; df: Map<string, number>; avg: number } | null = null;

export function invalidateIndex() {
  index = null;
}

function build() {
  const docs: Doc[] = allChunks().map((c) => {
    const toks = tokenize(c.text);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { id: c.id, sourceId: c.sourceId, text: c.text, tf, len: toks.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  index = { docs, df, avg };
  return index;
}

export interface Hit {
  chunkId: number;
  sourceId: number;
  text: string;
  score: number;
}

export function search(query: string, k = 8): Hit[] {
  const idx = index ?? build();
  const q = [...new Set(tokenize(query))];
  if (q.length === 0 || idx.docs.length === 0) return [];
  const N = idx.docs.length;
  const k1 = 1.4;
  const b = 0.72;
  const hits: Hit[] = [];
  for (const d of idx.docs) {
    let score = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = idx.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / idx.avg)));
    }
    if (score > 0) hits.push({ chunkId: d.id, sourceId: d.sourceId, text: d.text, score });
  }
  hits.sort((a, b2) => b2.score - a.score);
  // keep at most three passages per source so one long PDF cannot drown the rest
  const perSource = new Map<number, number>();
  const out: Hit[] = [];
  for (const h of hits) {
    const n = perSource.get(h.sourceId) ?? 0;
    if (n >= 3) continue;
    perSource.set(h.sourceId, n + 1);
    out.push(h);
    if (out.length >= k) break;
  }
  return out;
}
