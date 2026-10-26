import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { LIMITS, clip, oneLine, parseTs, stringifyArgs, textOf, type ParsedItem, type SessionAdapter } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** The text the user actually typed: WorkBuddy wraps it in <user_query> after long <system-reminder> blocks. */
export function workbuddyUserText(raw: string): string {
  const q = [...raw.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)].map((m) => m[1]!.trim()).filter(Boolean);
  if (q.length) return q.join("\n");
  return /^\s*<system-reminder/i.test(raw) ? "" : raw;
}

/** WorkBuddy (CodeBuddy-based): ~/.workbuddy/projects/<encoded-cwd>/<sessionId>.jsonl */
export function workbuddyAdapter(root = process.env.LINGXI_WORKBUDDY_DIR || join(homedir(), ".workbuddy", "projects")): SessionAdapter {
  return {
    agent: "workbuddy",
    roots: () => [root],
    discover() {
      if (!existsSync(root)) return [];
      const out: string[] = [];
      for (const d of readdirSync(root)) {
        const dir = join(root, d);
        try {
          if (!statSync(dir).isDirectory()) continue;
          for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) out.push(join(dir, f));
        } catch {
          /* ignore */
        }
      }
      return out;
    },
    nativeIdFromPath: (file) => basename(file, ".jsonl") || null,
    parseLine(o): ParsedItem[] {
      if (!isObj(o)) return [];
      const ts = parseTs(o.timestamp);
      const items: ParsedItem[] = [];
      if (typeof o.cwd === "string") {
        // WorkBuddy creates a fresh scratch folder per conversation (\WorkBuddy_Datas\<timestamp>); that is not a project.
        if (/WorkBuddy_Datas[\\/]\d{4}-\d{2}-\d{2}/i.test(o.cwd)) items.push({ kind: "meta", meta: { workdir: o.cwd } });
        else items.push({ kind: "meta", cwd: o.cwd });
      }
      switch (o.type) {
        case "ai-title":
          if (typeof o.aiTitle === "string") items.push({ kind: "meta", title: o.aiTitle });
          break;
        case "message": {
          const text = textOf(o.content);
          if (o.role === "user") {
            const typed = workbuddyUserText(text);
            if (typed.trim()) {
              items.push({ kind: "turn", role: "user", ts, text: clip(typed, LIMITS.text) });
              items.push({ kind: "meta", fallbackTitle: oneLine(typed), started_at: ts ?? undefined });
            }
          } else if (o.role === "assistant" && text.trim()) {
            items.push({ kind: "turn", role: "assistant", ts, text: clip(text, LIMITS.text) });
          }
          break;
        }
        case "function_call": {
          const name = String(o.name ?? "tool");
          items.push({ kind: "turn", role: "tool_call", ts, tool_name: name, text: clip(`${name} ${stringifyArgs(o.arguments)}`, LIMITS.toolCall) });
          break;
        }
        case "function_call_result": {
          const out = isObj(o.output) ? String(o.output.text ?? stringifyArgs(o.output)) : stringifyArgs(o.output);
          if (out.trim()) {
            items.push({ kind: "turn", role: "tool_result", ts, tool_name: typeof o.name === "string" ? o.name : null, text: clip(out, LIMITS.toolResult) });
          }
          break;
        }
      }
      return items;
    },
  };
}
