import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LingxiStore } from "../src/core/index.js";
import { consultPrompt, consultSession, estimateConsult, findExecutable } from "../src/consult/index.js";
import { Ingestor, doubaoAdapter, piAdapter, codexAdapter } from "../src/ingest/index.js";

/**
 * Background consultation with fake `pi` / `codex` executables on PATH (no real model calls).
 * The fakes record their argv + stdin, print an answer, then linger like real CLIs waiting on hooks.
 */
let tmp: string;
let store: LingxiStore;
let bin: string;
let oldPath: string | undefined;
let piFile: string;

const jl = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";

function fakeCli(name: string, js: string) {
  const script = join(bin, `${name}-fake.mjs`);
  writeFileSync(script, js);
  if (process.platform === "win32") {
    writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const sh = join(bin, name);
    writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(sh, 0o755);
  }
}

const RECORDER = (marker: string, body: string) => `
import { readFileSync, writeFileSync } from "node:fs";
const stdin = readFileSync(0, "utf8");
writeFileSync(process.env.FAKE_LOG_${marker}, JSON.stringify({ argv: process.argv.slice(2), stdin }));
${body}
setTimeout(() => {}, 60000); // linger like a CLI waiting on hooks / notify processes
`;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lingxi-consult-test-"));
  bin = join(tmp, "bin");
  mkdirSync(bin);
  oldPath = process.env.PATH;
  process.env.PATH = bin + delimiter + (process.env.PATH ?? "");
  process.env.FAKE_LOG_PI = join(tmp, "pi-log.json");
  process.env.FAKE_LOG_CODEX = join(tmp, "codex-log.json");

  fakeCli(
    "pi",
    RECORDER(
      "PI",
      `console.log(JSON.stringify({ type: "turn_end", message: { role: "assistant", content: [{ type: "text", text: "方案B的测试条件是 4 核 8G" }], usage: { input: 10, cacheWrite: 90, output: 20, cost: { total: 0.0123 } } } }));
console.log(JSON.stringify({ type: "agent_end" }));`,
    ),
  );
  fakeCli(
    "codex",
    RECORDER(
      "CODEX",
      `const o = process.argv.indexOf("-o"); if (o > 0) writeFileSync(process.argv[o + 1], "ho_123");
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ho_123" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 500, output_tokens: 5 } }));`,
    ),
  );

  store = new LingxiStore({ home: join(tmp, "home") });
  const pdir = join(tmp, "pi", "--proj--");
  mkdirSync(pdir, { recursive: true });
  piFile = join(pdir, "2026-10-23T02-00-00-000Z_01a16001-0000-7000-8000-cccccccccccc.jsonl");
  writeFileSync(
    piFile,
    jl(
      { type: "session", id: "01a16001-0000-7000-8000-cccccccccccc", timestamp: new Date().toISOString(), cwd: tmp },
      { type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "调研 PDF 方案" }] } },
    ),
  );
  const xdir = join(tmp, ".codex", "sessions", "2026", "10", "23");
  mkdirSync(xdir, { recursive: true });
  writeFileSync(
    join(xdir, "rollout-2026-10-23T10-00-00-01a16000-0000-7000-8000-bbbbbbbbbbbb.jsonl"),
    jl(
      { type: "session_meta", timestamp: new Date().toISOString(), payload: { id: "01a16000-0000-7000-8000-bbbbbbbbbbbb", cwd: tmp } },
      { type: "response_item", timestamp: new Date().toISOString(), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "保存交接" }] } },
    ),
  );
  const ddir = join(tmp, "doubao", "1001", "agents", "m", "system");
  mkdirSync(ddir, { recursive: true });
  writeFileSync(join(ddir, "trajectory.jsonl"), jl({ role: "user", content: "hello" }));
  writeFileSync(join(ddir, "assignment.md"), "- Role: main\n");

  new Ingestor(store, [piAdapter(join(tmp, "pi")), codexAdapter(join(tmp, ".codex")), doubaoAdapter(join(tmp, "doubao"))]).sync();
});

afterEach(() => {
  process.env.PATH = oldPath;
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("consult", () => {
  it("wraps the question as a read-only consultation", () => {
    const p = consultPrompt("方案B的测试条件？");
    expect(p).toContain("只读咨询");
    expect(p).toContain("不要调用工具");
    expect(p.endsWith("方案B的测试条件？")).toBe(true);
  });

  it("estimates size and rejects agents without a headless CLI", () => {
    const e = estimateConsult(store, "pi:cccccccccccc");
    expect(e.supported).toBe(true);
    expect(e.approxTokens).toBeGreaterThan(0);
    const d = estimateConsult(store, "doubao:1001");
    expect(d.supported).toBe(false);
    expect(d.reason).toMatch(/read_session/);
  });

  it("finds fake executables on PATH", () => {
    expect(findExecutable("pi")?.path.startsWith(bin)).toBe(true);
  });

  it("consults pi on a temporary copy with all tools disabled, without waiting for lingering processes", async () => {
    const before = readFileSync(piFile, "utf8");
    const t0 = Date.now();
    const r = await consultSession(store, "pi:cccccccccccc", "方案B的测试条件？", { timeoutMs: 30_000 });
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.answer).toBe("方案B的测试条件是 4 核 8G");
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20, costUsd: 0.0123 });
    const log = JSON.parse(readFileSync(process.env.FAKE_LOG_PI!, "utf8")) as { argv: string[]; stdin: string };
    expect(log.argv).toContain("--no-tools");
    expect(log.argv).toContain("--no-mcp");
    const sessionArg = log.argv[log.argv.indexOf("--session") + 1]!;
    expect(sessionArg).not.toBe(piFile); // a temporary copy, never the original
    expect(log.stdin).toContain("方案B的测试条件？");
    expect(readFileSync(piFile, "utf8")).toBe(before);
  }, 40_000);

  it("consults codex with exec fork --ephemeral in a read-only sandbox", async () => {
    const r = await consultSession(store, "codex:bbbbbbbbbbbb", "交接包 id？", { timeoutMs: 30_000 });
    expect(r.answer).toBe("ho_123");
    expect(r.usage.inputTokens).toBe(500);
    const log = JSON.parse(readFileSync(process.env.FAKE_LOG_CODEX!, "utf8")) as { argv: string[] };
    expect(log.argv.slice(0, 3)).toEqual(["exec", "fork", "01a16000-0000-7000-8000-bbbbbbbbbbbb"]);
    expect(log.argv).toContain("--ephemeral");
    expect(log.argv).toContain("sandbox_mode=read-only");
    expect(log.argv[log.argv.length - 1]).toBe("-"); // prompt via stdin
  }, 40_000);

  it("times out", async () => {
    fakeCli("pi", RECORDER("PI", "")); // never answers
    await expect(consultSession(store, "pi:cccccccccccc", "q", { timeoutMs: 2000 })).rejects.toThrow(/timed out/);
  }, 20_000);
});
