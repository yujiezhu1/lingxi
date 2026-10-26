import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { LIMITS, clip, oneLine, stringifyArgs, textOf, type ParsedItem, type SessionAdapter } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function defaultRoot(): string {
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "DoubaoWork", "User Data", "Profile 1", ".doubaowork", "agent_mode", "workspace", ".sessions");
}

interface Requirement {
  ts: number;
  key: string;
}

const norm = (s: string) => s.replace(/\s+/g, "").slice(0, 40);

/** `## [2026-09-03T08:53:41.680444409Z] 需求\n<text>` entries of assignment.md (one per user turn). */
export function parseAssignment(md: string): { role: string | null; requirements: Requirement[] } {
  const role = md.match(/^- Role:\s*(\S+)/m)?.[1] ?? null;
  const requirements: Requirement[] = [];
  const re = /^## \[([^\]]+)\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm;
  for (const m of md.matchAll(re)) {
    // Nanosecond ISO timestamps: keep milliseconds for Date.parse.
    const iso = m[1]!.replace(/(\.\d{3})\d+/, "$1");
    const ts = Date.parse(iso);
    if (!Number.isNaN(ts)) requirements.push({ ts, key: norm(m[2] ?? "") });
  }
  return { role, requirements };
}

/** Harness-injected user content (environment, reminders, preferences, Feishu page context …). */
function injected(text: string): boolean {
  return /^\s*<(system-reminder|usage_guide|current-date|saved_preferences|information)\b/i.test(text);
}

/**
 * Doubao Work (豆包工作) agent mode: plaintext OpenAI-style transcripts at
 * .doubaowork/agent_mode/workspace/.sessions/<conversationId>/agents/<agentId>/system/trajectory.jsonl.
 * Lines carry no timestamps; user turns are timed from assignment.md, other turns inherit the previous user turn's time.
 */
export function doubaoAdapter(root = process.env.LINGXI_DOUBAO_DIR || defaultRoot()): SessionAdapter {
  return {
    agent: "doubao",
    roots: () => [root],
    discover() {
      if (!existsSync(root)) return [];
      const out: string[] = [];
      for (const conv of readdirSync(root)) {
        const agentsDir = join(root, conv, "agents");
        if (!existsSync(agentsDir)) continue;
        for (const ag of readdirSync(agentsDir)) {
          const sys = join(agentsDir, ag, "system");
          const traj = join(sys, "trajectory.jsonl");
          if (!existsSync(traj)) continue;
          try {
            const { role } = parseAssignment(readFileSync(join(sys, "assignment.md"), "utf8"));
            if (role && role !== "main") continue; // sub-agents / organizers are internal
          } catch {
            /* no assignment.md: keep */
          }
          out.push(traj);
        }
      }
      return out;
    },
    // .sessions/<conversationId>/agents/<agentId>/system/trajectory.jsonl
    nativeIdFromPath: (file) => basename(dirname(dirname(dirname(dirname(file))))) || null,
    parseLine: () => [],
    parseFile(file, text, mtime): ParsedItem[] {
      let reqs: Requirement[] = [];
      try {
        reqs = parseAssignment(readFileSync(join(dirname(file), "assignment.md"), "utf8")).requirements;
      } catch {
        /* no timing info */
      }
      const items: ParsedItem[] = [{ kind: "meta", started_at: reqs[0]?.ts, ended_at: mtime, meta: { mode: "agent" } }];
      let lastTs: number | null = reqs[0]?.ts ?? null;
      let ri = 0;
      for (const line of text.split("\n")) {
        const l = line.trim();
        if (!l) continue;
        let o: unknown;
        try {
          o = JSON.parse(l);
        } catch {
          continue;
        }
        if (!isObj(o)) continue;
        const content = typeof o.content === "string" ? o.content : textOf(o.content);
        switch (o.role) {
          case "user": {
            if (!content.trim() || injected(content)) break;
            // Align with the next matching requirement in assignment.md (compaction / retries can skip some).
            const k = norm(content);
            for (let j = ri; j < reqs.length; j++) {
              const r = reqs[j]!;
              if (r.key && k && (r.key.startsWith(k.slice(0, 20)) || k.startsWith(r.key.slice(0, 20)))) {
                lastTs = r.ts;
                ri = j + 1;
                break;
              }
            }
            items.push({ kind: "turn", role: "user", ts: lastTs, text: clip(content, LIMITS.text) });
            items.push({ kind: "meta", fallbackTitle: oneLine(content) });
            break;
          }
          case "assistant": {
            if (content.trim()) items.push({ kind: "turn", role: "assistant", ts: lastTs, text: clip(content, LIMITS.text) });
            if (Array.isArray(o.tool_calls)) {
              for (const tc of o.tool_calls) {
                if (!isObj(tc)) continue;
                const fn = isObj(tc.function) ? tc.function : tc;
                const name = String(fn.name ?? "tool");
                items.push({ kind: "turn", role: "tool_call", ts: lastTs, tool_name: name, text: clip(`${name} ${stringifyArgs(fn.arguments)}`, LIMITS.toolCall) });
              }
            }
            break;
          }
          case "tool":
            if (content.trim()) items.push({ kind: "turn", role: "tool_result", ts: lastTs, text: clip(content, LIMITS.toolResult) });
            break;
        }
      }
      return items;
    },
  };
}
