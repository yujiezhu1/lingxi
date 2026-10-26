import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LingxiStore, getPresence, inboxFor, sendMessage, upsertPresence } from "../src/core/index.js";

/** pi extension with a fake ExtensionAPI: registration, real-time delivery while idle / busy, cleanup. */
let home: string;
let store: LingxiStore;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lingxi-piext-"));
  process.env.LINGXI_HOME = home;
  process.env.LINGXI_PI_POLL_MS = "100";
  store = new LingxiStore({ home });
});
afterEach(() => {
  store.close();
  delete process.env.LINGXI_HOME;
  rmSync(home, { recursive: true, force: true });
});

function fakePi() {
  const handlers = new Map<string, (e: unknown, ctx: unknown) => unknown>();
  const sent: { content: string; options: Record<string, unknown> | undefined }[] = [];
  const commands = new Map<string, unknown>();
  let idle = true;
  const ctx = {
    isIdle: () => idle,
    hasUI: false,
    sessionManager: { getSessionId: () => "01a17000-aaaa-7bbb-8ccc-0123456789ab", getCwd: () => "D:/proj/research" },
  };
  const api = {
    on: (ev: string, h: (e: unknown, c: unknown) => unknown) => handlers.set(ev, h),
    sendMessage: (m: { content: string }, options?: Record<string, unknown>) => sent.push({ content: m.content, options }),
    registerCommand: (name: string, def: unknown) => commands.set(name, def),
  };
  return { api, ctx, handlers, sent, commands, setIdle: (v: boolean) => (idle = v) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("pi extension", () => {
  it("registers the session and delivers messages: new turn when idle, follow-up when busy", async () => {
    const { default: ext } = await import("../src/integrations/pi-extension.js");
    const f = fakePi();
    ext(f.api as never);
    expect(f.commands.has("lingxi")).toBe(true);
    await f.handlers.get("session_start")!({}, f.ctx);

    const me = getPresence(store.db, "pi:01a17000-aaaa-7bbb-8ccc-0123456789ab")!;
    expect(me.via).toBe("pi-extension");
    expect(me.label).toBe("pi-research");

    const dev = upsertPresence(store.db, { key: "codex:d", agent: "codex", session_native: "d", cwd: "D:/proj/shop", via: "mcp" });
    sendMessage(store.db, dev, "pi-research", "项目实际用 FastAPI", { kind: "request" });
    await wait(400);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]!.content).toContain("项目实际用 FastAPI");
    expect(f.sent[0]!.options).toEqual({ triggerTurn: true });
    expect(inboxFor(store.db, me)).toHaveLength(0); // marked as read

    f.setIdle(false);
    sendMessage(store.db, dev, "pi-research", "第二条");
    await wait(400);
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]!.options).toEqual({ deliverAs: "followUp", triggerTurn: true });

    await f.handlers.get("session_shutdown")!({}, f.ctx);
    expect(getPresence(store.db, me.key)).toBeNull();
    sendMessage(store.db, dev, "all", "关闭后");
    await wait(300);
    expect(f.sent).toHaveLength(2); // stopped polling
  });
});
