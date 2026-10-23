import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GUIDE_START = "<!-- guide:start -->";
export const GUIDE_END = "<!-- guide:end -->";

export function usagePath(): string {
  return fileURLToPath(new URL("../../docs/USAGE.md", import.meta.url));
}

/** The quick-reference block between the guide markers in docs/USAGE.md. */
export function extractGuide(markdown: string): string {
  const a = markdown.indexOf(GUIDE_START);
  const b = markdown.indexOf(GUIDE_END);
  if (a < 0 || b < a) return markdown.trim();
  return markdown.slice(a + GUIDE_START.length, b).trim();
}

export function renderGuide(opts: { full?: boolean } = {}): string {
  const file = usagePath();
  if (!existsSync(file)) {
    return `灵犀使用指南未找到：${file}\n运行 \`lingxi --help\` 查看命令。`;
  }
  const md = readFileSync(file, "utf8");
  const body = opts.full ? md.replace(GUIDE_START, "").replace(GUIDE_END, "").trim() : extractGuide(md);
  const footer = opts.full
    ? `\n\n—— 文件：${file}`
    : `\n\n—— 完整指南：lingxi guide --full（文件：${file}）\n—— 所有命令：lingxi --help`;
  return body + footer;
}
