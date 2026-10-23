import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { LIMITS, clip, looksInjected, oneLine, parseTs, stringifyArgs, textOf, type ParsedItem, type SessionAdapter } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function walkJsonl(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (e.endsWith(".jsonl")) out.push(p);
    else {
      try {
        if (statSync(p).isDirectory()) walkJsonl(p, out);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Codex (CLI + Desktop): ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl; titles from ~/.codex/session_index.jsonl. */
export function codexAdapter(home = process.env.LINGXI_CODEX_DIR || join(homedir(), ".codex")): SessionAdapter {
  const root = join(home, "sessions");
  let titles: Map<string, string> | null = null;
  let titlesMtime = -1;

  const loadTitles = (): Map<string, string> => {
    const file = join(home, "session_index.jsonl");
    let mtime = 0;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      return (titles = new Map());
    }
    if (titles && mtime === titlesMtime) return titles;
    const map = new Map<string, string>();
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { id?: string; thread_name?: string };
        if (o.id && o.thread_name) map.set(o.id, o.thread_name); // later lines win
      } catch {
        /* skip */
      }
    }
    titlesMtime = mtime;
    return (titles = map);
  };

  return {
    agent: "codex",
    roots: () => [root],
    discover() {
      if (!existsSync(root)) return [];
      const out: string[] = [];
      walkJsonl(root, out);
      return out;
    },
    nativeIdFromPath: (file) => basename(file).match(UUID_TAIL)?.[1] ?? null,
    titleFor: (id) => loadTitles().get(id),
    parseLine(o): ParsedItem[] {
      if (!isObj(o)) return [];
      const ts = parseTs(o.timestamp);
      const p = o.payload;
      if (!isObj(p)) return [];
      if (o.type === "session_meta") {
        const meta: Record<string, unknown> = {};
        for (const k of ["originator", "source", "cli_version", "model_provider"]) if (p[k] !== undefined) meta[k] = p[k];
        return [{ kind: "meta", cwd: typeof p.cwd === "string" ? p.cwd : undefined, started_at: parseTs(p.timestamp) ?? ts ?? undefined, meta }];
      }
      if (o.type === "turn_context" && typeof p.cwd === "string") return [{ kind: "meta", cwd: p.cwd }];
      if (o.type !== "response_item") return [];

      switch (p.type) {
        case "message": {
          const role = p.role;
          if (role !== "user" && role !== "assistant") return []; // developer / system
          const text = textOf(p.content);
          if (!text.trim()) return [];
          if (role === "user") {
            if (looksInjected(text)) return [];
            return [
              { kind: "turn", role: "user", ts, text: clip(text, LIMITS.text) },
              { kind: "meta", fallbackTitle: oneLine(text) },
            ];
          }
          return [{ kind: "turn", role: "assistant", ts, text: clip(text, LIMITS.text) }];
        }
        case "function_call":
        case "custom_tool_call": {
          const name = String(p.name ?? "tool");
          const args = stringifyArgs(p.arguments ?? p.input);
          return [{ kind: "turn", role: "tool_call", ts, tool_name: name, text: clip(`${name} ${args}`, LIMITS.toolCall) }];
        }
        case "function_call_output":
        case "custom_tool_call_output": {
          const out = typeof p.output === "string" ? p.output : stringifyArgs(p.output);
          return out.trim() ? [{ kind: "turn", role: "tool_result", ts, text: clip(out, LIMITS.toolResult) }] : [];
        }
        default:
          return []; // reasoning, web_search_call, … are not indexed
      }
    },
  };
}
