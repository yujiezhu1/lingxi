import type { DatabaseSync } from "node:sqlite";
import {
  getPresence,
  matchProject,
  presenceKey,
  rekeyPresence,
  removePresence,
  touchPresence,
  upsertPresence,
  type Presence,
} from "../core/index.js";

/** Environment variables through which agents may expose their own session id to child processes. */
export const SESSION_ENV_VARS: Record<string, string[]> = {
  pi: ["PI_SESSION_ID"],
  "claude-code": ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"],
  codex: ["CODEX_THREAD_ID", "CODEX_SESSION_ID"],
};

export function sessionIdFromEnv(agent: string, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const v of SESSION_ENV_VARS[agent] ?? []) {
    const x = env[v]?.trim();
    if (x) return x;
  }
  return null;
}

/**
 * Fallback when the agent does not expose its session id: the newest imported transcript of the same agent
 * whose cwd is this directory (or inside it) and which started after this MCP server did (minus a margin).
 */
export function guessSessionFromTranscripts(db: DatabaseSync, agent: string, cwd: string, startedAfter: number): string | null {
  const rows = db
    .prepare("SELECT native_id, cwd FROM sessions WHERE agent = ? AND started_at >= ? ORDER BY updated_at DESC LIMIT 20")
    .all(agent, startedAfter) as { native_id: string; cwd: string | null }[];
  for (const r of rows) {
    if (!r.cwd) continue;
    const m = matchProject(cwd, r.cwd);
    if (m === "exact" || m === "ancestor") return r.native_id;
  }
  return null;
}

/**
 * A pi extension or a Claude Code / Codex hook usually registers the session (with its real id) before the MCP
 * server is first used. Adopt that registration: same agent, same cwd, registered after this server started.
 */
export function guessSessionFromPresence(db: DatabaseSync, agent: string, cwd: string, startedAfter: number): string | null {
  const rows = db
    .prepare(
      `SELECT session_native, cwd FROM presence WHERE agent = ? AND session_native IS NOT NULL AND via != 'mcp'
       AND started_at >= ? ORDER BY last_seen DESC LIMIT 10`,
    )
    .all(agent, startedAfter) as { session_native: string; cwd: string | null }[];
  for (const r of rows) if (r.cwd && matchProject(cwd, r.cwd) === "exact") return r.session_native;
  return null;
}

/**
 * Identity of the agent session this MCP server process belongs to (stdio servers live exactly as long as the session).
 * Starts with a pid-based key and switches to `<agent>:<sessionId>` once the session id is known.
 */
export class SessionIdentity {
  private key: string;
  private native: string | null = null;
  private readonly started = Date.now();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly agentName: () => string,
    private readonly cwd: string = process.cwd(),
    /** Called before guessing from transcripts (e.g. an incremental session import). */
    private readonly beforeGuess?: () => void,
  ) {
    this.key = presenceKey("pending", null);
  }

  /** Current presence (registers / refreshes it). Cheap enough to call on every tool call. */
  current(): Presence {
    const agent = this.agentName();
    const since = this.started - 2 * 60_000;
    const fromEnv = sessionIdFromEnv(agent);
    if (fromEnv) this.native = fromEnv;
    else {
      // Re-check every call: some apps (e.g. Codex Desktop) keep one MCP server across several sessions,
      // so the newest session registered by a hook / extension in this directory wins.
      const adopted = guessSessionFromPresence(this.db, agent, this.cwd, since);
      if (adopted) this.native = adopted;
      else if (!this.native) {
        try {
          this.beforeGuess?.();
        } catch {
          /* ignore */
        }
        this.native = guessSessionFromTranscripts(this.db, agent, this.cwd, since);
      }
    }
    const key = presenceKey(agent, this.native);
    if (key !== this.key) {
      rekeyPresence(this.db, this.key, key);
      this.key = key;
    }
    const existing = getPresence(this.db, key);
    if (existing && Date.now() - existing.last_seen < 5_000) return existing;
    return upsertPresence(this.db, { key, agent, session_native: this.native, cwd: this.cwd, pid: process.pid, via: "mcp" });
  }

  get presenceKey(): string {
    return this.key;
  }

  startHeartbeat(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        // Unidentified (pid-keyed) rows are only kept alive by real tool calls, not by the heartbeat,
        // so an idle MCP server does not show up as a phantom session.
        if (this.native && getPresence(this.db, this.key)) touchPresence(this.db, this.key);
      } catch {
        /* db closed */
      }
    }, intervalMs);
    this.timer.unref();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    try {
      // Only drop rows this process owns; a pi extension / hook may share the session key and keep it alive.
      const p = getPresence(this.db, this.key);
      if (p && p.via === "mcp" && p.pid === process.pid) removePresence(this.db, this.key);
    } catch {
      /* ignore */
    }
  }
}
