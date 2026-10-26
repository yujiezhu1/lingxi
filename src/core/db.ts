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
  // v2 \u2014 P1 (v0.2): imported agent sessions + raw-text index
  `
  CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,          -- '<agent>:<nativeId>'
    agent         TEXT NOT NULL,
    native_id     TEXT NOT NULL,
    title         TEXT,
    cwd           TEXT,
    source_path   TEXT NOT NULL UNIQUE,
    source_offset INTEGER NOT NULL DEFAULT 0, -- bytes already parsed
    source_size   INTEGER NOT NULL DEFAULT 0,
    source_mtime  INTEGER NOT NULL DEFAULT 0,
    started_at    INTEGER,
    updated_at    INTEGER,
    turn_count    INTEGER NOT NULL DEFAULT 0,
    meta          TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
  CREATE INDEX idx_sessions_agent ON sessions(agent, native_id);

  CREATE TABLE turns (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,             -- 1-based position within the session (indexed turns only)
    role       TEXT NOT NULL,                -- user | assistant | tool_call | tool_result
    ts         INTEGER,
    text       TEXT NOT NULL,
    tool_name  TEXT,
    UNIQUE (session_id, seq)
  );
  CREATE INDEX idx_turns_ts ON turns(ts);

  CREATE VIRTUAL TABLE turns_fts USING fts5(text, content = 'turns', content_rowid = 'id', tokenize = 'trigram');
  CREATE TRIGGER turns_ai AFTER INSERT ON turns BEGIN
    INSERT INTO turns_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER turns_ad AFTER DELETE ON turns BEGIN
    INSERT INTO turns_fts(turns_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  `,
  // v3 \u2014 v0.4: cross-session messaging
  `
  CREATE TABLE presence (
    key            TEXT PRIMARY KEY,         -- '<agent>:<nativeSessionId>' or '<agent>#pid<pid>'
    agent          TEXT NOT NULL,
    session_native TEXT,
    label          TEXT,
    cwd            TEXT,
    pid            INTEGER,
    via            TEXT,                     -- mcp | pi-extension | hook | cli
    topics         TEXT NOT NULL DEFAULT '[]',
    activity       TEXT,
    started_at     INTEGER,
    last_seen      INTEGER NOT NULL
  );
  CREATE INDEX idx_presence_label ON presence(label);

  CREATE TABLE messages (
    id         TEXT PRIMARY KEY,
    from_key   TEXT,
    from_agent TEXT,
    from_label TEXT,
    to_kind    TEXT NOT NULL,                -- session | label | topic | project | all
    to_value   TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'note', -- note | question | answer | request | notify
    body       TEXT NOT NULL,
    refs       TEXT NOT NULL DEFAULT '[]',
    reply_to   TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_messages_created ON messages(created_at DESC);

  CREATE TABLE message_reads (
    message_id TEXT NOT NULL,
    reader_key TEXT NOT NULL,
    read_at    INTEGER NOT NULL,
    PRIMARY KEY (message_id, reader_key)
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
