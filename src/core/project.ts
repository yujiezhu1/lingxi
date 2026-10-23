import { resolve, sep } from "node:path";

/**
 * Normalize a project path for storage and comparison:
 * absolute, forward slashes, no trailing slash. Drive letter upper-cased on Windows.
 */
export function normalizeProjectPath(p: string, platform: NodeJS.Platform = process.platform): string {
  let out = resolve(p.trim()).split(sep).join("/");
  if (platform === "win32") out = out.replace(/\\/g, "/").replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
  if (out.length > 1 && out.endsWith("/") && !/^[A-Za-z]:\/$/.test(out)) out = out.slice(0, -1);
  return out;
}

function key(p: string, platform: NodeJS.Platform): string {
  return platform === "win32" || platform === "darwin" ? p.toLowerCase() : p;
}

export type ProjectMatch = "exact" | "ancestor" | "descendant";

/**
 * How a bound project path relates to the path being asked about.
 * - exact:      same directory
 * - ancestor:   the bound project contains `asked` (agent is working in a sub-folder of the project)
 * - descendant: `asked` contains the bound project (e.g. asking from the repo root about a bound sub-package)
 */
export function matchProject(bound: string, asked: string, platform: NodeJS.Platform = process.platform): ProjectMatch | null {
  const b = key(normalizeProjectPath(bound, platform), platform);
  const a = key(normalizeProjectPath(asked, platform), platform);
  if (a === b) return "exact";
  const withSlash = (s: string) => (s.endsWith("/") ? s : s + "/");
  if (a.startsWith(withSlash(b))) return "ancestor";
  if (b.startsWith(withSlash(a))) return "descendant";
  return null;
}
