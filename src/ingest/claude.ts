import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { LIMITS, clip, looksInjected, oneLine, parseTs, stringifyArgs, textOf, type ParsedItem, type SessionAdapter } from "./types.js";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Claude Code: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl (sub-agent transcripts in sub-folders are skipped). */
export function claudeAdapter(root = process.env.LINGXI_CLAUDE_DIR || join(homedir(), ".claude", "projects")): SessionAdapter {
  return {
    agent: "claude-code",
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
          /* unreadable dir */
        }
      }
      return out;
    },
    nativeIdFromPath: (file) => basename(file, ".jsonl") || null,
    parseLine(o): ParsedItem[] {
      if (!isObj(o)) return [];
      const type = o.type;
      if (type === "ai-title" && typeof o.aiTitle === "string") return [{ kind: "meta", title: o.aiTitle }];
      if (type === "custom-title" && typeof o.customTitle === "string") return [{ kind: "meta", title: o.customTitle }];
      if (type === "summary" && typeof o.summary === "string") return [{ kind: "meta", title: o.summary }];
      if (type !== "user" && type !== "assistant") return [];
      if (o.isSidechain === true || o.isMeta === true) return [];
      const msg = o.message;
      if (!isObj(msg)) return [];
      const ts = parseTs(o.timestamp);
      const items: ParsedItem[] = [];
      const meta: ParsedItem = { kind: "meta" };
      if (typeof o.cwd === "string") meta.cwd = o.cwd;
      if (ts) meta.started_at = ts;
      if (typeof o.gitBranch === "string" && o.gitBranch) meta.meta = { gitBranch: o.gitBranch };
      items.push(meta);

      const content = msg.content;
      if (type === "user") {
        if (typeof content === "string") {
          if (content.trim() && !looksInjected(content)) {
            items.push({ kind: "turn", role: "user", ts, text: clip(content, LIMITS.text) });
            items.push({ kind: "meta", fallbackTitle: oneLine(content) });
          }
          return items;
        }
        if (Array.isArray(content)) {
          const text = textOf(content, ["text"]);
          if (text.trim() && !looksInjected(text)) {
            items.push({ kind: "turn", role: "user", ts, text: clip(text, LIMITS.text) });
            items.push({ kind: "meta", fallbackTitle: oneLine(text) });
          }
          for (const c of content) {
            if (isObj(c) && c.type === "tool_result") {
              const out = typeof c.content === "string" ? c.content : textOf(c.content, ["text"]);
              if (out.trim()) items.push({ kind: "turn", role: "tool_result", ts, text: clip(out, LIMITS.toolResult) });
            }
          }
        }
        return items;
      }
      // assistant
      if (Array.isArray(content)) {
        for (const c of content) {
          if (!isObj(c)) continue;
          if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
            items.push({ kind: "turn", role: "assistant", ts, text: clip(c.text, LIMITS.text) });
          } else if (c.type === "tool_use") {
            const name = String(c.name ?? "tool");
            items.push({ kind: "turn", role: "tool_call", ts, tool_name: name, text: clip(`${name} ${stringifyArgs(c.input)}`, LIMITS.toolCall) });
          }
        }
      } else if (typeof content === "string" && content.trim()) {
        items.push({ kind: "turn", role: "assistant", ts, text: clip(content, LIMITS.text) });
      }
      return items;
    },
  };
}
