import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lingxiHome } from "../core/paths.js";

/**
 * Best-effort masking of secrets before session text is indexed.
 * Not a security boundary — just avoids copying obvious tokens into a second place.
 */
const PATTERNS: [RegExp, string][] = [
  [/\b(sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,})/g, "sk-***"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, "gh*_***"],
  [/\b(xox[abposr]-[A-Za-z0-9-]{10,})/g, "xox*-***"],
  [/\b(AKIA[0-9A-Z]{16})\b/g, "AKIA***"],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, "<jwt-redacted>"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, "$1***"],
  [
    /((?:api[_-]?key|apikey|secret|token|password|passwd|auth[_-]?token|access[_-]?key)["']?\s*[:=]\s*["']?)([^\s"'&,;]{8,})/gi,
    "$1***",
  ],
  // Chinese labels, e.g. 密码：xxx / 口令: xxx / 密钥=xxx
  [/((?:密码|口令|密钥|令牌|验证码)\s*[:：=]\s*)[^\s<"'，,；;]+/g, "$1***"],
  [/([?&](?:api[_-]?key|apikey|key|token|access_token|exaApiKey)=)[^&\s"']{8,}/gi, "$1***"],
];

/**
 * User-defined secrets: ~/.lingxi/redact.txt, one per line. Plain lines are literal strings,
 * lines starting with `re:` are regular expressions. `#` starts a comment line.
 */
let custom: { file: string; mtime: number; rules: RegExp[] } | null = null;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function customRules(home = lingxiHome()): RegExp[] {
  const file = join(home, "redact.txt");
  if (!existsSync(file)) return [];
  const mtime = statSync(file).mtimeMs;
  if (custom && custom.file === file && custom.mtime === mtime) return custom.rules;
  const rules: RegExp[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      rules.push(line.startsWith("re:") ? new RegExp(line.slice(3), "g") : new RegExp(escapeRe(line), "g"));
    } catch {
      /* invalid regex: skip */
    }
  }
  custom = { file, mtime, rules };
  return rules;
}

export function redact(text: string, extra: RegExp[] = customRules()): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  for (const re of extra) out = out.replace(re, "***");
  return out;
}
