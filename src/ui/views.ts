import { execFileSync } from "node:child_process";
import type { LingxiStore } from "../core/store.js";
import { findGitRoot } from "../core/activity.js";
import { normalizeProjectPath } from "../core/project.js";
import { listPresence } from "../core/messages.js";

/** A gap longer than this between two turns splits a session's thread on the loom. */
const SEGMENT_GAP_MS = 40 * 60_000;

export interface WeaveSession {
  id: string;
  title: string | null;
  segments: [number, number][];
  turns: number;
}
export interface WeaveLane {
  agent: string;
  sessions: WeaveSession[];
}
export interface WeaveKnot {
  ts: number;
  agent: string;
  type: "handoff" | "card";
  kind: string | null;
  text: string;
  topic: string | null;
  topic_id: string | null;
  id: string;
}
export interface WeaveLink {
  ts: number;
  id: string;
  from_agent: string;
  to_agent: string;
  from_label: string | null;
  to_label: string | null;
  body: string;
}

/**
 * Data for the "loom": one lane per agent with the active time segments of each session,
 * knots where handoffs / cards were saved, and links where messages passed between agents.
 */
export function weave(store: LingxiStore, since: number, until: number): { since: number; until: number; lanes: WeaveLane[]; knots: WeaveKnot[]; links: WeaveLink[] } {
  const db = store.db;
  const rows = db
    .prepare(
      `SELECT t.session_id AS id, s.agent, s.title, t.ts FROM turns t JOIN sessions s ON s.id = t.session_id
       WHERE t.ts BETWEEN ? AND ? ORDER BY t.session_id, t.ts`,
    )
    .all(since, until) as { id: string; agent: string; title: string | null; ts: number }[];
  const sessions = new Map<string, WeaveSession & { agent: string }>();
  for (const r of rows) {
    let s = sessions.get(r.id);
    if (!s) sessions.set(r.id, (s = { id: r.id, agent: r.agent, title: r.title, segments: [], turns: 0 }));
    s.turns++;
    const last = s.segments[s.segments.length - 1];
    if (last && r.ts - last[1] <= SEGMENT_GAP_MS) last[1] = r.ts;
    else s.segments.push([r.ts, r.ts]);
  }
  const lanesMap = new Map<string, WeaveSession[]>();
  for (const s of sessions.values()) {
    const { agent, ...rest } = s;
    lanesMap.set(agent, [...(lanesMap.get(agent) ?? []), rest]);
  }
  const ORDER = ["claude-code", "codex", "pi", "cursor", "doubao", "workbuddy"];
  const lanes = [...lanesMap.entries()]
    .map(([agent, ss]) => ({ agent, sessions: ss.sort((a, b) => a.segments[0]![0] - b.segments[0]![0]) }))
    .sort((a, b) => (ORDER.indexOf(a.agent) + 99) % 99 - ((ORDER.indexOf(b.agent) + 99) % 99) || a.agent.localeCompare(b.agent));

  const knots = db
    .prepare(
      `SELECT h.created_at AS ts, h.author_agent AS agent, 'handoff' AS type, NULL AS kind, h.title AS text, t.name AS topic, h.topic_id, h.id
         FROM handoffs h LEFT JOIN topics t ON t.id = h.topic_id WHERE h.created_at BETWEEN ? AND ? AND h.author_agent IS NOT NULL
       UNION ALL
       SELECT c.created_at, c.author_agent, 'card', c.kind, c.content, t.name, c.topic_id, c.id
         FROM cards c LEFT JOIN topics t ON t.id = c.topic_id WHERE c.created_at BETWEEN ? AND ? AND c.author_agent IS NOT NULL
       ORDER BY ts`,
    )
    .all(since, until, since, until) as unknown as WeaveKnot[];

  // Messages between agents: resolve the recipient's agent through its presence (label) or session.
  const presence = listPresence(db, { all: true });
  const agentOfLabel = new Map(presence.filter((p) => p.label).map((p) => [p.label!, p.agent]));
  const agentOfSession = (native: string) =>
    presence.find((p) => p.session_native === native)?.agent ??
    (db.prepare("SELECT agent FROM sessions WHERE native_id = ?").get(native) as { agent: string } | undefined)?.agent;
  const msgs = db
    .prepare("SELECT id, created_at AS ts, from_agent, from_label, to_kind, to_value, body FROM messages WHERE created_at BETWEEN ? AND ? ORDER BY created_at")
    .all(since, until) as { id: string; ts: number; from_agent: string | null; from_label: string | null; to_kind: string; to_value: string; body: string }[];
  const links: WeaveLink[] = [];
  for (const m of msgs) {
    if (!m.from_agent) continue;
    const to = m.to_kind === "label" ? agentOfLabel.get(m.to_value) : m.to_kind === "session" ? agentOfSession(m.to_value) : undefined;
    if (!to) continue;
    links.push({ ts: m.ts, id: m.id, from_agent: m.from_agent, to_agent: to, from_label: m.from_label, to_label: m.to_kind === "label" ? m.to_value : null, body: m.body });
  }
  return { since, until, lanes, knots, links };
}

export interface ProjectSummary {
  root: string;
  name: string;
  isGit: boolean;
  branch: string | null;
  dirty: number;
  agents: string[];
  sessions: number;
  last: number;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  } catch {
    return null;
  }
}

/** Projects with agent activity in the period, newest first, with git branch and uncommitted file count. */
export function projects(store: LingxiStore, since: number, limit = 8): ProjectSummary[] {
  const rows = store.db
    .prepare("SELECT agent, cwd, updated_at FROM sessions WHERE updated_at >= ? AND cwd IS NOT NULL ORDER BY updated_at DESC")
    .all(since) as { agent: string; cwd: string; updated_at: number }[];
  const map = new Map<string, ProjectSummary>();
  for (const r of rows) {
    if (/[\\/]AppData[\\/]Local[\\/]Temp([\\/]|$)/i.test(r.cwd) || /^\/tmp\//.test(r.cwd)) continue; // scratch dirs (tests, consult copies)
    const gitRoot = findGitRoot(r.cwd);
    const root = gitRoot ?? normalizeProjectPath(r.cwd);
    let p = map.get(root);
    if (!p) {
      if (map.size >= limit) continue;
      map.set(root, (p = { root, name: root.split("/").pop() || root, isGit: !!gitRoot, branch: null, dirty: 0, agents: [], sessions: 0, last: r.updated_at }));
    }
    p.sessions++;
    if (!p.agents.includes(r.agent)) p.agents.push(r.agent);
    p.last = Math.max(p.last, r.updated_at);
  }
  for (const p of map.values()) {
    if (!p.isGit) continue;
    p.branch = git(p.root, ["rev-parse", "--abbrev-ref", "HEAD"])?.trim() || null;
    p.dirty = (git(p.root, ["status", "--porcelain"]) ?? "").split(/\r?\n/).filter(Boolean).length;
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}
