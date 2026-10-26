import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LingxiStore, activityReport, fmtActivity, listSessions, readSession, resolveSessionRef, searchSessions, shortRef } from "../src/core/index.js";
import { Ingestor, claudeAdapter, codexAdapter, doubaoAdapter, piAdapter, redact, workbuddyAdapter } from "../src/ingest/index.js";

let tmp: string;
let store: LingxiStore;
let dirs: { claude: string; codex: string; pi: string; doubao: string; workbuddy: string; project: string };

const jl = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
const T = (min: number) => new Date(Date.now() - 60 * 60_000 + min * 60_000).toISOString();

function ingestor() {
  return new Ingestor(store, [claudeAdapter(dirs.claude), codexAdapter(dirs.codex), piAdapter(dirs.pi), doubaoAdapter(dirs.doubao), workbuddyAdapter(dirs.workbuddy)]);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lingxi-ingest-"));
  dirs = { claude: join(tmp, "claude"), codex: join(tmp, ".codex"), pi: join(tmp, "pi"), doubao: join(tmp, "doubao"), workbuddy: join(tmp, "wb"), project: join(tmp, "proj") };
  mkdirSync(dirs.project, { recursive: true });
  store = new LingxiStore({ home: join(tmp, "home") });

  // Claude Code
  const cdir = join(dirs.claude, "D--proj");
  mkdirSync(cdir, { recursive: true });
  writeFileSync(
    join(cdir, "aaaaaaaa-1111-4222-8333-444444444444.jsonl"),
    jl(
      { type: "permission-mode", permissionMode: "default" },
      { type: "user", cwd: dirs.project, timestamp: T(1), message: { role: "user", content: "排查导出 PDF 中文乱码的问题" } },
      { type: "assistant", timestamp: T(2), message: { role: "assistant", content: [{ type: "thinking", thinking: "secret thoughts" }, { type: "text", text: "原因是缺少中文字体 NotoSansCJK。" }, { type: "tool_use", name: "Bash", input: { command: "fc-list" } }] } },
      { type: "user", timestamp: T(3), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "DejaVuSans.ttf" }] } },
      { type: "user", isSidechain: true, timestamp: T(3), message: { role: "user", content: "sidechain should be skipped" } },
      { type: "ai-title", aiTitle: "Fix PDF Chinese font" },
    ),
  );

  // Codex
  const xdir = join(dirs.codex, "sessions", "2026", "10", "23");
  mkdirSync(xdir, { recursive: true });
  writeFileSync(
    join(xdir, "rollout-2026-10-23T10-00-00-01a16000-0000-7000-8000-bbbbbbbbbbbb.jsonl"),
    jl(
      { type: "session_meta", timestamp: T(10), payload: { id: "01a16000-0000-7000-8000-bbbbbbbbbbbb", cwd: dirs.project, originator: "codex-tui" } },
      { type: "response_item", timestamp: T(10), payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "dev instructions" }] } },
      { type: "response_item", timestamp: T(10), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>x</cwd>" }] } },
      { type: "response_item", timestamp: T(11), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "实现导出接口，api_key=sk-abcdefghijklmnopqrstuvwxyz123456" }] } },
      { type: "response_item", timestamp: T(12), payload: { type: "reasoning", summary: [] } },
      { type: "response_item", timestamp: T(12), payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"npm test\"}" } },
      { type: "response_item", timestamp: T(13), payload: { type: "function_call_output", output: "10 passed" } },
      { type: "response_item", timestamp: T(14), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "导出接口已完成，使用 Playwright 渲染。" }] } },
    ),
  );
  writeFileSync(join(dirs.codex, "session_index.jsonl"), jl({ id: "01a16000-0000-7000-8000-bbbbbbbbbbbb", thread_name: "导出接口实现" }));

  // pi
  const pdir = join(dirs.pi, "--D--proj--");
  mkdirSync(pdir, { recursive: true });
  writeFileSync(
    join(pdir, "2026-10-23T02-00-00-000Z_01a16001-0000-7000-8000-cccccccccccc.jsonl"),
    jl(
      { type: "session", id: "01a16001-0000-7000-8000-cccccccccccc", timestamp: T(20), cwd: join(dirs.project, "sub") },
      { type: "session_info", name: "PDF 方案调研" },
      { type: "message", timestamp: T(21), message: { role: "user", content: [{ type: "text", text: "调研 PDF 渲染方案" }] } },
      { type: "message", timestamp: T(22), message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }, { type: "toolCall", name: "web_search", arguments: { q: "pdf" } }] } },
      { type: "message", timestamp: T(23), message: { role: "toolResult", toolName: "web_search", content: [{ type: "text", text: "results…" }] } },
      { type: "message", timestamp: T(24), message: { role: "assistant", content: [{ type: "text", text: "推荐 Playwright，wkhtmltopdf 已停止维护。" }] } },
    ),
  );
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("ingestion", () => {
  it("imports all three formats with titles, cwd and filtered turns", () => {
    const r = ingestor().sync();
    expect(r.agents.map((a) => [a.agent, a.newSessions, a.errors.length])).toEqual([
      ["claude-code", 1, 0],
      ["codex", 1, 0],
      ["pi", 1, 0],
      ["doubao", 0, 0],
      ["workbuddy", 0, 0],
    ]);
    const all = listSessions(store.db, { limit: 10 });
    const byAgent = Object.fromEntries(all.map((s) => [s.agent, s]));
    expect(byAgent["claude-code"]!.title).toBe("Fix PDF Chinese font");
    expect(byAgent["codex"]!.title).toBe("导出接口实现");
    expect(byAgent["pi"]!.title).toBe("PDF 方案调研");
    expect(byAgent["claude-code"]!.turn_count).toBe(4); // user, assistant, tool_call, tool_result (no thinking, no sidechain)
    expect(byAgent["codex"]!.turn_count).toBe(4); // user (injected/developer skipped), tool_call, tool_result, assistant
    expect(byAgent["pi"]!.turn_count).toBe(4);

    const txt = store.db.prepare("SELECT group_concat(text, '|') AS t FROM turns").get() as { t: string };
    expect(txt.t).not.toContain("secret thoughts");
    expect(txt.t).not.toContain("sidechain");
    expect(txt.t).not.toContain("environment_context");
    expect(txt.t).not.toContain("sk-abcdefghijklmnop"); // redacted
  });

  it("is incremental and handles partial lines and truncation", () => {
    const ing = ingestor();
    ing.sync();
    expect(ing.sync().agents.every((a) => a.changedFiles === 0)).toBe(true);

    const file = join(dirs.pi, "--D--proj--", "2026-10-23T02-00-00-000Z_01a16001-0000-7000-8000-cccccccccccc.jsonl");
    const line = JSON.stringify({ type: "message", timestamp: T(30), message: { role: "user", content: [{ type: "text", text: "补充：需要支持横版" }] } });
    appendFileSync(file, line.slice(0, 20)); // partial line: nothing new yet
    ing.sync();
    expect(resolveSessionRef(store.db, "pi:cccccccccccc").session.turn_count).toBe(4);
    appendFileSync(file, line.slice(20) + "\n");
    ing.sync();
    expect(resolveSessionRef(store.db, "pi:cccccccccccc").session.turn_count).toBe(5);

    writeFileSync(file, jl({ type: "message", timestamp: T(40), message: { role: "user", content: [{ type: "text", text: "重写后的会话" }] } }));
    ing.sync();
    const s = resolveSessionRef(store.db, "pi:cccccccccccc").session;
    expect(s.turn_count).toBe(1);
  });
});

