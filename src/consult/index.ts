import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { LingxiError } from "../core/errors.js";
import { resolveSessionRef, shortRef, type SessionInfo } from "../core/sessions.js";
import type { LingxiStore } from "../core/store.js";

export const CONSULT_AGENTS = ["claude-code", "codex", "pi"] as const;

export interface ConsultEstimate {
  session: SessionInfo;
  ref: string;
  supported: boolean;
  reason?: string;
  /** Size of the transcript file — the context a forked copy has to reload. */
  sourceBytes: number;
  /** Rough token estimate of that context (bytes / 4; CJK-heavy transcripts are closer to bytes / 3). */
  approxTokens: number;
}

export interface ConsultOptions {
  timeoutMs?: number;
  model?: string;
  /** Claude Code only: hard spending cap. */
  maxBudgetUsd?: number;
}

export interface ConsultResult {
  answer: string;
  ref: string;
  agent: string;
  ms: number;
  usage: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

export function consultPrompt(question: string): string {
  return [
    "【灵犀只读咨询 / Lingxi read-only consultation】",
    "这条消息来自另一个会话，经灵犀转发，不是用户布置的新任务。请只根据本会话已有的上下文回答；不要调用工具、不要执行命令、不要修改任何文件。",
    "如果上下文里没有足够信息，直接说明不知道，不要猜测。回答简洁，必要时指出依据在会话的哪部分。",
    "This message is forwarded from another session by Lingxi and is not a new task. Answer only from the existing context of this session; do not call tools, run commands or modify files. If the context does not contain the answer, say so.",
    "",
    "问题 / Question:",
    question.trim(),
  ].join("\n");
}

export function estimateConsult(store: LingxiStore, ref: string): ConsultEstimate {
  const { session } = resolveSessionRef(store.db, ref);
  let sourceBytes = 0;
  try {
    sourceBytes = statSync(session.source_path).size;
  } catch {
    /* file gone */
  }
  const supported = (CONSULT_AGENTS as readonly string[]).includes(session.agent);
  return {
    session,
    ref: shortRef(session),
    supported,
    reason: supported
      ? undefined
      : `${session.agent} has no headless CLI to fork a session; use read_session / search_sessions and answer from the transcript instead.`,
    sourceBytes,
    approxTokens: Math.round(sourceBytes / 4),
  };
}

// ───────────────────────────── process helpers ─────────────────────────────

/** Find an executable on PATH; on Windows prefer .exe, fall back to .cmd shims (npm). */
export function findExecutable(name: string): { path: string; shim: boolean } | null {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const ext of exts) {
    for (const d of dirs) {
      const p = join(d, name + ext);
      if (existsSync(p)) return { path: p, shim: ext === ".cmd" || ext === ".bat" };
    }
  }
  return null;
}

const quoteCmd = (a: string) => (a === "" ? '""' : /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a CLI with the prompt on stdin. `doneMarker`: once this text appears on stdout the answer is complete;
 * the process gets a short grace period and is then killed (some CLIs linger after finishing, e.g. waiting on hooks).
 */
function run(name: string, args: string[], opts: { cwd?: string; input: string; timeoutMs: number; doneMarker?: RegExp }): Promise<RunResult> {
  const exe = findExecutable(name);
  if (!exe) throw new LingxiError(`${name} not found on PATH`);
  return new Promise((resolve) => {
    // .cmd shims need a shell on Windows; the question goes through stdin, so only simple, quoted args reach cmd.exe.
    const child = exe.shim
      ? spawn(`"${exe.path}" ${args.map(quoteCmd).join(" ")}`, { cwd: opts.cwd, shell: true, windowsHide: true })
      : spawn(exe.path, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let answered = false;
    let settled = false;
    let graceTimer: NodeJS.Timeout | null = null;
    const killTree = () => {
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill("SIGKILL");
    };
    // Resolve once. Do not wait for "close": detached grandchildren (e.g. notify hooks) may keep stdout open for minutes.
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve({ code: answered && !timedOut ? 0 : code, stdout, stderr, timedOut });
    };
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      if (opts.doneMarker && !answered && opts.doneMarker.test(stdout)) {
        answered = true;
        graceTimer = setTimeout(() => {
          killTree();
          finish(0);
        }, 3000);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      finish(null);
    }, opts.timeoutMs);
    child.on("error", (err) => {
      stderr += String(err);
      finish(-1);
    });
    child.on("exit", (code) => setTimeout(() => finish(code), 300));
    child.on("close", (code) => finish(code));
    child.stdin.end(opts.input, "utf8");
  });
}

