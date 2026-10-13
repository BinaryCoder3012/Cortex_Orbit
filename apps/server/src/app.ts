import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  accessionNo,
  catalogNo,
  conceptRetention,
  daysUntilFade,
  DAY_MS,
  sm2,
  type AtlasPayload,
  type Citation,
  type ConceptDetail,
  type LogPayload,
  type ReviewItem,
  type SourceKind,
} from '@cortex/core';
import { all } from './db.ts';
import * as repo from './repo.ts';
import { accession, chartGap, develop, enqueue, runGapSurvey } from './pipeline.ts';
import { classifyUrl, pdfToText } from './ingest/fetch.ts';
import { search } from './search.ts';
import { aiEnabled, AiError, freshCards, gradeExplanation, MODEL, provider, streamAnswer } from './ai/claude.ts';
import { answerOffline, gradeOffline } from './ai/offline.ts';
import { seed } from './seed.ts';

export const app = new Hono().basePath('/api');

const idParam = (s: string | undefined) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'That id is not a number.');
  return n;
};

class HttpError extends Error {
  constructor(public status: 400 | 404 | 409 | 422 | 502, message: string) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof AiError) return c.json({ error: err.message }, 502);
  console.error(err);
  return c.json({ error: 'Something broke on the server. The log has details.' }, 500);
});

app.get('/health', (c) => c.json({ ai: aiEnabled ? 'online' : 'offline', provider: provider?.label ?? null, model: MODEL }));

// ── atlas ──────────────────────────────────────────────────────────────────

app.get('/atlas', (c) => {
  let concepts = repo.listConcepts();
  if (concepts.length === 0) {
    try {
      seed();
      concepts = repo.listConcepts();
    } catch (e) {
      console.warn('Auto-seed failed:', e);
    }
  }
  const memory = repo.memoryByConcept();
  const payload: AtlasPayload = {
    concepts,
    edges: repo.listEdges(),
    memory: Object.fromEntries(memory),
    gaps: repo.listGaps('open'),
    now: new Date().toISOString(),
  };
  return c.json(payload);
});

app.get('/concepts/:id', (c) => {
  const id = idParam(c.req.param('id'));
  const concept = repo.getConcept(id);
  if (!concept) throw new HttpError(404, 'No concept with that catalogue number.');
  const detail: ConceptDetail = {
    concept,
    cards: repo.cardsFor(id),
    passages: repo.passagesFor(id),
    neighbours: repo.neighbours(id),
    history: repo.historyFor(id),
  };
  return c.json(detail);
});

app.patch('/concepts/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const body = await c.req.json();
  repo.updateConcept(id, body);
  return c.json(repo.getConcept(id));
});

app.delete('/concepts/:id', (c) => {
  repo.deleteConcept(idParam(c.req.param('id')));
  return c.json({ ok: true });
});

app.post('/concepts/:id/merge', async (c) => {
  const id = idParam(c.req.param('id'));
  const { into } = await c.req.json();
  repo.mergeConcepts(id, idParam(String(into)));
  return c.json({ ok: true });
});

app.post('/concepts/:id/cards', async (c) => {
  const id = idParam(c.req.param('id'));
  const concept = repo.getConcept(id);
  if (!concept) throw new HttpError(404, 'No concept with that catalogue number.');
  if (!aiEnabled) throw new HttpError(422, 'Writing new cards needs an AI provider. Add a Claude, Gemini, OpenRouter or Groq key to .env, or run Ollama.');
  const existing = repo.cardsFor(id).map((x) => x.prompt);
  const out = await freshCards(concept.name, concept.summary, repo.passagesFor(id).map((p) => p.text), existing);
  for (const card of out.cards) {
    repo.addCard(id, { kind: card.kind, prompt: card.prompt, answer: card.answer, options: card.kind === 'mcq' ? card.options : null });
  }
  return c.json(repo.cardsFor(id));
});

/** Every prerequisite you would walk through to reach this concept, oldest first. */
app.get('/concepts/:id/route', (c) => {
  const target = idParam(c.req.param('id'));
  const prereqOf = new Map<number, number[]>();
  for (const e of repo.listEdges()) {
    if (e.type !== 'prerequisite') continue;
    prereqOf.set(e.to, [...(prereqOf.get(e.to) ?? []), e.from]);
  }
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (id: number, depth: number) => {
    if (seen.has(id) || depth > 8) return;
    seen.add(id);
    for (const p of prereqOf.get(id) ?? []) visit(p, depth + 1);
    order.push(id);
  };
  visit(target, 0);
  const ret = repo.retentionMap();
  return c.json(
    order.map((id) => {
      const k = repo.getConcept(id)!;
      return { id, catalog: k.catalog, name: k.name, retention: ret.get(id) ?? 0 };
    }),
  );
});