describe("queries", () => {
  beforeEach(() => ingestor().sync());

  it("short refs are suffix-based and resolve by prefix or suffix", () => {
    const s = resolveSessionRef(store.db, "codex:bbbbbbbbbbbb").session;
    expect(shortRef(s)).toBe("codex:bbbbbbbbbbbb");
    expect(resolveSessionRef(store.db, "01a16000").session.id).toBe(s.id);
    expect(() => resolveSessionRef(store.db, "01a1600")).toThrow(/Ambiguous/); // codex + pi share the time prefix
    const r = resolveSessionRef(store.db, "pi:cccccccccccc#2..3");
    expect([r.from, r.to]).toEqual([2, 3]);
  });

  it("searches transcripts (CJK long/short terms, agent and project filters)", () => {
    expect(searchSessions(store.db, "Playwright").map((h) => h.agent).sort()).toEqual(["codex", "pi"]);
    expect(searchSessions(store.db, "乱码")).toHaveLength(1); // 2 chars → LIKE
    expect(searchSessions(store.db, "Playwright", { agent: "pi" })).toHaveLength(1);
    expect(searchSessions(store.db, "npm test")).toHaveLength(0); // tool calls excluded by default
    expect(searchSessions(store.db, "npm test", { includeTools: true })).toHaveLength(1);
    expect(searchSessions(store.db, "Playwright", { project: join(dirs.project, "sub") }).map((h) => h.agent)).toEqual(["pi"]);
  });

  it("reads sessions: conversation by default, tools around #seq", () => {
    const whole = readSession(store.db, "claude-code:444444444444");
    expect(whole.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(whole.skippedTools).toBe(2);
    const around = readSession(store.db, "claude-code:444444444444#3", { before: 1, after: 0 });
    expect(around.turns.map((t) => t.seq)).toEqual([2, 3]);
  });

  it("lists sessions by project (cwd inside project)", () => {
    expect(listSessions(store.db, { project: dirs.project }).length).toBe(3);
    expect(listSessions(store.db, { project: join(dirs.project, "sub") }).map((s) => s.agent)).toEqual(["pi"]);
  });

  it("builds an activity report grouped by project with lingxi notes", () => {
    store.createTopic("导出", null, dirs.project);
    store.remember({ kind: "decision", content: "使用 Playwright", topic: "导出", author_agent: "codex" });
    const rep = activityReport(store, { since: Date.now() - 2 * 3600_000, until: Date.now(), git: false });
    expect(rep.projects).toHaveLength(1);
    const p = rep.projects[0]!;
    expect(p.sessions.length).toBe(3);
    expect(p.notes.map((n) => n.text)).toEqual(["使用 Playwright"]);
    const text = fmtActivity(rep);
    expect(text).toContain("导出接口实现");
    expect(text).toContain("asked:");
    expect(text).toContain("{导出} [decision] 使用 Playwright");
  });

  it("topic overview lists recent sessions of bound projects", () => {
    store.createTopic("导出", null, dirs.project);
    expect(store.topicOverview("导出").recentSessions.length).toBe(3);
  });
});

describe("redact", () => {
  it("masks common secrets", () => {
    expect(redact("key sk-ant-abcdefghijklmnopqrstu and Bearer abcdefghijklmnopqrstuvwxyz")).toBe("key sk-*** and Bearer ***");
    expect(redact('password: "hunter2hunter2"')).toBe('password: "***"');
    expect(redact("https://x.ai/mcp?exaApiKey=0a1b2c3d-4e5f-6789")).toBe("https://x.ai/mcp?exaApiKey=***");
  });
});
