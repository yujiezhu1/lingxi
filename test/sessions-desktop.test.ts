import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LingxiStore, activityReport, listSessions, resolveSessionRef, searchSessions, shortRef } from "../src/core/index.js";
import { Ingestor, doubaoAdapter, workbuddyAdapter } from "../src/ingest/index.js";
import { parseAssignment } from "../src/ingest/doubao.js";
import { workbuddyUserText } from "../src/ingest/workbuddy.js";

let tmp: string;
let store: LingxiStore;
let doubaoDir: string;
let wbDir: string;

const jl = (...objs: unknown[]) => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
/** ISO timestamp with nanoseconds, like Doubao's assignment.md */
const BASE = Date.now() - 2 * 3600_000;
const iso = (min: number) => new Date(BASE + min * 60_000).toISOString().replace("Z", "123456Z");

const ingestor = () => new Ingestor(store, [doubaoAdapter(doubaoDir), workbuddyAdapter(wbDir)]);

function writeDoubao(conv: string, agent: string, role: string, lines: unknown[], requirements: [number, string][]) {
  const sys = join(doubaoDir, conv, "agents", agent, "system");
  mkdirSync(sys, { recursive: true });
  writeFileSync(join(sys, "trajectory.jsonl"), jl(...lines));
  writeFileSync(
    join(sys, "assignment.md"),
    `# Assignment\n- Agent ID: ${agent}\n- Role: ${role}\n\n> append-only\n\n` +
      requirements.map(([m, t]) => `## [${iso(m)}] 需求\n${t}\n`).join(""),
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "lingxi-ingest2-"));
  doubaoDir = join(tmp, "doubao");
  wbDir = join(tmp, "wb");
  store = new LingxiStore({ home: join(tmp, "home") });
});
afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("helpers", () => {
  it("parses assignment.md requirements with nanosecond timestamps", () => {
    const md = "# Assignment\n- Role: main\n\n## [2026-09-03T08:53:41.680444409Z] 需求\n第一条\n## [2026-09-03T08:55:01.446634686Z] 需求\n第二条\n多行\n";
    const r = parseAssignment(md);
    expect(r.role).toBe("main");
    expect(r.requirements.map((x) => x.ts)).toEqual([Date.parse("2026-09-03T08:53:41.680Z"), Date.parse("2026-09-03T08:55:01.446Z")]);
    expect(r.requirements[1]!.key).toBe("第二条多行");
  });

  it("extracts WorkBuddy user_query", () => {
    expect(workbuddyUserText("<system-reminder>x</system-reminder>\n<user_query>你好</user_query>")).toBe("你好");
    expect(workbuddyUserText("<system-reminder>only</system-reminder>")).toBe("");
    expect(workbuddyUserText("plain text")).toBe("plain text");
  });
});

