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
  [/([?&](?:api[_-]?key|apikey|key|token|access_token|exaApiKey)=)[^&\s"']{8,}/gi, "$1***"],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
