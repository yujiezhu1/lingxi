import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LingxiStore, upsertPresence } from "../src/core/index.js";
import { startUiServer, type UiServer } from "../src/ui/server.js";

let home: string;
let web: string;
let ui: UiServer;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "lingxi-ui-"));
  web = join(home, "web");
  mkdirSync(join(web, "assets"), { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>lingxi</title>");
  writeFileSync(join(web, "assets", "app.js"), "console.log(1)");
  process.env.LINGXI_INGEST = "none";
  const s = new LingxiStore({ home });
  s.saveHandoff({ title: "导出需求结论", body_md: "## 目标\n导出 PDF", topic: "导出需求", author_agent: "doubao" });
  s.remember({ kind: "decision", content: "使用 Playwright 渲染", topic: "导出需求" });
  upsertPresence(s.db, { key: "pi:abc", agent: "pi", session_native: "abc", cwd: "D:/proj", via: "pi-extension", label: "research-pdf" });
  s.close();
  ui = await startUiServer({ home, webRoot: web, syncIntervalMs: 0, token: "test-token" });
});

afterAll(async () => {
  await ui.close();
  delete process.env.LINGXI_INGEST;
  rmSync(home, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${ui.port}`;
const get = (path: string, headers: Record<string, string> = { "x-lingxi-token": "test-token" }) => fetch(`${base()}${path}`, { headers });

describe("UI server", () => {
  it("serves the SPA with fallback and blocks path traversal", async () => {
    expect(await (await get("/", {})).text()).toContain("<title>lingxi</title>");
    expect(await (await get("/topics/whatever", {})).text()).toContain("<title>lingxi</title>");
    expect((await get("/assets/app.js", {})).headers.get("content-type")).toContain("javascript");
    const r = await get("/..%2F..%2Fpackage.json", {});
    expect(await r.text()).toContain("<title>lingxi</title>");
  });

  it("requires the token for the API", async () => {
    expect((await get("/api/status", {})).status).toBe(401);
    expect((await get("/api/status?token=wrong", {})).status).toBe(401);
    expect((await get("/api/status?token=test-token", {})).status).toBe(200);
  });

  it("returns data for the main endpoints", async () => {
    const status = (await (await get("/api/status")).json()) as { topics: number; handoffs: number; online: number };
    expect(status).toMatchObject({ topics: 1, handoffs: 1, online: 1 });
    const topics = (await (await get("/api/topics")).json()) as { id: string; name: string }[];
    expect(topics[0]!.name).toBe("导出需求");
    const ov = (await (await get(`/api/topics/${encodeURIComponent(topics[0]!.id)}`)).json()) as { latestHandoff: { title: string }; cards: unknown[] };
    expect(ov.latestHandoff.title).toBe("导出需求结论");
    expect(ov.cards).toHaveLength(1);
    const tl = (await (await get(`/api/topics/${encodeURIComponent(topics[0]!.id)}/timeline`)).json()) as unknown[];
    expect(tl.length).toBeGreaterThanOrEqual(3);
    const search = (await (await get(`/api/search?q=${encodeURIComponent("Playwright")}`)).json()) as { notes: unknown[]; sessions: unknown[] };
    expect(search.notes).toHaveLength(1);
    const today = (await (await get("/api/today?git=0")).json()) as { presence: { label: string }[]; topics: unknown[] };
    expect(today.presence.map((p) => p.label)).toEqual(["research-pdf"]);
    const act = (await (await get("/api/activity?date=today&git=0")).json()) as { markdown: string };
    expect(act.markdown).toContain("导出需求");
    expect((await get("/api/sessions/nope")).status).toBe(404);
    const weave = (await (await get("/api/weave?date=today")).json()) as { knots: { agent: string; type: string }[] };
    expect(weave.knots.map((k) => [k.agent, k.type])).toEqual([["doubao", "handoff"]]);
    expect(Array.isArray(await (await get("/api/projects?since=14d")).json())).toBe(true);
  });

  it("protects state-changing requests (header token + same origin) and sends messages as the user", async () => {
    const post = (body: unknown, headers: Record<string, string>) =>
      fetch(`${base()}/api/messages`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    expect((await fetch(`${base()}/api/messages?token=test-token`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await post({ to: "research-pdf", body: "hi" }, { "x-lingxi-token": "test-token", origin: "http://evil.com" })).status).toBe(403);
    const ok = await post({ to: "research-pdf", body: "请评估方案 B" }, { "x-lingxi-token": "test-token", origin: base() });
    expect(ok.status).toBe(200);
    const msgs = (await (await get("/api/messages")).json()) as { messages: { body: string; from_agent: string }[] };
    expect(msgs.messages[0]).toMatchObject({ body: "请评估方案 B", from_agent: "user" });
  });

  it("streams change events", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base()}/api/events?token=test-token`, { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: hello");
    ctrl.abort();
  });
});
