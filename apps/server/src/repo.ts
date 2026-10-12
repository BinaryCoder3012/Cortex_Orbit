import {
  accessionNo,
  catalogNo,
  conceptRetention,
  freshMemory,
  normalizeName,
  type Card,
  type CardKind,
  type Concept,
  type ConceptKind,
  type Edge,
  type EdgeType,
  type Gap,
  type MemoryTrace,
  type Source,
  type SourceKind,
} from '@cortex/core';
import { all, get, run, type Row } from './db.ts';

const nowIso = () => new Date().toISOString();

// ── mappers ────────────────────────────────────────────────────────────────

export function toSource(r: Row): Source {
  return {
    id: r.id,
    accession: accessionNo(r.id),
    kind: r.kind,
    title: r.title,
    url: r.url ?? null,
    status: r.status,
    error: r.error ?? null,
    createdAt: r.created_at,
    chunkCount: r.chunk_count ?? 0,
    conceptCount: r.concept_count ?? 0,
  };
}

export function toConcept(r: Row, sourceIds: number[] = []): Concept {
  return {
    id: r.id,
    catalog: catalogNo(r.id),
    name: r.name,
    summary: r.summary,
    kind: r.kind,
    importance: r.importance,
    aliases: JSON.parse(r.aliases ?? '[]'),
    createdAt: r.created_at,
    sourceIds,
    pinned: !!r.pinned,
  };
}

export function toCard(r: Row): Card {
  return {
    id: r.id,
    conceptId: r.concept_id,
    kind: r.kind,
    prompt: r.prompt,
    answer: r.answer,
    options: r.options ? JSON.parse(r.options) : null,
    ease: r.ease,
    interval: r.interval,
    reps: r.reps,
    lapses: r.lapses,
    lastReviewAt: r.last_review_at ?? null,
    dueAt: r.due_at,
    createdAt: r.created_at,
  };
}

export function toGap(r: Row): Gap {
  return {
    id: r.id,
    name: r.name,
    summary: r.summary,
    reason: r.reason,
    between: JSON.parse(r.between_ids ?? '[]'),
    status: r.status,
    createdAt: r.created_at,
  };
}

// ── sources ────────────────────────────────────────────────────────────────

export function listSources(): Source[] {
  return all(`
    SELECT s.*,
      (SELECT COUNT(*) FROM chunks c WHERE c.source_id = s.id) AS chunk_count,
      (SELECT COUNT(*) FROM concept_sources cs WHERE cs.source_id = s.id) AS concept_count
    FROM sources s ORDER BY s.id DESC`).map(toSource);
}

export function getSource(id: number): Source | undefined {
  const r = get(`
    SELECT s.*,
      (SELECT COUNT(*) FROM chunks c WHERE c.source_id = s.id) AS chunk_count,
      (SELECT COUNT(*) FROM concept_sources cs WHERE cs.source_id = s.id) AS concept_count
    FROM sources s WHERE s.id = ?`, id);
  return r ? toSource(r) : undefined;
}

export function createSource(kind: SourceKind, title: string, url: string | null, rawText: string | null): number {
  const res = run(
    `INSERT INTO sources (kind, title, url, status, raw_text, created_at) VALUES (?, ?, ?, 'queued', ?, ?)`,
    kind, title, url, rawText, nowIso(),
  );
  return Number(res.lastInsertRowid);
}

export function setSourceStatus(id: number, status: Source['status'], error: string | null = null) {
  run(`UPDATE sources SET status = ?, error = ? WHERE id = ?`, status, error, id);
}

export function updateSourceText(id: number, title: string, rawText: string) {
  run(`UPDATE sources SET title = ?, raw_text = ? WHERE id = ?`, title, rawText, id);
}

export function sourceRaw(id: number): Row | undefined {
  return get(`SELECT * FROM sources WHERE id = ?`, id);
}

/** Removes a source and any concept that no other source still vouches for. */
export function deleteSource(id: number) {
  const orphans = all(
    `SELECT concept_id FROM concept_sources WHERE source_id = ?
     AND concept_id NOT IN (SELECT concept_id FROM concept_sources WHERE source_id != ?)`,
    id, id,
  ).map((r) => r.concept_id as number);
  run(`DELETE FROM sources WHERE id = ?`, id);
  for (const cid of orphans) {
    const c = get(`SELECT pinned FROM concepts WHERE id = ?`, cid);
    if (c && !c.pinned) run(`DELETE FROM concepts WHERE id = ?`, cid);
  }
}

