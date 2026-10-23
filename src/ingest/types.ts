/** Normalized output of an agent-specific session parser. */

export type TurnRole = "user" | "assistant" | "tool_call" | "tool_result";

export interface ParsedTurn {
  kind: "turn";
  role: TurnRole;
  ts: number | null;
  text: string;
  tool_name?: string | null;
}

/** Session-level facts discovered while parsing (later values overwrite earlier ones, except where noted). */
export interface ParsedMeta {
  kind: "meta";
  cwd?: string;
  title?: string;
  /** Used only when no title is known yet (e.g. first user message). */
  fallbackTitle?: string;
  started_at?: number;
  meta?: Record<string, unknown>;
}

export type ParsedItem = ParsedTurn | ParsedMeta;

export interface SessionAdapter {
  agent: string;
  /** Root directories / files this adapter reads. */
  roots(): string[];
  /** All session files currently on disk. */
  discover(): string[];
  /** Stable native session id derived from the file name. */
  nativeIdFromPath(file: string): string | null;
  /** Parse one JSON line. Must be pure (no cross-line state). */
  parseLine(obj: unknown): ParsedItem[];
  /** Optional title lookup from a side index (e.g. Codex session_index.jsonl). */
  titleFor?(nativeId: string): string | undefined;
}

// ── shared helpers ──

export const LIMITS = {
  text: 8000, // user / assistant text
  toolCall: 400, // tool name + arguments
  toolResult: 1200,
};

export function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)} …[+${t.length - max} chars]` : t;
}

export function parseTs(v: unknown): number | null {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function oneLine(s: string, max = 120): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

export function stringifyArgs(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Text parts of a content value that is either a string or an array of {type, text} blocks. */
export function textOf(content: unknown, types: string[] = ["text", "input_text", "output_text"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object" && types.includes(String((c as { type?: unknown }).type))) {
        return String((c as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Text injected by harnesses rather than typed by the user (environment blocks, instructions, reminders). */
export function looksInjected(text: string): boolean {
  const t = text.trimStart();
  return (
    /^<(environment_context|user_instructions|skills_instructions|permissions|system-reminder|command-|local-command|INSTRUCTIONS|turn_aborted|user_shell_command|subagent_notification)/i.test(t) ||
    t.startsWith("# AGENTS.md instructions") ||
    t.startsWith("Caveat: The messages below were generated")
  );
}
