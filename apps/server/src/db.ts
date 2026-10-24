import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? '/tmp/cortex-data'
  : path.resolve(here, '../../../data');
export const DATA_DIR = process.env.CORTEX_DATA_DIR ?? defaultDir;

function open(): DatabaseSync {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const d = new DatabaseSync(path.join(DATA_DIR, 'cortex.db'));
    d.exec('PRAGMA journal_mode = WAL;');
    return d;
  } catch (e) {
    // Read-only or missing filesystem (some serverless hosts): keep working in memory.
    console.warn(`Could not open ${DATA_DIR}/cortex.db, using an in-memory vault:`, e);
    return new DatabaseSync(':memory:');
  }
}

export const db = open();

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS sources (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    url         TEXT,
    status      TEXT NOT NULL DEFAULT 'queued',
    error       TEXT,
    raw_text    TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id         INTEGER PRIMARY KEY,
    source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    ord        INTEGER NOT NULL,
    text       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source_id);

  CREATE TABLE IF NOT EXISTS concepts (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    norm        TEXT NOT NULL UNIQUE,
    summary     TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL DEFAULT 'idea',
    importance  INTEGER NOT NULL DEFAULT 3,
    aliases     TEXT NOT NULL DEFAULT '[]',
    pinned      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS concept_sources (
    concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    PRIMARY KEY (concept_id, source_id)
  );

  CREATE TABLE IF NOT EXISTS mentions (
    concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    chunk_id   INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    PRIMARY KEY (concept_id, chunk_id)
  );

  CREATE TABLE IF NOT EXISTS edges (
    from_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    to_id   INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    type    TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id, type)
  );

  CREATE TABLE IF NOT EXISTS cards (
    id              INTEGER PRIMARY KEY,
    concept_id      INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    answer          TEXT NOT NULL,
    options         TEXT,
    ease            REAL NOT NULL DEFAULT 2.5,
    interval        REAL NOT NULL DEFAULT 1,
    reps            INTEGER NOT NULL DEFAULT 0,
    lapses          INTEGER NOT NULL DEFAULT 0,
    last_review_at  TEXT,
    due_at          TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cards_concept ON cards(concept_id);
  CREATE INDEX IF NOT EXISTS cards_due ON cards(due_at);

  CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY,
    card_id     INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    concept_id  INTEGER REFERENCES concepts(id) ON DELETE SET NULL,
    grade       INTEGER NOT NULL,
    mode        TEXT NOT NULL,
    at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gaps (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    norm        TEXT NOT NULL UNIQUE,
    summary     TEXT NOT NULL,
    reason      TEXT NOT NULL,
    between_ids TEXT NOT NULL DEFAULT '[]',
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT NOT NULL
  );
`);

export type Row = Record<string, any>;

export const all = (sql: string, ...params: any[]) => db.prepare(sql).all(...params) as Row[];
export const get = (sql: string, ...params: any[]) => db.prepare(sql).get(...params) as Row | undefined;
export const run = (sql: string, ...params: any[]) => db.prepare(sql).run(...params);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
