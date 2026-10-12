import { normalizeName, type SourceKind } from '@cortex/core';
import { all, tx } from './db.ts';
import * as repo from './repo.ts';
import { chunkText, windows } from './ingest/chunk.ts';
import { fetchSource } from './ingest/fetch.ts';
import { aiEnabled, extract, surveyGaps, writePrimer, type ExtractionT } from './ai/claude.ts';
import { extractOffline, gapsOffline } from './ai/offline.ts';
import { invalidateIndex } from './search.ts';

// One source develops at a time; the queue keeps API usage predictable.
const queue: number[] = [];
let busy = false;

export function enqueue(sourceId: number) {
  queue.push(sourceId);
  void drain();
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await develop(id);
      } catch (e) {
        repo.setSourceStatus(id, 'failed', e instanceof Error ? e.message : String(e));
        console.error(`[develop] ${id}`, e);
      }
    }
  } finally {
    busy = false;
  }
}

/** On boot, anything left mid-development is re-queued. */
export function resumePending() {
  for (const s of repo.listSources()) if (s.status === 'queued' || s.status === 'developing') enqueue(s.id);
}

export async function develop(sourceId: number) {
  const row = repo.sourceRaw(sourceId);
  if (!row) return;
  repo.setSourceStatus(sourceId, 'developing');

  let title: string = row.title;
  let text: string | null = row.raw_text;
  if (!text) {
    const fetched = await fetchSource(row.kind as SourceKind, row.url);
    title = fetched.title;
    text = fetched.text;
    repo.updateSourceText(sourceId, title, text);
  }

  const passages = chunkText(text);
  if (passages.length === 0) throw new Error('The source had no text to read.');
  const chunkIds = repo.insertChunks(sourceId, passages);
  invalidateIndex();

  const vault = repo.listConcepts().map((c) => c.name);
  const results: ExtractionT[] = [];
  for (const w of windows(passages)) {
    results.push(aiEnabled ? await extract(w, title, vault) : extractOffline(w, title, vault));
  }

  tx(() => {
    if (results[0]?.title && row.kind !== 'note' && !row.title.startsWith('Primer:')) {
      repo.updateSourceText(sourceId, results[0].title.slice(0, 160), text!);
    }
    const ids = new Map<string, number>();
    for (const r of results) {
      for (const c of r.concepts) {
        const [id] = repo.upsertConcept(c, sourceId);
        ids.set(normalizeName(c.name), id);
        for (const a of c.aliases) ids.set(normalizeName(a), id);
      }
    }
    const resolve = (name: string) => ids.get(normalizeName(name)) ?? repo.findConceptByName(name)?.id;

    for (const r of results) {
      for (const rel of r.relations) {
        const a = resolve(rel.from);
        const b = resolve(rel.to);
        if (a && b) repo.addEdge(a, b, rel.type);
      }
      for (const card of r.cards) {
        const cid = resolve(card.concept);
        if (!cid) continue;
        repo.addCard(cid, {
          kind: card.kind,
          prompt: card.prompt,
          answer: card.answer,
          options: card.kind === 'mcq' ? card.options : null,
        });
      }
    }

    // link every concept named in a passage to that passage, for citations
    const touched = new Set(ids.values());
    const concepts = repo.listConcepts();
    passages.forEach((p, i) => {
      const lower = p.toLowerCase();
      for (const c of concepts) {
        const names = [c.name, ...c.aliases].filter((n) => n.length > 2);
        if (names.some((n) => lower.includes(n.toLowerCase()))) repo.addMention(c.id, chunkIds[i]);
      }
    });
    for (const id of touched) {
      if (!repo.passagesFor(id, 1).length) repo.addMention(id, chunkIds[0]);
    }
  });

  repo.setSourceStatus(sourceId, 'fixed');
}

export function accession(kind: SourceKind, title: string, url: string | null, text: string | null): number {
  const id = repo.createSource(kind, title, url, text);
  enqueue(id);
  return id;
}

// ── gaps ───────────────────────────────────────────────────────────────────

export async function runGapSurvey(): Promise<number> {
  const concepts = repo.listConcepts();
  if (concepts.length < 3) return 0;
  const ret = repo.retentionMap();
  const dismissed = repo.listGaps('dismissed').map((g) => g.name);
  let added = 0;

  if (aiEnabled) {
    const byId = new Map(concepts.map((c) => [c.id, c]));
    const edges = repo.listEdges().map((e) => ({ from: byId.get(e.from)?.name ?? '', to: byId.get(e.to)?.name ?? '', type: e.type }));
    const out = await surveyGaps(
      concepts.map((c) => ({ name: c.name, summary: c.summary, retention: ret.get(c.id) ?? 0 })),
      edges,
      dismissed,
    );
    for (const g of out.gaps) {
      const between = g.between.map((n) => repo.findConceptByName(n)?.id).filter((x): x is number => !!x);
      if (repo.addGap(g.name, g.summary, g.reason, between)) added++;
    }
  } else {
    const known = new Set<string>();
    for (const c of concepts) {
      known.add(normalizeName(c.name));
      for (const a of c.aliases) known.add(normalizeName(a));
    }
    for (const d of dismissed) known.add(normalizeName(d));
    const texts = all(`SELECT id, raw_text FROM sources WHERE raw_text IS NOT NULL`).map((r) => ({ id: r.id as number, text: r.raw_text as string }));
    for (const g of gapsOffline(texts, known)) {
      const near = concepts
        .filter((c) => texts.some((t) => g.sources.has(t.id) && c.sourceIds.includes(t.id)))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 3)
        .map((c) => c.id);
      const reason = `Named in ${g.sources.size} of your sources (${g.count} times) but never catalogued.`;
      if (repo.addGap(g.name, `A term your sources keep using without explaining.`, reason, near)) added++;
    }
  }
  return added;
}

/** Turns a gap into knowledge: writes a primer (with the AI provider) and develops it like any source. */
export async function chartGap(gapId: number): Promise<number | null> {
  const gap = repo.getGap(gapId);
  if (!gap) return null;
  const context = gap.between.map((id) => repo.getConcept(id)?.name).filter((n): n is string => !!n);
  if (aiEnabled) {
    const primer = await writePrimer(gap.name, gap.summary, context);
    repo.setGapStatus(gapId, 'charted');
    return accession('note', `Primer: ${gap.name}`, null, `# ${gap.name}\n\n${primer}`);
  }
  // offline: catalogue the gap as-is, linked to the concepts it bridges
  const [cid] = repo.upsertConcept({ name: gap.name, summary: gap.summary, kind: 'idea', importance: 3, aliases: [] }, null);
  repo.addCard(cid, { kind: 'qa', prompt: `What is ${gap.name}, and how does it connect ${context.join(' and ') || 'to what you know'}?`, answer: gap.summary });
  for (const b of gap.between) repo.addEdge(b, cid, 'related');
  repo.setGapStatus(gapId, 'charted');
  return null;
}
