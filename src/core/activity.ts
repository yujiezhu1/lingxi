import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { matchProject, normalizeProjectPath } from "./project.js";
import type { LingxiStore } from "./store.js";

export interface ActivitySession {
  id: string;
  agent: string;
  title: string | null;
  cwd: string | null;
  first_ts: number;
  last_ts: number;
  user_msgs: number;
  first_user: string | null;
  last_assistant: string | null;
}

export interface ActivityNote {
  type: "handoff" | "card";
  id: string;
  topic: string;
  text: string;
  kind: string | null;
  author_agent: string | null;
  ts: number;
}

export interface GitInfo {
  branch: string | null;
  commits: string[];
  /** Current uncommitted state (only meaningful when the range includes now). */
  status: string[];
  diffstat: string | null;
}

export interface ActivityProject {
  root: string;
  isGit: boolean;
  sessions: ActivitySession[];
  notes: ActivityNote[];
  git: GitInfo | null;
}

export interface ActivityReport {
  since: number;
  until: number;
  projects: ActivityProject[];
  /** Notes in topics that are not bound to any project with activity. */
  otherNotes: ActivityNote[];
}

const gitRootCache = new Map<string, string | null>();

export function findGitRoot(dir: string): string | null {
  const key = normalizeProjectPath(dir);
  if (gitRootCache.has(key)) return gitRootCache.get(key)!;
  let cur = key;
  let found: string | null = null;
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(cur, ".git"))) {
      found = normalizeProjectPath(cur);
      break;
    }
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  gitRootCache.set(key, found);
  return found;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch {
    return null;
  }
}

export function gitInfo(root: string, since: number, until: number, includeStatus: boolean): GitInfo {
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() || null;
  const log = git(root, [
    "log",
    "--all",
    `--since=@${Math.floor(since / 1000)}`,
    `--until=@${Math.floor(until / 1000)}`,
    "--date=format:%m-%d %H:%M",
    "--pretty=format:%h %ad %an: %s",
    "-n",
    "30",
  ]);
  const commits = log ? log.split(/\r?\n/).filter(Boolean) : [];
  let status: string[] = [];
  let diffstat: string | null = null;
  if (includeStatus) {
    status = (git(root, ["status", "--short", "--untracked-files=normal"]) ?? "").split(/\r?\n/).filter(Boolean);
    const ds = git(root, ["diff", "--shortstat", "HEAD"]);
    diffstat = ds?.trim() || null;
  }
  return { branch, commits, status, diffstat };
}

export function activityReport(
  store: LingxiStore,
  opts: { since: number; until: number; project?: string; git?: boolean; sessionLimit?: number },
): ActivityReport {
  const db = store.db;
  const { since, until } = opts;

  // Sessions with at least one indexed turn in range.
  const rows = db
    .prepare(
      `SELECT t.session_id AS id, s.agent, s.title, s.cwd, MIN(t.ts) AS first_ts, MAX(t.ts) AS last_ts,
              SUM(CASE WHEN t.role = 'user' THEN 1 ELSE 0 END) AS user_msgs
       FROM turns t JOIN sessions s ON s.id = t.session_id
       WHERE t.ts BETWEEN ? AND ?
       GROUP BY t.session_id ORDER BY last_ts DESC`,
    )
    .all(since, until) as unknown as Omit<ActivitySession, "first_user" | "last_assistant">[];
  const firstUser = db.prepare(
    "SELECT text FROM turns WHERE session_id = ? AND role = 'user' AND ts BETWEEN ? AND ? ORDER BY seq LIMIT 1",
  );
  const lastAssistant = db.prepare(
    "SELECT text FROM turns WHERE session_id = ? AND role = 'assistant' AND ts BETWEEN ? AND ? ORDER BY seq DESC LIMIT 1",
  );

  const byRoot = new Map<string, ActivityProject>();
  const ensure = (root: string, isGit: boolean): ActivityProject => {
    let p = byRoot.get(root);
    if (!p) byRoot.set(root, (p = { root, isGit, sessions: [], notes: [], git: null }));
    return p;
  };

  const bindings = db.prepare("SELECT topic_id, target_id FROM topic_links WHERE target_type = 'project'").all() as {
    topic_id: string;
    target_id: string;
  }[];
  /** Outside git repos, group by the closest Lingxi-bound project that contains the cwd. */
  const boundRoot = (cwd: string): string | null => {
    let best: string | null = null;
    for (const b of bindings) {
      const m = matchProject(b.target_id, cwd);
      if ((m === "exact" || m === "ancestor") && (!best || b.target_id.length > best.length)) best = b.target_id;
    }
    return best;
  };

  for (const r of rows) {
    const cwd = r.cwd ? normalizeProjectPath(r.cwd) : "(unknown)";
    const gitRoot = r.cwd ? findGitRoot(r.cwd) : null;
    const root = gitRoot ?? (r.cwd ? boundRoot(r.cwd) : null) ?? cwd;
    if (opts.project) {
      const m = r.cwd ? matchProject(opts.project, r.cwd) : null;
      if (m !== "exact" && m !== "ancestor") continue;
    }
    const fu = firstUser.get(r.id, since, until) as { text: string } | undefined;
    const la = lastAssistant.get(r.id, since, until) as { text: string } | undefined;
    ensure(root, !!gitRoot).sessions.push({
      ...r,
      first_ts: Number(r.first_ts),
      last_ts: Number(r.last_ts),
      user_msgs: Number(r.user_msgs),
      first_user: fu?.text ?? null,
      last_assistant: la?.text ?? null,
    });
  }

  // Lingxi notes created in range, attached to the project(s) their topic is bound to.
  const notes = db
    .prepare(
      `SELECT 'handoff' AS type, h.id, t.name AS topic, t.id AS topic_id, h.title AS text, NULL AS kind, h.author_agent, h.created_at AS ts
         FROM handoffs h JOIN topics t ON t.id = h.topic_id WHERE h.created_at BETWEEN ? AND ?
       UNION ALL
       SELECT 'card', c.id, t.name, t.id, c.content, c.kind, c.author_agent, c.created_at
         FROM cards c JOIN topics t ON t.id = c.topic_id WHERE c.created_at BETWEEN ? AND ? AND c.status = 'active'
       ORDER BY ts`,
    )
    .all(since, until, since, until) as unknown as (ActivityNote & { topic_id: string })[];
  const otherNotes: ActivityNote[] = [];
  for (const n of notes) {
    const paths = bindings.filter((b) => b.topic_id === n.topic_id).map((b) => b.target_id);
    const { topic_id: _t, ...note } = n;
    if (!paths.length) {
      if (!opts.project) otherNotes.push(note);
      continue;
    }
    for (const p of paths) {
      if (opts.project) {
        const m = matchProject(opts.project, p);
        if (!m) continue;
      }
      const root = findGitRoot(p) ?? normalizeProjectPath(p);
      ensure(root, findGitRoot(p) !== null).notes.push(note);
    }
  }

  // Git facts per repository.
  if (opts.git !== false) {
    const includeStatus = until >= Date.now() - 60_000;
    for (const p of byRoot.values()) if (p.isGit) p.git = gitInfo(p.root, since, until, includeStatus);
  }

  const projects = [...byRoot.values()].sort((a, b) => lastTs(b) - lastTs(a));
  if (opts.sessionLimit) for (const p of projects) p.sessions = p.sessions.slice(0, opts.sessionLimit);
  return { since, until, projects, otherNotes };
}

function lastTs(p: ActivityProject): number {
  return Math.max(0, ...p.sessions.map((s) => s.last_ts), ...p.notes.map((n) => n.ts));
}