// ── chunks ─────────────────────────────────────────────────────────────────

export function insertChunks(sourceId: number, texts: string[]): number[] {
  run(`DELETE FROM chunks WHERE source_id = ?`, sourceId);
  return texts.map((t, i) =>
    Number(run(`INSERT INTO chunks (source_id, ord, text) VALUES (?, ?, ?)`, sourceId, i, t).lastInsertRowid),
  );
}

export function allChunks(): { id: number; sourceId: number; text: string }[] {
  return all(`SELECT id, source_id, text FROM chunks`).map((r) => ({ id: r.id, sourceId: r.source_id, text: r.text }));
}

export function chunksFor(sourceId: number) {
  return all(`SELECT id, text FROM chunks WHERE source_id = ? ORDER BY ord`, sourceId) as { id: number; text: string }[];
}

// ── concepts ───────────────────────────────────────────────────────────────

function sourceIdsByConcept(): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const r of all(`SELECT concept_id, source_id FROM concept_sources`)) {
    const arr = m.get(r.concept_id) ?? [];
    arr.push(r.source_id);
    m.set(r.concept_id, arr);
  }
  return m;
}

export function listConcepts(): Concept[] {
  const bySource = sourceIdsByConcept();
  return all(`SELECT * FROM concepts ORDER BY id`).map((r) => toConcept(r, bySource.get(r.id) ?? []));
}

export function getConcept(id: number): Concept | undefined {
  const r = get(`SELECT * FROM concepts WHERE id = ?`, id);
  if (!r) return undefined;
  const sids = all(`SELECT source_id FROM concept_sources WHERE concept_id = ?`, id).map((x) => x.source_id as number);
  return toConcept(r, sids);
}

/** Finds a concept by name or any alias, after normalisation. */
export function findConceptByName(name: string): Row | undefined {
  const norm = normalizeName(name);
  if (!norm) return undefined;
  const direct = get(`SELECT * FROM concepts WHERE norm = ?`, norm);
  if (direct) return direct;
  for (const r of all(`SELECT * FROM concepts WHERE aliases != '[]'`)) {
    const aliases: string[] = JSON.parse(r.aliases);
    if (aliases.some((a) => normalizeName(a) === norm)) return r;
  }
  return undefined;
}

export interface ConceptDraft {
  name: string;
  summary: string;
  kind: ConceptKind;
  importance: number;
  aliases: string[];
}

