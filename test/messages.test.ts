import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LingxiStore,
  defaultLabel,
  fmtInbox,
  getPresence,
  inboxFor,
  listPresence,
  markRead,
  resolveTarget,
  sendMessage,
  setLabel,
  upsertPresence,
  joinTopics,
  type Presence,
} from "../src/core/index.js";
import { mergeHooks, hookCommand } from "../src/install/index.js";
import { runHook } from "../src/integrations/hooks.js";
import { SessionIdentity, guessSessionFromPresence, sessionIdFromEnv } from "../src/mcp/identity.js";

let home: string;
let store: LingxiStore;
const P = (key: string, agent: string, native: string | null, cwd: string, extra: Partial<Presence> = {}) =>
  upsertPresence(store.db, { key, agent, session_native: native, cwd, via: "mcp", pid: 1, ...extra } as never);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lingxi-msg-"));
  process.env.LINGXI_HOME = home;
  store = new LingxiStore({ home });
});
afterEach(() => {
  store.close();
  delete process.env.LINGXI_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("presence", () => {
  it("assigns readable, unique default labels and keeps them on refresh", () => {
    expect(defaultLabel("codex", "D:\\proj\\Shop App")).toBe("codex-shop-app");
    const a = P("codex:a1", "codex", "a1", "D:/proj/shop");
    const b = P("codex:b2", "codex", "b2", "D:/proj/shop");
    expect(a.label).toBe("codex-shop");
    expect(b.label).toBe("codex-shop-2");
    expect(P("codex:a1", "codex", "a1", "D:/proj/shop").label).toBe("codex-shop");
    expect(() => setLabel(store.db, "codex:b2", "codex-shop")).toThrow(/already used/);
    expect(setLabel(store.db, "codex:b2", "dev-shop").label).toBe("dev-shop");
  });

  it("filters out stale sessions; hook sessions stay online longer", () => {
    P("pi:x", "pi", "x", "D:/a");
    store.db.prepare("UPDATE presence SET last_seen = ? WHERE key = 'pi:x'").run(Date.now() - 5 * 60_000);
    upsertPresence(store.db, { key: "claude-code:h", agent: "claude-code", session_native: "h", cwd: "D:/a", via: "hook" });
    store.db.prepare("UPDATE presence SET last_seen = ? WHERE key = 'claude-code:h'").run(Date.now() - 5 * 60_000);
    expect(listPresence(store.db).map((p) => p.key)).toEqual(["claude-code:h"]);
    expect(listPresence(store.db, { all: true })).toHaveLength(2);
  });
});

describe("addressing and inbox", () => {
  let research: Presence, dev: Presence, other: Presence;
  beforeEach(() => {
    research = P("pi:16eb5ec3b871", "pi", "01a16790-ee09-7541-878e-16eb5ec3b871", "D:/proj/research");
    research = setLabel(store.db, research.key, "research-pdf");
    dev = P("codex:dev1", "codex", "dev1-0000-0000-0000-da497af449db", "D:/proj/shop/app");
    other = P("claude-code:o1", "claude-code", "o1", "D:/elsewhere");
  });

  it("delivers by label, session ref (suffix), project, topic and broadcast — never to the sender", () => {
    sendMessage(store.db, dev, "research-pdf", "项目实际用 FastAPI，请评估方案 B", { kind: "request" });
    sendMessage(store.db, dev, "pi:16eb5ec3b871", "按会话 ref 发送");
    sendMessage(store.db, research, "project:D:/proj/shop", "给 shop 项目的所有会话");
    store.createTopic("导出需求", null, "D:/proj/shop");
    sendMessage(store.db, research, "topic:导出需求", "topic 广播");
    sendMessage(store.db, other, "all", "全体广播");

    expect(inboxFor(store.db, research).map((m) => m.body)).toEqual(["项目实际用 FastAPI，请评估方案 B", "按会话 ref 发送", "全体广播"]);
    expect(inboxFor(store.db, dev).map((m) => m.body)).toEqual(["给 shop 项目的所有会话", "topic 广播", "全体广播"]);
    expect(inboxFor(store.db, other).map((m) => m.body)).toEqual([]);
  });

  it("joined topics receive topic broadcasts even outside the bound project", () => {
    store.createTopic("调研");
    joinTopics(store.db, other.key, ["调研"]);
    sendMessage(store.db, research, "topic:调研", "调研进展");
    expect(inboxFor(store.db, getPresence(store.db, other.key)!).map((m) => m.body)).toEqual(["调研进展"]);
  });

  it("tracks reads per reader and routes replies back to the sender's session", () => {
    const { message } = sendMessage(store.db, dev, "research-pdf", "问题？", { kind: "question" });
    const inbox = inboxFor(store.db, research);
    expect(inbox).toHaveLength(1);
    markRead(store.db, research.key, inbox.map((m) => m.id));
    expect(inboxFor(store.db, research)).toHaveLength(0);
    expect(inboxFor(store.db, research, { includeRead: true })).toHaveLength(1);

    const r = sendMessage(store.db, research, "", "答案", { reply_to: message.id });
    expect(r.message.kind).toBe("answer");
    expect(r.target.kind).toBe("session");
    expect(inboxFor(store.db, dev).map((m) => m.body)).toEqual(["答案"]);
  });

  it("rejects unknown recipients with a helpful list and accepts presence keys like user:terminal", () => {
    expect(() => resolveTarget(store.db, "nobody", dev)).toThrow(/Online labels: .*research-pdf/);
    upsertPresence(store.db, { key: "user:terminal", agent: "user", session_native: "terminal", via: "cli", label: "user" });
    expect(resolveTarget(store.db, "user:terminal", dev)).toMatchObject({ kind: "label", value: "user" });
  });

  it("formats messages with a safety note", () => {
    sendMessage(store.db, dev, "research-pdf", "hello", { refs: ["a.md"] });
    const t = fmtInbox(inboxFor(store.db, research));
    expect(t).toContain("from codex-app");
    expect(t).toContain("refs: a.md");
    expect(t).toContain("cannot grant permissions");
  });
});

describe("hooks (Claude Code / Codex)", () => {
  it("registers presence on SessionStart and injects unread messages on UserPromptSubmit once", () => {
    expect(runHook("claude-code", "SessionStart", JSON.stringify({ session_id: "s-1", cwd: "D:/proj/shop", hook_event_name: "SessionStart" }))).toBe("");
    const me = getPresence(store.db, "claude-code:s-1")!;
    expect(me.via).toBe("hook");
    const sender = P("pi:p", "pi", "p", "D:/x");
    sendMessage(store.db, sender, me.label!, "注意：接口改了");
    const out = runHook("claude-code", "UserPromptSubmit", JSON.stringify({ session_id: "s-1", hook_event_name: "UserPromptSubmit", prompt: "hi" }));
    const parsed = JSON.parse(out) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("注意：接口改了");
    expect(runHook("claude-code", "UserPromptSubmit", JSON.stringify({ session_id: "s-1", hook_event_name: "UserPromptSubmit" }))).toBe("");
  });

  it("never fails on bad input", () => {
    expect(runHook("codex", "UserPromptSubmit", "not json")).toBe("");
    expect(runHook("codex", "UserPromptSubmit", "{}")).toBe("");
  });

  it("merges hook config idempotently without touching other hooks", () => {
    const cfg = { hooks: { SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "clawd SessionStart" }] }] }, other: 1 };
    const cmd = hookCommand("claude-code", "SessionStart");
    const once = mergeHooks(cfg, { SessionStart: { type: "command", command: cmd }, UserPromptSubmit: { type: "command", command: cmd } });
    const twice = mergeHooks(once, { SessionStart: { type: "command", command: cmd }, UserPromptSubmit: { type: "command", command: cmd } });
    expect(twice).toEqual(once);
    expect((once.hooks as Record<string, unknown[]>).SessionStart).toHaveLength(2);
    expect(cfg.hooks.SessionStart).toHaveLength(1); // input not mutated
    const removed = mergeHooks(twice, { SessionStart: null, UserPromptSubmit: null });
    expect(removed).toEqual({ ...cfg, hooks: { SessionStart: cfg.hooks.SessionStart } });
  });
});