// ── sources ────────────────────────────────────────────────────────────────

app.get('/sources', (c) => c.json(repo.listSources()));

app.get('/sources/:id', (c) => {
  const id = idParam(c.req.param('id'));
  const source = repo.getSource(id);
  if (!source) throw new HttpError(404, 'No source with that accession number.');
  const concepts = repo.listConcepts().filter((k) => k.sourceIds.includes(id));
  return c.json({ source, passages: repo.chunksFor(id), concepts });
});

app.post('/sources', async (c) => {
  const body = (await c.req.json()) as { url?: string; title?: string; text?: string };
  if (body.url) {
    let kind: SourceKind;
    try {
      kind = classifyUrl(body.url);
    } catch {
      throw new HttpError(400, 'That does not look like a web address.');
    }
    const id = accession(kind, body.url, body.url, null);
    return c.json(repo.getSource(id), 201);
  }
  const text = body.text?.trim();
  if (!text || text.length < 40) throw new HttpError(400, 'Paste at least a paragraph so there is something to learn from.');
  const title = body.title?.trim() || text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
  const id = accession('note', title, null, text);
  return c.json(repo.getSource(id), 201);
});

app.post('/sources/upload', async (c) => {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, 'Attach a PDF, Markdown or text file.');
  if (file.size > 25 * 1024 * 1024) throw new HttpError(400, 'That file is larger than 25 MB.');
  const name = file.name.replace(/\.[a-z0-9]+$/i, '');
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const { title, text } = await pdfToText(new Uint8Array(await file.arrayBuffer()), name).catch((e) => {
      throw new HttpError(422, e.message);
    });
    const id = accession('pdf', title, null, text);
    return c.json(repo.getSource(id), 201);
  }
  const text = await file.text();
  const id = accession('note', name, null, text);
  return c.json(repo.getSource(id), 201);
});

app.post('/sources/:id/retry', (c) => {
  const id = idParam(c.req.param('id'));
  repo.setSourceStatus(id, 'queued');
  enqueue(id);
  return c.json(repo.getSource(id));
});

app.delete('/sources/:id', (c) => {
  repo.deleteSource(idParam(c.req.param('id')));
  return c.json({ ok: true });
});

// ── review session ─────────────────────────────────────────────────────────

app.get('/session', (c) => {
  const mode = c.req.query('mode') ?? 'due';
  const limit = Math.min(60, Number(c.req.query('limit') ?? 20));
  const now = new Date();
  const ret = repo.retentionMap(now);
  const concepts = new Map(repo.listConcepts().map((k) => [k.id, k]));
  let cards = repo.allCards();

  if (mode === 'concept') {
    const cid = idParam(c.req.query('concept'));
    cards = cards.filter((x) => x.conceptId === cid);
  } else if (mode === 'fading') {
    cards = cards.filter((x) => (ret.get(x.conceptId) ?? 1) < 0.65);
  } else {
    cards = cards.filter((x) => new Date(x.dueAt) <= now);
  }

  // weakest concepts first; within a concept, the most overdue card first
  cards.sort((a, b) => (ret.get(a.conceptId) ?? 0) - (ret.get(b.conceptId) ?? 0) || a.dueAt.localeCompare(b.dueAt));
  // interleave so one concept does not monopolise the session
  const perConcept = new Map<number, number>();
  const picked: ReviewItem[] = [];
  for (const card of cards) {
    const n = perConcept.get(card.conceptId) ?? 0;
    if (mode !== 'concept' && n >= 2) continue;
    perConcept.set(card.conceptId, n + 1);
    const k = concepts.get(card.conceptId)!;
    picked.push({ card, concept: { id: k.id, catalog: k.catalog, name: k.name, summary: k.summary }, retention: ret.get(k.id) ?? 0 });
    if (picked.length >= limit) break;
  }
  const dueTotal = repo.allCards().filter((x) => new Date(x.dueAt) <= now).length;
  return c.json({ items: picked, dueTotal });
});

