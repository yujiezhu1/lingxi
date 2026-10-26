import type { DatabaseSync } from "node:sqlite";
import { matchProject } from "./project.js";
import { LingxiError } from "./errors.js";

export interface SessionInfo {
  id: string;
  agent: string;
  native_id: string;
  title: string | null;
  cwd: string | null;
  started_at: number | null;
  updated_at: number | null;
  turn_count: number;
  source_path: string;
}

export interface TurnRow {
  seq: number;
  role: string;
  ts: number | null;
  text: string;
  tool_name: string | null;
}

export interface SessionHit {
  session_id: string;
  agent: string;
  title: string | null;
  cwd: string | null;
  seq: number;
  role: string;
  ts: number | null;
  snippet: string;
}

export const CONVERSATION_ROLES = ["user", "assistant"] as const;
export const ALL_ROLES = ["user", "assistant", "tool_call", "tool_result"] as const;

const SESSION_COLS = "id, agent, native_id, title, cwd, started_at, updated_at, turn_count, source_path";

/**
 * Short, typeable reference. Codex / pi ids are UUIDv7 (time-ordered), so their first characters collide
 * for sessions started close together; the last group of a UUID is random, so it is used instead.
 */
export function shortRef(s: { agent: string; native_id: string }): string {
  const id = s.native_id.split("~")[0]!;
  const m = id.match(/-([0-9a-f]{12})$/i);
  return `${s.agent}:${m ? m[1] : id.length <= 24 ? id : id.slice(0, 16)}`;
}

/** shortRef from a stored session id ('<agent>:<nativeId>'). */
export function refOfSessionId(sessionId: string): string {
  const i = sessionId.indexOf(":");
  return shortRef({ agent: sessionId.slice(0, i), native_id: sessionId.slice(i + 1) });
}

/** Session cwd is the project dir or inside it. */
function inProject(cwd: string | null, project: string): boolean {
  if (!cwd) return false;
  const m = matchProject(project, cwd);
  return m === "exact" || m === "ancestor";
}

export function listSessions(
  db: DatabaseSync,
  opts: { agent?: string; project?: string; since?: number; until?: number; limit?: number } = {},
): SessionInfo[] {
  const where: string[] = ["turn_count > 0"];
  const args: (string | number)[] = [];
  if (opts.agent) {
    where.push("agent = ?");
    args.push(opts.agent);
  }
  if (opts.since) {
    where.push("updated_at >= ?");
    args.push(opts.since);
  }
  if (opts.until) {
    where.push("started_at <= ?");
    args.push(opts.until);
  }
  const rows = db
    .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`)
    .all(...args) as unknown as SessionInfo[];
  const filtered = opts.project ? rows.filter((r) => inProject(r.cwd, opts.project!)) : rows;
  return filtered.slice(0, opts.limit ?? 20);
}

export function getSession(db: DatabaseSync, id: string): SessionInfo | null {
  return (db.prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?`).get(id) as unknown as SessionInfo) ?? null;
}

export interface ParsedRef {
  session: SessionInfo;
  from?: number;
  to?: number;
}

/**
 * Resolve `agent:idPrefix[#seq | #from..to]` or a bare id prefix.
 * Prefixes of ≥ 4 chars are accepted when unambiguous.
 */
