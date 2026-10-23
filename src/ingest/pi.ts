import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { LIMITS, clip, looksInjected, oneLine, parseTs, stringifyArgs, textOf, type ParsedItem, type SessionAdapter } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** pi: ~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl */
export function piAdapter(root = process.env.LINGXI_PI_DIR || join(homedir(), ".pi", "agent", "sessions")): SessionAdapter {
  return {
    agent: "pi",
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
    nativeIdFromPath(file) {
      const name = basename(file, ".jsonl");
      const i = name.lastIndexOf("_");
      return (i >= 0 ? name.slice(i + 1) : name) || null;
    },
    parseLine(o): ParsedItem[] {
      if (!isObj(o)) return [];
      const ts = parseTs(o.timestamp);
      if (o.type === "session") {
        return [{ kind: "meta", cwd: typeof o.cwd === "string" ? o.cwd : undefined, started_at: ts ?? undefined }];
      }
      if (o.type === "session_info" && typeof o.name === "string" && o.name.trim()) return [{ kind: "meta", title: o.name }];
      if (o.type !== "message" || !isObj(o.message)) return [];
      const m = o.message;
      const content = m.content;
      switch (m.role) {
        case "user": {
          const text = textOf(content, ["text"]);
          if (!text.trim() || looksInjected(text)) return [];
          return [
            { kind: "turn", role: "user", ts, text: clip(text, LIMITS.text) },
            { kind: "meta", fallbackTitle: oneLine(text) },
          ];
        }
        case "assistant": {
          const items: ParsedItem[] = [];
          if (Array.isArray(content)) {
            for (const c of content) {
              if (!isObj(c)) continue;
              if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
                items.push({ kind: "turn", role: "assistant", ts, text: clip(c.text, LIMITS.text) });
              } else if (c.type === "toolCall") {
                const name = String(c.name ?? "tool");
                items.push({ kind: "turn", role: "tool_call", ts, tool_name: name, text: clip(`${name} ${stringifyArgs(c.arguments)}`, LIMITS.toolCall) });
              }
            }
          } else if (typeof content === "string" && content.trim()) {
            items.push({ kind: "turn", role: "assistant", ts, text: clip(content, LIMITS.text) });
          }
          return items;
        }
        case "toolResult": {
          const out = textOf(content, ["text"]);
          return out.trim()
            ? [{ kind: "turn", role: "tool_result", ts, tool_name: typeof m.toolName === "string" ? m.toolName : null, text: clip(out, LIMITS.toolResult) }]
            : [];
        }
        default:
          return [];
      }
    },
  };
}