describe("Doubao Work adapter", () => {
  it("imports main-agent transcripts, skips injected text and sub-agents, times user turns from assignment.md", () => {
    writeDoubao(
      "38440180389549826",
      "m_main",
      "main",
      [
        { role: "user", content: "<system-reminder>\n执行模式说明</system-reminder>" },
        { role: "user", content: "我现在想要做一个工作记录的技能" },
        { role: "assistant", content: "方案如下……", tool_calls: [{ id: "1", type: "function", function: { name: "Read", arguments: { file_path: "a.md" } } }] },
        { role: "tool", content: "file content", tool_call_id: "1" },
        { role: "user", content: "<system-reminder>\n<current-date>2026-09-04</current-date></system-reminder>" },
        { role: "user", content: "  按你的推荐来" },
        { role: "assistant", content: "好的，已创建 work-log-db 技能，密码：abc12345" },
      ],
      [
        [0, "我现在想要做一个工作记录的技能"],
        [30, "按你的推荐来"],
      ],
    );
    writeDoubao("38440180389549826", "m_sub", "subagent", [{ role: "user", content: "sub task" }], [[1, "sub task"]]);

    ingestor().sync();
    const s = resolveSessionRef(store.db, "doubao:38440180389549826").session;
    expect(shortRef(s)).toBe("doubao:38440180389549826");
    expect(s.title).toBe("我现在想要做一个工作记录的技能");
    expect(s.cwd).toBeNull();
    const turns = store.db.prepare("SELECT role, ts, text FROM turns WHERE session_id = ? ORDER BY seq").all(s.id) as {
      role: string;
      ts: number;
      text: string;
    }[];
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "tool_call", "tool_result", "user", "assistant"]);
    expect(turns[4]!.ts - turns[0]!.ts).toBe(30 * 60_000);
    expect(turns[1]!.ts).toBe(turns[0]!.ts); // inherits the preceding user turn's time
    expect(turns[5]!.text).toContain("密码：***");
    expect(listSessions(store.db, { agent: "doubao" })).toHaveLength(1); // sub-agent skipped

    const rep = activityReport(store, { since: Date.now() - 3 * 3600_000, until: Date.now(), git: false });
    expect(rep.projects.map((p) => p.root)).toContain("(doubao: no project directory)");
  });

  it("re-imports a rewritten transcript instead of appending", () => {
    writeDoubao("1001", "m", "main", [{ role: "user", content: "第一版问题" }, { role: "assistant", content: "回答" }], [[0, "第一版问题"]]);
    const ing = ingestor();
    ing.sync();
    expect(resolveSessionRef(store.db, "doubao:1001").session.turn_count).toBe(2);
    writeDoubao("1001", "m", "main", [{ role: "user", content: "压缩后的问题" }], [[0, "压缩后的问题"]]);
    ing.sync();
    expect(resolveSessionRef(store.db, "doubao:1001").session.turn_count).toBe(1);
  });

  it("applies user-defined redaction rules from <home>/redact.txt", () => {
    writeFileSync(join(store.home, "redact.txt"), "# my secrets\nDemo-Pass9.\nre:tok_[0-9]{4}\n");
    writeDoubao("2002", "m", "main", [{ role: "user", content: "type Demo-Pass9. and tok_1234 please" }], [[0, "type"]]);
    ingestor().sync();
    const t = store.db.prepare("SELECT text FROM turns WHERE session_id LIKE 'doubao:2002%'").get() as { text: string };
    expect(t.text).toBe("type *** and *** please");
  });
});

describe("WorkBuddy adapter", () => {
  it("imports sessions using <user_query> and ai-title", () => {
    const d = join(wbDir, "d-Software-WorkBuddy_Datas-x");
    mkdirSync(d, { recursive: true });
    const t0 = Date.now() - 3600_000;
    writeFileSync(
      join(d, "882f4788-5671-4388-a0eb-32a0c40da8ca.jsonl"),
      jl(
        { type: "message", role: "user", timestamp: t0, content: [{ type: "input_text", text: "<system-reminder>ctx</system-reminder>\n<user_query>登录一下 reaxys，查找阿莫西林</user_query>" }] },
        { type: "ai-title", timestamp: t0 + 1, aiTitle: "登录Reaxys查找阿莫西林信息", cwd: "d:\\Software\\WorkBuddy_Datas\\2026-10-23-14-57-37" },
        { type: "reasoning", timestamp: t0 + 2, rawContent: [{ type: "reasoning_text", text: "hidden" }] },
        { type: "function_call", timestamp: t0 + 3, name: "Skill", arguments: '{"skill":"agent-browser"}' },
        { type: "function_call_result", timestamp: t0 + 4, name: "Skill", output: { type: "text", text: "loaded" } },
        { type: "message", role: "user", timestamp: t0 + 5, content: [{ type: "input_text", text: "<system-reminder>only context</system-reminder>" }] },
        { type: "message", role: "assistant", timestamp: t0 + 6, content: [{ type: "output_text", text: "请提供 Reaxys 账号" }] },
      ),
    );
    ingestor().sync();
    const s = resolveSessionRef(store.db, "workbuddy:32a0c40da8ca").session;
    expect(s.title).toBe("登录Reaxys查找阿莫西林信息");
    expect(s.cwd).toBeNull(); // per-conversation scratch folder is not treated as a project
    const roles = (store.db.prepare("SELECT role FROM turns WHERE session_id = ? ORDER BY seq").all(s.id) as { role: string }[]).map((r) => r.role);
    expect(roles).toEqual(["user", "tool_call", "tool_result", "assistant"]);
    expect(searchSessions(store.db, "阿莫西林", { agent: "workbuddy" })).toHaveLength(1);
  });
});