export function resolveSessionRef(db: DatabaseSync, ref: string): ParsedRef {
  const m = ref.trim().match(/^(?:([a-z][a-z0-9-]*):)?([^#\s]+)(?:#(\d+)(?:\.\.(\d+))?)?$/i);
  if (!m) throw new LingxiError(`Invalid session ref: ${ref} (expected e.g. codex:01a167c8 or pi:01a16790#42)`);
  const [, agent, idPart, a, b] = m;
  if (idPart!.length < 4) throw new LingxiError(`Session id prefix too short: ${idPart}`);
  // Accept a prefix (e.g. copied from a file name) or a suffix (the short ref shown by Lingxi), or the full id.
  const args: string[] = [`${idPart}%`, `%${idPart}`];
  let sql = `SELECT ${SESSION_COLS} FROM sessions WHERE (native_id LIKE ? OR native_id LIKE ?)`;
  if (agent) {
    sql += " AND agent = ?";
    args.push(agent);
  }
  let rows = db.prepare(sql + " LIMIT 6").all(...args) as unknown as SessionInfo[];
  const exact = rows.filter((r) => r.native_id === idPart);
  if (exact.length === 1) rows = exact;
  if (!rows.length) throw new LingxiError(`Session not found: ${ref} (try lingxi sync / list_sessions)`);
  if (rows.length > 1) {
    throw new LingxiError(`Ambiguous session ref ${ref}: ${rows.map((r) => `${r.agent}:${r.native_id}`).join(", ")}`);
  }
  const out: ParsedRef = { session: rows[0]! };
  if (a) {
    out.from = Number(a);
    out.to = b ? Number(b) : Number(a);
  }
  return out;
}

export interface ReadOptions {
  /** Turns before/after a single `#seq` ref (default 6 / 6). */
  before?: number;
  after?: number;
  /** Explicit window start (when the ref has no #seq). */
  from?: number;
  /** Number of turns when reading without a window (default: the last 40). */
  limit?: number;
  /** Include tool calls / results (default: only when reading a #seq window). */
  tools?: boolean;
}

export function readSession(db: DatabaseSync, ref: string, opts: ReadOptions = {}): { session: SessionInfo; turns: TurnRow[]; range: [number, number]; skippedTools: number } {
  const r = resolveSessionRef(db, ref);
  const total = r.session.turn_count;
  let lo: number;
  let hi: number;
  let tools = opts.tools;
  if (r.from !== undefined) {
    const single = r.from === r.to;
    lo = single ? r.from - (opts.before ?? 6) : r.from;
    hi = single ? r.to! + (opts.after ?? 6) : r.to!;
    tools ??= true;
  } else if (opts.from !== undefined) {
    lo = opts.from;
    hi = opts.from + (opts.limit ?? 40) - 1;
  } else {
    tools ??= false;
    // last N conversation turns: find the seq where they start
    const n = opts.limit ?? 40;
    const roles = tools ? ALL_ROLES : CONVERSATION_ROLES;
    const row = db
      .prepare(
        `SELECT MIN(seq) AS s FROM (SELECT seq FROM turns WHERE session_id = ? AND role IN (${roles.map(() => "?").join(",")})
         ORDER BY seq DESC LIMIT ?)`,
      )
      .get(r.session.id, ...roles, n) as { s: number | null };
    lo = row.s ?? 1;
    hi = total;
  }
  lo = Math.max(1, lo);
  hi = Math.min(total, hi);
  const all = db
    .prepare("SELECT seq, role, ts, text, tool_name FROM turns WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq")
    .all(r.session.id, lo, hi) as unknown as TurnRow[];
  const turns = tools ? all : all.filter((t) => t.role === "user" || t.role === "assistant");
  return { session: r.session, turns, range: [lo, hi], skippedTools: all.length - turns.length };
}

export interface SessionSearchOptions {
  agent?: string;
  project?: string;
  since?: number;
  until?: number;
  /** Default: user + assistant messages only. */
  includeTools?: boolean;
  limit?: number;
  /** Max hits per session (default 3) so one long session does not crowd out the rest. */
  perSession?: number;
}

export function searchSessions(db: DatabaseSync, query: string, opts: SessionSearchOptions = {}): SessionHit[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const limit = opts.limit ?? 10;
  const per = opts.perSession ?? 3;
  const roles = opts.includeTools ? ALL_ROLES : CONVERSATION_ROLES;

  const filters: string[] = [`t.role IN (${roles.map(() => "?").join(",")})`];
  const fargs: (string | number)[] = [...roles];
  if (opts.agent) {
    filters.push("s.agent = ?");
    fargs.push(opts.agent);
  }
  if (opts.since) {
    filters.push("t.ts >= ?");
    fargs.push(opts.since);
  }
  if (opts.until) {
    filters.push("t.ts <= ?");
    fargs.push(opts.until);
  }
  if (opts.project) {
    const ids = (db.prepare("SELECT id, cwd FROM sessions").all() as { id: string; cwd: string | null }[])
      .filter((s) => inProject(s.cwd, opts.project!))
      .map((s) => s.id);
    if (!ids.length) return [];
    filters.push(`s.id IN (${ids.map(() => "?").join(",")})`);
    fargs.push(...ids);
  }
  const fetch = limit * per * 3;
  let rows: Record<string, unknown>[];
  if (terms.every((t) => [...t].length >= 3)) {
    const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
    rows = db
      .prepare(
        `SELECT t.session_id, s.agent, s.title, s.cwd, t.seq, t.role, t.ts,
                snippet(turns_fts, 0, '«', '»', ' … ', 48) AS snippet
         FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid JOIN sessions s ON s.id = t.session_id
         WHERE turns_fts MATCH ? AND ${filters.join(" AND ")}
         ORDER BY bm25(turns_fts) LIMIT ?`,
      )
      .all(match, ...fargs, fetch) as Record<string, unknown>[];
  } else {
    const likes = terms.map(() => "t.text LIKE ? ESCAPE '\\'");
    const largs = terms.map((t) => `%${t.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    rows = (
      db
        .prepare(
          `SELECT t.session_id, s.agent, s.title, s.cwd, t.seq, t.role, t.ts, t.text
           FROM turns t JOIN sessions s ON s.id = t.session_id
           WHERE ${[...likes, ...filters].join(" AND ")} ORDER BY t.ts DESC LIMIT ?`,
        )
        .all(...largs, ...fargs, fetch) as Record<string, unknown>[]
    ).map((r) => ({ ...r, snippet: snippetAround(String(r.text ?? ""), terms[0]!) }));
  }
  const perCount = new Map<string, number>();
  const out: SessionHit[] = [];
  for (const r of rows) {
    const sid = String(r.session_id);
    const c = perCount.get(sid) ?? 0;
    if (c >= per) continue;
    perCount.set(sid, c + 1);
    out.push({
      session_id: sid,
      agent: String(r.agent),
      title: (r.title as string | null) ?? null,
      cwd: (r.cwd as string | null) ?? null,
      seq: Number(r.seq),
      role: String(r.role),
      ts: r.ts === null ? null : Number(r.ts),
      snippet: String(r.snippet ?? "").replace(/\s+/g, " "),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function snippetAround(body: string, term: string, radius = 50): string {
  const flat = body.replace(/\s+/g, " ");
  const i = flat.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return flat.slice(0, radius * 2);
  const s = Math.max(0, i - radius);
  const e = Math.min(flat.length, i + term.length + radius);
  return (s > 0 ? "… " : "") + flat.slice(s, i) + "«" + flat.slice(i, i + term.length) + "»" + flat.slice(i + term.length, e) + (e < flat.length ? " …" : "");
}

/** Sessions whose cwd lies in any of the given project paths, newest first. */
export function sessionsInProjects(db: DatabaseSync, projects: string[], limit = 5): SessionInfo[] {
  if (!projects.length) return [];
  const rows = db
    .prepare(`SELECT ${SESSION_COLS} FROM sessions WHERE turn_count > 0 ORDER BY updated_at DESC`)
    .all() as unknown as SessionInfo[];
  return rows.filter((r) => projects.some((p) => inProject(r.cwd, p))).slice(0, limit);
}