app.post('/review', async (c) => {
  const { cardId, grade, mode } = (await c.req.json()) as { cardId: number; grade: number; mode?: string };
  const card = repo.getCard(idParam(String(cardId)));
  if (!card) throw new HttpError(404, 'That card no longer exists.');
  const now = new Date();
  const next = { ...card, ...sm2(card, grade, now) };
  repo.saveCardMemory(next);
  repo.logReview(card.id, card.conceptId, grade, mode ?? 'card', now);
  return c.json(next);
});

app.post('/explain', async (c) => {
  const { conceptId, explanation } = (await c.req.json()) as { conceptId: number; explanation: string };
  const concept = repo.getConcept(idParam(String(conceptId)));
  if (!concept) throw new HttpError(404, 'No concept with that catalogue number.');
  const passages = repo.passagesFor(concept.id).map((p) => p.text);
  const result = aiEnabled
    ? await gradeExplanation(concept.name, concept.summary, passages, explanation)
    : gradeOffline(explanation, concept.summary, passages);
  const grade = Math.max(0, Math.min(5, Math.round(result.grade)));
  const now = new Date();
  // explaining a concept from memory exercises every card on it
  for (const card of repo.cardsFor(concept.id)) repo.saveCardMemory({ ...card, ...sm2(card, grade, now) });
  repo.logReview(null, concept.id, grade, 'explain', now);
  return c.json({ ...result, grade, mode: aiEnabled ? 'online' : 'offline' });
});

// ── gaps ───────────────────────────────────────────────────────────────────

app.get('/gaps', (c) => c.json(repo.listGaps()));

app.post('/gaps/survey', async (c) => c.json({ added: await runGapSurvey(), gaps: repo.listGaps() }));

app.post('/gaps/:id/chart', async (c) => {
  const sourceId = await chartGap(idParam(c.req.param('id')));
  return c.json({ sourceId, gaps: repo.listGaps() });
});

app.post('/gaps/:id/dismiss', (c) => {
  repo.setGapStatus(idParam(c.req.param('id')), 'dismissed');
  return c.json(repo.listGaps());
});

// ── ask the vault ──────────────────────────────────────────────────────────

app.post('/ask', async (c) => {
  const { question, history = [] } = (await c.req.json()) as {
    question: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  };
  if (!question?.trim()) throw new HttpError(400, 'Ask a question first.');
  const hits = search(question, 8);
  const sources = new Map(repo.listSources().map((s) => [s.id, s]));
  const citations: Citation[] = hits.map((h, i) => ({
    n: i + 1,
    sourceId: h.sourceId,
    accession: accessionNo(h.sourceId),
    sourceTitle: sources.get(h.sourceId)?.title ?? 'Untitled',
    chunkId: h.chunkId,
    excerpt: h.text,
  }));
  const concepts = repo.conceptsInChunks(hits.slice(0, 3).map((h) => h.chunkId)).slice(0, 8);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'meta', data: JSON.stringify({ citations, concepts, mode: aiEnabled ? 'online' : 'offline' }) });
    try {
      if (!aiEnabled || hits.length === 0) {
        const text = hits.length === 0
          ? 'Nothing in your vault speaks to that yet. Accession a source that covers it, then ask again.'
          : answerOffline(question, citations.map((x) => ({ n: x.n, text: x.excerpt })));
        await stream.writeSSE({ event: 'text', data: JSON.stringify(text) });
      } else {
        const passages = citations.map((x) => ({ n: x.n, title: x.sourceTitle, text: x.excerpt }));
        for await (const piece of streamAnswer(question, passages, history)) {
          await stream.writeSSE({ event: 'text', data: JSON.stringify(piece) });
        }
      }
    } catch (e) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify(e instanceof Error ? e.message : 'The answer failed.') });
    }
    await stream.writeSSE({ event: 'done', data: '{}' });
  });
});

app.get('/search', (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  if (!q) return c.json({ concepts: [], passages: [] });
  const concepts = repo
    .listConcepts()
    .filter((k) => k.name.toLowerCase().includes(q) || k.aliases.some((a) => a.toLowerCase().includes(q)) || k.catalog.toLowerCase() === q)
    .slice(0, 8)
    .map((k) => ({ id: k.id, catalog: k.catalog, name: k.name }));
  const passages = search(q, 4).map((h) => ({ chunkId: h.chunkId, sourceId: h.sourceId, accession: accessionNo(h.sourceId), text: h.text.slice(0, 220) }));
  return c.json({ concepts, passages });
});