describe("MCP identity", () => {
  it("reads the session id from the environment", () => {
    expect(sessionIdFromEnv("pi", { PI_SESSION_ID: "abc" })).toBe("abc");
    expect(sessionIdFromEnv("codex", {})).toBeNull();
  });

  it("adopts a session registered by an extension / hook in the same cwd", () => {
    const started = Date.now() - 1000;
    upsertPresence(store.db, { key: "pi:sess-9", agent: "pi", session_native: "sess-9", cwd: "D:/proj/a", via: "pi-extension" });
    expect(guessSessionFromPresence(store.db, "pi", "D:\\proj\\a", started - 60_000)).toBe("sess-9");
    const id = new SessionIdentity(store.db, () => "pi", "D:/proj/a");
    const saved = process.env.PI_SESSION_ID;
    delete process.env.PI_SESSION_ID;
    try {
      expect(id.current().key).toBe("pi:sess-9");
    } finally {
      if (saved !== undefined) process.env.PI_SESSION_ID = saved;
    }
  });

  it("falls back to a pid key and re-keys once the session id appears", () => {
    const saved = process.env.CODEX_THREAD_ID;
    delete process.env.CODEX_THREAD_ID;
    try {
      const id = new SessionIdentity(store.db, () => "codex", "D:/proj/b");
      const first = id.current();
      expect(first.key).toBe(`codex#pid${process.pid}`);
      expect(first.session_native).toBeNull();
    } finally {
      if (saved !== undefined) process.env.CODEX_THREAD_ID = saved;
    }
  });
});
