import { closeSync, openSync, readSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import type { LingxiStore } from "../core/store.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { doubaoAdapter } from "./doubao.js";
import { workbuddyAdapter } from "./workbuddy.js";
import { piAdapter } from "./pi.js";
import { customRules, redact } from "./redact.js";
import type { ParsedItem, SessionAdapter } from "./types.js";

export * from "./types.js";
export { claudeAdapter, codexAdapter, doubaoAdapter, piAdapter, redact, workbuddyAdapter };

export const INGEST_AGENTS = ["claude-code", "codex", "pi", "doubao", "workbuddy"] as const;

/** Adapters enabled by LINGXI_INGEST (comma list, "none" to disable; default: all). */
export function defaultAdapters(): SessionAdapter[] {
  const all = [claudeAdapter(), codexAdapter(), piAdapter(), doubaoAdapter(), workbuddyAdapter()];
  const env = process.env.LINGXI_INGEST?.trim();
  if (!env) return all;
  if (env === "none") return [];
  const wanted = new Set(env.split(",").map((s) => s.trim()));
  return all.filter((a) => wanted.has(a.agent));
}

export interface SyncStats {
  agent: string;
  files: number;
  changedFiles: number;
  newSessions: number;
  newTurns: number;
  errors: string[];
}

export interface SyncResult {
  ms: number;
  agents: SyncStats[];
}

interface SessionRow {
  id: string;
  title: string | null;
  cwd: string | null;
  source_offset: number;
  source_size: number;
  source_mtime: number;
  started_at: number | null;
  updated_at: number | null;
  turn_count: number;
  meta: string;
}

const MAX_CHUNK = 64 * 1024 * 1024; // parse at most 64 MB per file per sync; the rest is picked up next time

export class Ingestor {
  private lastSync = 0;

  constructor(
    private readonly store: LingxiStore,
    private readonly adapters: SessionAdapter[] = defaultAdapters(),
  ) {}

  /** Incremental sync, skipped if the previous one in this process ran less than `minIntervalMs` ago. */
  syncIfStale(minIntervalMs = 15_000): SyncResult | null {
    if (Date.now() - this.lastSync < minIntervalMs) return null;
    return this.sync();
  }

  sync(opts: { agents?: string[]; full?: boolean } = {}): SyncResult {
    const t0 = Date.now();
    const result: SyncResult = { ms: 0, agents: [] };
    for (const a of this.adapters) {
      if (opts.agents?.length && !opts.agents.includes(a.agent)) continue;
      const stats: SyncStats = { agent: a.agent, files: 0, changedFiles: 0, newSessions: 0, newTurns: 0, errors: [] };
      if (opts.full) this.resetAgent(a.agent);
      let files: string[] = [];
      try {
        files = a.discover();
      } catch (err) {
        stats.errors.push(`discover: ${String(err)}`);
      }
      stats.files = files.length;
      for (const f of files) {
        try {
          const r = this.syncFile(a, f);
          if (r.changed) stats.changedFiles++;
          if (r.created) stats.newSessions++;
          stats.newTurns += r.turns;
        } catch (err) {
          stats.errors.push(`${f}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      result.agents.push(stats);
    }
    this.lastSync = Date.now();
    result.ms = this.lastSync - t0;
    return result;
  }

  private resetAgent(agent: string): void {
    this.store.db.prepare("DELETE FROM sessions WHERE agent = ?").run(agent); // turns cascade
  }

  private syncFile(a: SessionAdapter, file: string): { changed: boolean; created: boolean; turns: number } {
    const db = this.store.db;
    const st = statSync(file);
    const size = st.size;
    const mtime = Math.floor(st.mtimeMs);
    const getRow = () => db.prepare("SELECT * FROM sessions WHERE source_path = ?").get(file) as unknown as SessionRow | undefined;

    let row = getRow();
    if (row && row.source_size === size && row.source_mtime === mtime) return { changed: false, created: false, turns: 0 };

    const nativeId = a.nativeIdFromPath(file);
    if (!nativeId) return { changed: false, created: false, turns: 0 };

    const whole = typeof a.parseFile === "function";
    let start = whole ? 0 : (row?.source_offset ?? 0);
    // "truncated" = re-import from scratch: the file shrank, or the adapter always re-parses whole files.
    const truncated = !!row && (whole || size < row.source_offset);
    if (truncated) start = 0;

    // Read the new bytes and keep only complete lines.
    const len = Math.min(size - start, MAX_CHUNK);
    let text = "";
    let consumed = 0;
    if (len > 0) {
      const buf = Buffer.alloc(len);
      const fd = openSync(file, "r");
      try {
        readSync(fd, buf, 0, len, start);
      } finally {
        closeSync(fd);
      }
      const lastNl = buf.lastIndexOf(0x0a);
      if (lastNl >= 0) {
        consumed = lastNl + 1;
        text = buf.subarray(0, consumed).toString("utf8");
      }
    }
    const items: ParsedItem[] = [];
    if (whole) {
      items.push(...a.parseFile!(file, text, mtime));
    } else {
      for (const line of text.split("\n")) {
        const l = line.trim();
        if (!l) continue;
        try {
          items.push(...a.parseLine(JSON.parse(l)));
        } catch {
          /* malformed line */
        }
      }
    }

    let created = false;
    let inserted = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      row = getRow(); // re-read inside the write lock (another process may have synced meanwhile)
      const raced = whole
        ? !!row && row.source_size === size && row.source_mtime === mtime
        : !!row && !truncated && row.source_offset !== start;
      if (raced) {
        db.exec("ROLLBACK");
        return { changed: false, created: false, turns: 0 };
      }
      if (truncated && row) {
        db.prepare("DELETE FROM turns WHERE session_id = ?").run(row.id);
        db.prepare("UPDATE sessions SET turn_count = 0, source_offset = 0, started_at = NULL, updated_at = NULL WHERE id = ?").run(row.id);
        row = getRow();
      }
      if (!row) {
        let id = `${a.agent}:${nativeId}`;
        const clash = db.prepare("SELECT source_path FROM sessions WHERE id = ?").get(id) as { source_path: string } | undefined;
        if (clash && clash.source_path !== file) id += "~" + createHash("sha1").update(file).digest("hex").slice(0, 6);
        db.prepare("INSERT INTO sessions (id, agent, native_id, source_path) VALUES (?,?,?,?)").run(id, a.agent, nativeId, file);
        created = true;
        row = getRow()!;
      }

      const meta = safeJson(row.meta);
      let title = row.title;
      let titleSource = (meta.titleSource as string | undefined) ?? (title ? "explicit" : undefined);
      let cwd = row.cwd;
      let startedAt = row.started_at;
      let updatedAt = row.updated_at;
      let seq = row.turn_count;
      const ins = db.prepare("INSERT INTO turns (session_id, seq, role, ts, text, tool_name) VALUES (?,?,?,?,?,?)");
      const extra = customRules(this.store.home);

      for (const it of items) {
        if (it.kind === "meta") {
          if (it.cwd && !cwd) cwd = it.cwd;
          if (it.title) {
            title = it.title.trim();
            titleSource = "explicit";
          } else if (it.fallbackTitle && !title && !/^\/\S+$/.test(it.fallbackTitle.trim())) {
            title = it.fallbackTitle;
            titleSource = "fallback";
          }
          if (it.started_at && (!startedAt || it.started_at < startedAt)) startedAt = it.started_at;
          if (it.ended_at && (!updatedAt || it.ended_at > updatedAt)) updatedAt = it.ended_at;
          if (it.meta) Object.assign(meta, it.meta);
          continue;
        }
        seq += 1;
        ins.run(row.id, seq, it.role, it.ts, redact(it.text, extra), it.tool_name ?? null);
        inserted += 1;
        if (it.ts) {
          if (!updatedAt || it.ts > updatedAt) updatedAt = it.ts;
          if (!startedAt || it.ts < startedAt) startedAt = it.ts;
        }
      }
      const sideTitle = a.titleFor?.(nativeId);
      if (sideTitle) {
        title = sideTitle;
        titleSource = "explicit";
      }
      if (titleSource) meta.titleSource = titleSource;
      if (!updatedAt) updatedAt = startedAt ?? mtime;

      const newOffset = start + consumed;
      // Only remember size/mtime once the whole file has been consumed, so the remainder is read next time.
      const fullyRead = newOffset >= size || consumed === 0;
      db.prepare(
        `UPDATE sessions SET title = ?, cwd = ?, started_at = ?, updated_at = ?, turn_count = ?, meta = ?,
           source_offset = ?, source_size = ?, source_mtime = ? WHERE id = ?`,
      ).run(title, cwd, startedAt, updatedAt, seq, JSON.stringify(meta), newOffset, fullyRead ? size : 0, fullyRead ? mtime : 0, row.id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return { changed: true, created, turns: inserted };
  }
}

function safeJson(s: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(s ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