/** Develops the sample plate into an empty vault (first-run convenience). */
app.post('/sample', (c) => {
  if (repo.listConcepts().length > 0) throw new HttpError(409, 'The vault already has concepts; the sample plate is only for an empty vault.');
  seed(false);
  return c.json({ ok: true });
});

// ── observing log ──────────────────────────────────────────────────────────

app.get('/log', (c) => {
  const now = new Date();
  const reviews = all(
    `SELECT substr(at, 1, 10) AS day, COUNT(*) AS count, AVG(grade) AS mean FROM reviews
     WHERE at >= ? GROUP BY day ORDER BY day`,
    new Date(now.getTime() - 120 * DAY_MS).toISOString(),
  ).map((r) => ({ day: r.day as string, count: r.count as number, meanGrade: Math.round((r.mean as number) * 10) / 10 }));

  const memory = repo.memoryByConcept();
  const concepts = repo.listConcepts();
  const forecast = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30].map((d) => {
    const at = new Date(now.getTime() + d * DAY_MS);
    const rs = concepts.map((k) => conceptRetention(memory.get(k.id) ?? [], k.createdAt, at));
    return {
      day: d,
      meanRetention: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
      ghosts: rs.filter((r) => r < 0.4).length,
    };
  });
  const fading = concepts
    .map((k) => ({
      id: k.id,
      catalog: catalogNo(k.id),
      name: k.name,
      retention: conceptRetention(memory.get(k.id) ?? [], k.createdAt, now),
      fadesInDays: daysUntilFade(memory.get(k.id) ?? [], k.createdAt, now),
    }))
    .filter((f) => f.retention >= 0.5 && f.fadesInDays <= 7)
    .sort((a, b) => a.fadesInDays - b.fadesInDays)
    .slice(0, 12);

  const count = (sql: string) => (all(sql)[0]?.n as number) ?? 0;
  const payload: LogPayload = {
    reviews,
    totals: {
      concepts: concepts.length,
      cards: count(`SELECT COUNT(*) AS n FROM cards`),
      sources: count(`SELECT COUNT(*) AS n FROM sources`),
      reviews: count(`SELECT COUNT(*) AS n FROM reviews`),
      gapsOpen: count(`SELECT COUNT(*) AS n FROM gaps WHERE status = 'open'`),
    },
    forecast,
    fading,
  };
  return c.json(payload);
});

// ── export ─────────────────────────────────────────────────────────────────

app.get('/export/anki', (c) => {
  const concepts = new Map(repo.listConcepts().map((k) => [k.id, k]));
  const esc = (s: string) => s.replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  const lines = repo.allCards().map((card) => {
    const k = concepts.get(card.conceptId);
    const front = card.kind === 'cloze' ? card.prompt.replace(/\{\{(.+?)\}\}/g, '{{c1::$1}}') : card.prompt;
    const back = card.options ? `${card.answer}<br><small>${card.options.join(' · ')}</small>` : card.answer;
    return [esc(front), esc(back), `cortexorbit ${k ? k.catalog : ''} ${(k?.name ?? '').replace(/\s+/g, '_')}`].join('\t');
  });
  c.header('content-type', 'text/tab-separated-values; charset=utf-8');
  c.header('content-disposition', 'attachment; filename="cortexorbit-anki.tsv"');
  return c.body(['#separator:tab', '#html:true', '#tags column:3', ...lines].join('\n'));
});

app.get('/export/markdown', (c) => {
  const ret = repo.retentionMap();
  const out = ['# CortexOrbit vault', '', `Exported ${new Date().toISOString().slice(0, 10)}`, ''];
  for (const k of repo.listConcepts()) {
    out.push(`## ${k.name} \`${k.catalog}\``, '', k.summary, '', `Recall: ${Math.round((ret.get(k.id) ?? 0) * 100)}%`, '');
    const n = repo.neighbours(k.id);
    if (n.length) out.push(`Links: ${n.map((x) => `${x.name} (${x.type})`).join(', ')}`, '');
  }
  c.header('content-type', 'text/markdown; charset=utf-8');
  c.header('content-disposition', 'attachment; filename="cortexorbit-vault.md"');
  return c.body(out.join('\n'));
});

export { develop };
