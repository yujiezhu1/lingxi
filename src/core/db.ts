import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied in order. PRAGMA user_version tracks progress.
 * Never edit a released migration — append a new one.
 */
const MIGRATIONS: string[] = [
  // v1 — P0: topics, links, handoffs, cards, unified FTS index
  `
  CREATE TABLE topics (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE topic_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    note        TEXT,
    created_at  INTEGER NOT NULL,
    UNIQUE (topic_id, target_type, target_id)
  );

  CREATE TABLE handoffs (
    id             TEXT PRIMARY KEY,
    topic_id       TEXT REFERENCES topics(id) ON DELETE SET NULL,
    title          TEXT NOT NULL,
    body_md        TEXT NOT NULL,
    source_session TEXT,
    author_agent   TEXT,
    refs           TEXT NOT NULL DEFAULT '[]',
    supersedes     TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    created_at     INTEGER NOT NULL,
    file_path      TEXT
  );
  CREATE INDEX idx_handoffs_topic ON handoffs(topic_id, created_at DESC);

  CREATE TABLE cards (
    id           TEXT PRIMARY KEY,
    topic_id     TEXT REFERENCES topics(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
    content      TEXT NOT NULL,
    refs         TEXT NOT NULL DEFAULT '[]',
    author_agent TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX idx_cards_topic ON cards(topic_id, created_at DESC);

  -- Unified full-text index over handoffs + cards. trigram works for CJK without a segmenter
  -- (queries shorter than 3 chars fall back to LIKE in the store).
  CREATE VIRTUAL TABLE docs_fts USING fts5(
    doc_type UNINDEXED,
    doc_id   UNINDEXED,
    topic_id UNINDEXED,
    title,
    body,
    tokenize = 'trigram'
  );
  `,
];

export function openDb(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const current = () => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current() >= MIGRATIONS.length) return;
  // Several agents may start `lingxi mcp` at the same moment: take the write lock first,
  // then re-read the version so only one process applies each migration.
  db.exec("BEGIN IMMEDIATE");
  try {
    let version = current();
    while (version < MIGRATIONS.length) {
      db.exec(MIGRATIONS[version]!);
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
