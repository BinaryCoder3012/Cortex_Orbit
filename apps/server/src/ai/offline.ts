import { normalizeName } from '@cortex/core';
import type { ExtractionT } from './claude.ts';
import { tokenize } from '../search.ts';

// Heuristic stand-ins for every Claude call, so the vault works with no API
// key. They are honest about being rougher: fewer relations, simpler cards.

const sentencesOf = (text: string) =>
  text
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+(?=[A-Z0-9`"(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 600);

const COMMON_STARTS = new Set(
  'The This That These Those When While If It In On For With A An And But Or So Then Here There What Why How Each Every Some Most Many Also However Because Although After Before During Unlike Like Instead Note See Use Using You We They He She'.split(' '),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function extractOffline(text: string, title: string, vault: string[]): ExtractionT {
  const sentences = sentencesOf(text);
  const score = new Map<string, { name: string; score: number; def?: string }>();
  const bump = (raw: string, by: number, def?: string) => {
    const name = raw.trim().replace(/^(?:A|An|The)\s+/, '').replace(/[.,:;]+$/, '');
    if (name.length < 3 || name.length > 48 || name.split(' ').length > 5) return;
    if (COMMON_STARTS.has(name)) return;
    const key = normalizeName(name);
    if (!key) return;
    const cur = score.get(key) ?? { name, score: 0 };
    cur.score += by;
    if (def && !cur.def) cur.def = def;
    score.set(key, cur);
  };

  // section headings name concepts; the page title (#) usually names the whole source
  for (const m of text.matchAll(/^#{2,4}\s+(.{3,60})$/gm)) bump(m[1], 3);
  for (const m of text.matchAll(/`([^`\n]{2,40})`/g)) bump(m[1], 1.5);
  for (const s of sentences) {
    const def = s.match(/^(?:(?:A|An|The)\s+)?([A-Z][\w+#.-]*(?:\s+(?:[A-Z][\w+#.-]*|of|and))*)\s+(?:is|are|refers to|means|describes)\s+(?:a|an|the|when|how)\b/);
    if (def) bump(def[1], 4, s);
    for (const m of s.matchAll(/(?<=\s)([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Z][\w+#.-]+(?:\s+[A-Z][\w+#.-]+){1,3})/g)) bump(m[1], 1);
  }
  const lower = text.toLowerCase();
  for (const v of vault) {
    const hits = lower.split(v.toLowerCase()).length - 1;
    if (hits >= 2) bump(v, hits);
  }

  const picked = [...score.values()]
    .filter((c) => c.score >= 2.5 || c.def)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);

  const concepts: ExtractionT['concepts'] = [];
  const cards: ExtractionT['cards'] = [];
  for (const c of picked) {
    const re = new RegExp(`\\b${escapeRe(c.name)}\\b`, 'i');
    const mentions = sentences.filter((s) => re.test(s));
    const summary = (c.def ?? mentions[0] ?? '').slice(0, 260);
    if (!summary) continue;
    concepts.push({
      name: c.name,
      summary,
      kind: /^[a-z]+[A-Z]|\(\)|^use[A-Z]/.test(c.name) ? 'tool' : 'idea',
      importance: Math.min(5, Math.max(1, Math.round(c.score / 2))),
      aliases: [],
    });
    cards.push({ concept: c.name, kind: 'qa', prompt: `In your own words: what is ${c.name}?`, answer: summary, options: [] });
    const clozeSrc = mentions.find((s) => s !== summary) ?? (c.def ? undefined : mentions[0]);
    if (clozeSrc) {
      cards.push({ concept: c.name, kind: 'cloze', prompt: clozeSrc.replace(re, '{{' + c.name + '}}'), answer: c.name, options: [] });
    }
  }

  const relations: ExtractionT['relations'] = [];
  const names = concepts.map((c) => c.name);
  for (const s of sentences) {
    const present = names.filter((n) => new RegExp(`\\b${escapeRe(n)}\\b`, 'i').test(s));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const partOf = new RegExp(`${escapeRe(present[i])}[^.]{0,30}\\b(?:type|kind|form|part) of\\b[^.]{0,30}${escapeRe(present[j])}`, 'i').test(s);
        relations.push({ from: present[i], to: present[j], type: partOf ? 'part_of' : 'related' });
      }
    }
  }
  const seen = new Set<string>();
  return {
    title,
    concepts,
    cards,
    relations: relations.filter((r) => {
      const k = `${r.from}|${r.to}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 40),
  };
}

/** Terms that recur across several of your sources but were never catalogued. */
export function gapsOffline(sources: { id: number; text: string }[], known: Set<string>) {
  const where = new Map<string, { name: string; sources: Set<number>; count: number }>();
  for (const s of sources) {
    for (const m of s.text.matchAll(/`([^`\n]{3,32})`|\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g)) {
      const name = (m[1] ?? m[2]).trim();
      if (COMMON_STARTS.has(name.split(' ')[0])) continue;
      const key = normalizeName(name);
      if (!key || known.has(key)) continue;
      const cur = where.get(key) ?? { name, sources: new Set<number>(), count: 0 };
      cur.sources.add(s.id);
      cur.count++;
      where.set(key, cur);
    }
  }
  return [...where.values()]
    .filter((g) => g.sources.size >= 2 || g.count >= 4)
    .sort((a, b) => b.sources.size - a.sources.size || b.count - a.count)
    .slice(0, 8);
}

export function answerOffline(question: string, passages: { n: number; text: string }[]): string {
  const q = new Set(tokenize(question));
  const ranked: { n: number; s: string; score: number }[] = [];
  for (const p of passages) {
    for (const s of sentencesOf(p.text)) {
      const toks = tokenize(s);
      const overlap = toks.filter((t) => q.has(t)).length;
      if (overlap > 0) ranked.push({ n: p.n, s, score: overlap / Math.sqrt(toks.length + 1) });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 4);
  if (top.length === 0) return 'Nothing in your vault speaks to that yet. Accession a source that covers it and ask again.';
  return `Offline mode, so these are the closest lines from your notes rather than a written answer:\n\n${top.map((t) => `${t.s} [${t.n}]`).join('\n\n')}`;
}

export function gradeOffline(explanation: string, summary: string, passages: string[]) {
  const ref = new Set(tokenize(`${summary} ${passages.join(' ')}`));
  const key = new Set(tokenize(summary));
  const mine = new Set(tokenize(explanation));
  const keyHit = [...key].filter((t) => mine.has(t));
  const coverage = key.size ? keyHit.length / key.size : 0;
  const grounded = mine.size ? [...mine].filter((t) => ref.has(t)).length / mine.size : 0;
  const grade = explanation.trim().length < 15 ? 0 : Math.min(5, Math.round(coverage * 4 + grounded * 1.5));
  const missing = [...key].filter((t) => !mine.has(t)).slice(0, 5);
  return {
    grade,
    verdict:
      grade >= 4
        ? 'You covered the key terms from your notes. (Graded offline by word overlap, so judge the reasoning yourself.)'
        : 'Several key terms from your notes are missing. (Graded offline by word overlap; add an API key for real feedback.)',
    missing: missing.map((m) => `mention of "${m}"`),
  };
}