const jsonLines = (s: string): Record<string, unknown>[] =>
  s
    .split(/\r?\n/)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object");

function fail(agent: string, r: RunResult, timeoutMs: number): never {
  if (r.timedOut) throw new LingxiError(`${agent} consultation timed out after ${Math.round(timeoutMs / 1000)}s`);
  const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join("\n");
  throw new LingxiError(`${agent} consultation failed (exit ${r.code}): ${tail || "no output"}`);
}

// ───────────────────────────── per-agent runners ─────────────────────────────

/** pi: continue a temporary copy of the session file; --fork cannot be combined with --no-session. */
async function consultPi(s: SessionInfo, prompt: string, o: Required<Pick<ConsultOptions, "timeoutMs">> & ConsultOptions) {
  const dir = mkdtempSync(join(tmpdir(), "lingxi-consult-"));
  try {
    const copy = join(dir, "consult.jsonl");
    copyFileSync(s.source_path, copy);
    const args = ["-p", "--session", copy, "--session-dir", dir, "--no-tools", "--no-mcp", "--no-skills", "--no-extensions", "--no-context-files", "--mode", "json"];
    if (o.model) args.push("--model", o.model);
    const r = await run("pi", args, { cwd: s.cwd && existsSync(s.cwd) ? s.cwd : undefined, input: prompt, timeoutMs: o.timeoutMs, doneMarker: /"type":"agent_end"/ });
    if (r.code !== 0 || r.timedOut) fail("pi", r, o.timeoutMs);
    let answer = "";
    const usage: ConsultResult["usage"] = {};
    for (const ev of jsonLines(r.stdout)) {
      if (ev.type !== "turn_end") continue;
      const m = ev.message as { content?: { type: string; text?: string }[]; usage?: { input?: number; output?: number; cacheWrite?: number; cacheRead?: number; cost?: { total?: number } } };
      answer = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim() || answer;
      if (m.usage) {
        usage.inputTokens = (m.usage.input ?? 0) + (m.usage.cacheWrite ?? 0) + (m.usage.cacheRead ?? 0);
        usage.outputTokens = m.usage.output;
        usage.costUsd = m.usage.cost?.total;
      }
    }
    if (!answer) fail("pi", { ...r, stderr: r.stderr || "no answer in output" }, o.timeoutMs);
    return { answer, usage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Codex: `exec fork --ephemeral` in a read-only sandbox; prompt via stdin ("-"). */
async function consultCodex(s: SessionInfo, prompt: string, o: Required<Pick<ConsultOptions, "timeoutMs">> & ConsultOptions) {
  const dir = mkdtempSync(join(tmpdir(), "lingxi-consult-"));
  try {
    const last = join(dir, "last.txt");
    const args = ["exec", "fork", s.native_id, "--ephemeral", "--skip-git-repo-check", "-c", "sandbox_mode=read-only", "-c", "approval_policy=never", "--json", "-o", last];
    if (o.model) args.push("-m", o.model);
    args.push("-");
    const r = await run("codex", args, { cwd: s.cwd && existsSync(s.cwd) ? s.cwd : undefined, input: prompt, timeoutMs: o.timeoutMs, doneMarker: /"type":\s*"turn\.(completed|failed)"/ });
    if (r.code !== 0 || r.timedOut) fail("codex", r, o.timeoutMs);
    let answer = existsSync(last) ? readFileSync(last, "utf8").trim() : "";
    const usage: ConsultResult["usage"] = {};
    for (const ev of jsonLines(r.stdout)) {
      if (ev.type === "turn.completed" && ev.usage && typeof ev.usage === "object") {
        const u = ev.usage as { input_tokens?: number; output_tokens?: number };
        usage.inputTokens = u.input_tokens;
        usage.outputTokens = u.output_tokens;
      }
      if (!answer && ev.type === "item.completed") {
        const item = ev.item as { type?: string; text?: string } | undefined;
        if (item?.type === "agent_message" && item.text) answer = item.text.trim();
      }
    }
    if (!answer) fail("codex", { ...r, stderr: r.stderr || "no answer in output" }, o.timeoutMs);
    return { answer, usage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Claude Code: resume + fork without persisting, all tools disabled. Must run in the session's project dir. */
async function consultClaude(s: SessionInfo, prompt: string, o: Required<Pick<ConsultOptions, "timeoutMs">> & ConsultOptions) {
  const args = ["-p", "--resume", s.native_id, "--fork-session", "--no-session-persistence", "--tools", "", "--output-format", "json"];
  if (o.model) args.push("--model", o.model);
  if (o.maxBudgetUsd) args.push("--max-budget-usd", String(o.maxBudgetUsd));
  if (!s.cwd || !existsSync(s.cwd)) throw new LingxiError(`Claude Code session directory not found: ${s.cwd ?? "(unknown)"}`);
  const r = await run("claude", args, { cwd: s.cwd, input: prompt, timeoutMs: o.timeoutMs, doneMarker: /"type":\s*"result"/ });
  const out = jsonLines(r.stdout).pop() as { result?: string; is_error?: boolean; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } } | undefined;
  if (r.code !== 0 || r.timedOut || !out || out.is_error || !out.result) {
    fail("claude-code", { ...r, stderr: r.stderr || (out?.result ?? "") }, o.timeoutMs);
  }
  const u = out.usage ?? {};
  return {
    answer: out.result.trim(),
    usage: {
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      costUsd: out.total_cost_usd,
    },
  };
}

/** Ask a forked, read-only, non-persisted copy of a past session. Costs model tokens. */
export async function consultSession(store: LingxiStore, ref: string, question: string, opts: ConsultOptions = {}): Promise<ConsultResult> {
  const est = estimateConsult(store, ref);
  if (!est.supported) throw new LingxiError(est.reason!);
  if (!question.trim()) throw new LingxiError("Question must not be empty");
  const o = { timeoutMs: opts.timeoutMs ?? 180_000, ...opts };
  const prompt = consultPrompt(question);
  const t0 = Date.now();
  const s = est.session;
  const r = s.agent === "pi" ? await consultPi(s, prompt, o) : s.agent === "codex" ? await consultCodex(s, prompt, o) : await consultClaude(s, prompt, o);
  return { answer: r.answer, usage: r.usage, ref: est.ref, agent: s.agent, ms: Date.now() - t0 };
}

export function fmtEstimate(e: ConsultEstimate): string {
  const kb = Math.round(e.sourceBytes / 1024);
  return (
    `Session ${e.ref} — ${e.session.title ?? "(untitled)"}\n` +
    `agent: ${e.session.agent} | ${e.session.turn_count} turns | transcript ${kb} KB → up to ≈${e.approxTokens.toLocaleString()} tokens of context to reload (usually less; prompt caching may apply)` +
    (e.supported ? "" : `\nNot supported: ${e.reason}`)
  );
}

export function fmtConsult(r: ConsultResult): string {
  const u = r.usage;
  const parts = [
    `${(r.ms / 1000).toFixed(1)}s`,
    u.inputTokens !== undefined ? `in ${u.inputTokens.toLocaleString()} tok` : null,
    u.outputTokens !== undefined ? `out ${u.outputTokens.toLocaleString()} tok` : null,
    u.costUsd !== undefined ? `$${u.costUsd.toFixed(4)}` : null,
  ].filter(Boolean);
  return `${r.answer}\n\n— answered by a read-only background copy of ${r.ref} (${parts.join(", ")}); the original session was not modified.`;
}
