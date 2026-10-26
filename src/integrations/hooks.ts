import { LingxiStore } from "../core/store.js";
import { fmtInbox, getPresence, inboxFor, markRead, upsertPresence } from "../core/messages.js";

/**
 * Hook entry point for Claude Code and Codex (`lingxi hook <agent> <event>`, hook JSON on stdin).
 * - every event refreshes this session's presence (so other sessions can see and address it);
 * - SessionStart / UserPromptSubmit inject unread messages as additional context for the next model turn.
 * Never fails the hook: on any error it prints nothing and exits 0.
 */
export function runHook(agent: string, event: string, stdin: string): string {
  let store: LingxiStore | null = null;
  try {
    const input = JSON.parse(stdin || "{}") as { session_id?: string; cwd?: string; hook_event_name?: string };
    const sid = input.session_id?.trim();
    if (!sid) return "";
    const name = input.hook_event_name || event;
    store = new LingxiStore({ mirrorVault: false });
    const key = `${agent}:${sid}`;
    const prev = getPresence(store.db, key);
    const me = upsertPresence(store.db, {
      key,
      agent,
      session_native: sid,
      cwd: input.cwd ?? prev?.cwd ?? null,
      // keep the stronger liveness source if the MCP server / extension already registered this session
      via: prev && prev.via !== "hook" ? prev.via! : "hook",
    });
    if (name !== "UserPromptSubmit" && name !== "SessionStart") return "";
    const msgs = inboxFor(store.db, me);
    if (!msgs.length) return "";
    markRead(store.db, me.key, msgs.map((m) => m.id));
    const additionalContext = `[Lingxi] Messages from other agent sessions arrived:\n\n${fmtInbox(msgs)}`;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: name, additionalContext } });
  } catch {
    return "";
  } finally {
    store?.close();
  }
}