/** Inserts a new concept or enriches the existing one. Returns [id, created]. */
export function upsertConcept(d: ConceptDraft, sourceId: number | null): [number, boolean] {
  const existing = findConceptByName(d.name) ?? d.aliases.map(findConceptByName).find(Boolean);
  let id: number;
  let created = false;
  if (existing) {
    id = existing.id;
    const aliases = new Set<string>(JSON.parse(existing.aliases));
    for (const a of d.aliases) if (normalizeName(a) !== existing.norm) aliases.add(a);
    if (normalizeName(d.name) !== existing.norm) aliases.add(d.name);
    const summary = existing.summary.length >= d.summary.length ? existing.summary : d.summary;
    run(
      `UPDATE concepts SET summary = ?, aliases = ?, importance = MAX(importance, ?) WHERE id = ?`,
      summary, JSON.stringify([...aliases].slice(0, 12)), clampImportance(d.importance), id,
    );
  } else {
    id = Number(
      run(
        `INSERT INTO concepts (name, norm, summary, kind, importance, aliases, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        d.name.trim(), normalizeName(d.name), d.summary.trim(), d.kind, clampImportance(d.importance),
        JSON.stringify(d.aliases.slice(0, 12)), nowIso(),
      ).lastInsertRowid,
    );
    created = true;
    // a concept that was once a gap is now charted
    run(`UPDATE gaps SET status = 'charted' WHERE norm = ?`, normalizeName(d.name));
  }
  if (sourceId != null) run(`INSERT OR IGNORE INTO concept_sources (concept_id, source_id) VALUES (?, ?)`, id, sourceId);
  return [id, created];
}

const clampImportance = (n: number) => Math.max(1, Math.min(5, Math.round(n || 3)));

export function updateConcept(id: number, patch: Partial<Pick<Concept, 'name' | 'summary' | 'kind' | 'importance' | 'pinned'>>) {
  const c = get(`SELECT * FROM concepts WHERE id = ?`, id);
  if (!c) return;
  run(
    `UPDATE concepts SET name = ?, norm = ?, summary = ?, kind = ?, importance = ?, pinned = ? WHERE id = ?`,
    patch.name ?? c.name,
    patch.name ? normalizeName(patch.name) : c.norm,
    patch.summary ?? c.summary,
    patch.kind ?? c.kind,
    patch.importance != null ? clampImportance(patch.importance) : c.importance,
    patch.pinned != null ? (patch.pinned ? 1 : 0) : c.pinned,
    id,
  );
}

/** Folds `fromId` into `intoId`: cards, edges, mentions, sources and aliases all move. */
export function mergeConcepts(fromId: number, intoId: number) {
  const from = get(`SELECT * FROM concepts WHERE id = ?`, fromId);
  const into = get(`SELECT * FROM concepts WHERE id = ?`, intoId);
  if (!from || !into || fromId === intoId) return;
  const aliases = new Set<string>([...JSON.parse(into.aliases), from.name, ...JSON.parse(from.aliases)]);
  run(`UPDATE concepts SET aliases = ? WHERE id = ?`, JSON.stringify([...aliases].slice(0, 16)), intoId);
  run(`UPDATE cards SET concept_id = ? WHERE concept_id = ?`, intoId, fromId);
  run(`UPDATE reviews SET concept_id = ? WHERE concept_id = ?`, intoId, fromId);
  run(`INSERT OR IGNORE INTO concept_sources SELECT ?, source_id FROM concept_sources WHERE concept_id = ?`, intoId, fromId);
  run(`INSERT OR IGNORE INTO mentions SELECT ?, chunk_id FROM mentions WHERE concept_id = ?`, intoId, fromId);
  run(`INSERT OR IGNORE INTO edges SELECT ?, to_id, type FROM edges WHERE from_id = ? AND to_id != ?`, intoId, fromId, intoId);
  run(`INSERT OR IGNORE INTO edges SELECT from_id, ?, type FROM edges WHERE to_id = ? AND from_id != ?`, intoId, fromId, intoId);
  run(`DELETE FROM concepts WHERE id = ?`, fromId);
}

export function deleteConcept(id: number) {
  run(`DELETE FROM concepts WHERE id = ?`, id);
}

export function addMention(conceptId: number, chunkId: number) {
  run(`INSERT OR IGNORE INTO mentions (concept_id, chunk_id) VALUES (?, ?)`, conceptId, chunkId);
}

export function passagesFor(conceptId: number, limit = 6) {
  return all(
    `SELECT ch.id AS chunk_id, ch.text, s.id AS source_id, s.title
     FROM mentions m JOIN chunks ch ON ch.id = m.chunk_id JOIN sources s ON s.id = ch.source_id
     WHERE m.concept_id = ? ORDER BY ch.source_id DESC, ch.ord LIMIT ?`,
    conceptId, limit,
  ).map((r) => ({
    chunkId: r.chunk_id as number,
    sourceId: r.source_id as number,
    accession: accessionNo(r.source_id),
    sourceTitle: r.title as string,
    text: r.text as string,
  }));
}

export function conceptsInChunks(chunkIds: number[]) {
  if (chunkIds.length === 0) return [];
  return all(
    `SELECT DISTINCT c.id, c.name FROM mentions m JOIN concepts c ON c.id = m.concept_id
     WHERE m.chunk_id IN (${chunkIds.map(() => '?').join(',')})`,
    ...chunkIds,
  ).map((r) => ({ id: r.id as number, catalog: catalogNo(r.id), name: r.name as string }));
}

// ── edges ──────────────────────────────────────────────────────────────────

export function addEdge(from: number, to: number, type: EdgeType) {
  if (from === to) return;
  run(`INSERT OR IGNORE INTO edges (from_id, to_id, type) VALUES (?, ?, ?)`, from, to, type);
}

export function listEdges(): Edge[] {
  return all(`SELECT from_id, to_id, type FROM edges`).map((r) => ({ from: r.from_id, to: r.to_id, type: r.type }));
}

export function neighbours(id: number) {
  const out = all(
    `SELECT e.type, c.id, c.name FROM edges e JOIN concepts c ON c.id = e.to_id WHERE e.from_id = ?`, id,
  ).map((r) => ({ id: r.id as number, catalog: catalogNo(r.id), name: r.name as string, type: r.type as EdgeType, direction: 'out' as const }));
  const inc = all(
    `SELECT e.type, c.id, c.name FROM edges e JOIN concepts c ON c.id = e.from_id WHERE e.to_id = ?`, id,
  ).map((r) => ({ id: r.id as number, catalog: catalogNo(r.id), name: r.name as string, type: r.type as EdgeType, direction: 'in' as const }));
  return [...out, ...inc];
}

// ── cards & reviews ────────────────────────────────────────────────────────

export interface CardDraft {
  kind: CardKind;
  prompt: string;
  answer: string;
  options?: string[] | null;
}

export function addCard(conceptId: number, d: CardDraft, createdAt = new Date()): number {
  const m = freshMemory(createdAt);
  // skip near-duplicate prompts on the same concept
  const dupe = get(`SELECT id FROM cards WHERE concept_id = ? AND lower(prompt) = lower(?)`, conceptId, d.prompt.trim());
  if (dupe) return dupe.id;
  return Number(
    run(
      `INSERT INTO cards (concept_id, kind, prompt, answer, options, ease, interval, reps, lapses, last_review_at, due_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?)`,
      conceptId, d.kind, d.prompt.trim(), d.answer.trim(),
      d.options && d.options.length ? JSON.stringify(d.options) : null,
      m.ease, m.interval, m.dueAt, createdAt.toISOString(),
    ).lastInsertRowid,
  );
}

export function cardsFor(conceptId: number): Card[] {
  return all(`SELECT * FROM cards WHERE concept_id = ? ORDER BY id`, conceptId).map(toCard);
}

export function getCard(id: number): Card | undefined {
  const r = get(`SELECT * FROM cards WHERE id = ?`, id);
  return r ? toCard(r) : undefined;
}

export function allCards(): Card[] {
  return all(`SELECT * FROM cards`).map(toCard);
}

export function saveCardMemory(c: Card) {
  run(
    `UPDATE cards SET ease = ?, interval = ?, reps = ?, lapses = ?, last_review_at = ?, due_at = ? WHERE id = ?`,
    c.ease, c.interval, c.reps, c.lapses, c.lastReviewAt, c.dueAt, c.id,
  );
}

export function logReview(cardId: number | null, conceptId: number, grade: number, mode: string, at = new Date()) {
  run(`INSERT INTO reviews (card_id, concept_id, grade, mode, at) VALUES (?, ?, ?, ?, ?)`, cardId, conceptId, grade, mode, at.toISOString());
}

export function historyFor(conceptId: number) {
  return all(`SELECT at, grade FROM reviews WHERE concept_id = ? ORDER BY at DESC LIMIT 40`, conceptId) as { at: string; grade: number }[];
}

export function memoryByConcept(): Map<number, MemoryTrace[]> {
  const m = new Map<number, MemoryTrace[]>();
  for (const r of all(`SELECT concept_id, interval, last_review_at, created_at FROM cards`)) {
    const arr = m.get(r.concept_id) ?? [];
    arr.push({ interval: r.interval, lastReviewAt: r.last_review_at ?? null, createdAt: r.created_at });
    m.set(r.concept_id, arr);
  }
  return m;
}

export function retentionMap(at = new Date()): Map<number, number> {
  const mem = memoryByConcept();
  const out = new Map<number, number>();
  for (const r of all(`SELECT id, created_at FROM concepts`)) {
    out.set(r.id, conceptRetention(mem.get(r.id) ?? [], r.created_at, at));
  }
  return out;
}

// ── gaps ───────────────────────────────────────────────────────────────────

export function listGaps(status?: Gap['status']): Gap[] {
  const rows = status
    ? all(`SELECT * FROM gaps WHERE status = ? ORDER BY id DESC`, status)
    : all(`SELECT * FROM gaps ORDER BY id DESC`);
  return rows.map(toGap);
}

export function getGap(id: number): Gap | undefined {
  const r = get(`SELECT * FROM gaps WHERE id = ?`, id);
  return r ? toGap(r) : undefined;
}

/** Records a suggested gap unless it is already a concept or a known gap. */
export function addGap(name: string, summary: string, reason: string, between: number[]): boolean {
  const norm = normalizeName(name);
  if (!norm || findConceptByName(name)) return false;
  const res = run(
    `INSERT OR IGNORE INTO gaps (name, norm, summary, reason, between_ids, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    name.trim(), norm, summary.trim(), reason.trim(), JSON.stringify(between), nowIso(),
  );
  return res.changes > 0;
}

export function setGapStatus(id: number, status: Gap['status']) {
  run(`UPDATE gaps SET status = ? WHERE id = ?`, status, id);
}
