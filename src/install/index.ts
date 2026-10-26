import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = ["claude-code", "codex", "pi", "cursor", "workbuddy", "doubao"] as const;
export type Target = (typeof TARGETS)[number];

export interface InstallOptions {
  dryRun: boolean;
  skill: boolean;
  mcp: boolean;
}

export interface LaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const H = homedir();
const SERVER_NAME = "lingxi";
const SERVER_DESCRIPTION = "灵犀 Lingxi: cross-agent handoffs, topics and knowledge cards shared by all of the user's agents";

/** Absolute launch command: current node + this package's CLI. Avoids PATH / .cmd shim issues on Windows. */
export function launchSpec(target: Target): LaunchSpec {
  const cli = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  const env: Record<string, string> = { LINGXI_AGENT: target };
  if (process.env.LINGXI_HOME) env.LINGXI_HOME = process.env.LINGXI_HOME;
  return { command: process.execPath, args: [cli, "mcp"], env };
}

function skillSource(): string {
  return fileURLToPath(new URL("../../skills/lingxi/SKILL.md", import.meta.url));
}

/** Where each agent discovers user-level skills. ~/.agents/skills is the shared Agent Skills location (Codex, pi, Cursor). */
const SKILL_DIRS: Record<Target, string> = {
  "claude-code": join(H, ".claude", "skills"),
  codex: join(H, ".agents", "skills"),
  pi: join(H, ".agents", "skills"),
  cursor: join(H, ".agents", "skills"),
  workbuddy: join(H, ".workbuddy", "skills"),
  doubao: join(H, "DoubaoWork", "skills"),
};

// ───────────────────────────── file helpers ─────────────────────────────

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function log(dry: boolean, msg: string): void {
  console.log(`${dry ? "[dry-run] " : ""}${msg}`);
}

function backup(file: string, dry: boolean): void {
  if (!existsSync(file)) return;
  const bak = `${file}.lingxi-bak-${stamp}`;
  if (existsSync(bak)) return;
  if (!dry) copyFileSync(file, bak);
  log(dry, `  backup → ${bak}`);
}

function writeAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.lingxi-tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, file);
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function upsertJsonServer(file: string, entry: Record<string, unknown> | null, dry: boolean): void {
  const data = readJson(file);
  const servers = (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  if (entry) servers[SERVER_NAME] = entry;
  else if (SERVER_NAME in servers) delete servers[SERVER_NAME];
  else return log(dry, `  ${file}: no lingxi entry`);
  data.mcpServers = servers;
  backup(file, dry);
  if (!dry) writeAtomic(file, JSON.stringify(data, null, 2) + "\n");
  log(dry, `  ${entry ? "registered in" : "removed from"} ${file}`);
}

// ── TOML (Codex) — minimal, block-based edit so the rest of the file is untouched ──

const tomlLit = (s: string) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);

export function codexBlock(spec: LaunchSpec): string {
  const lines = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlLit(spec.command)}`,
    `args = [${spec.args.map(tomlLit).join(", ")}]`,
    // consult_session can take minutes; Codex's default MCP tool timeout is 60 s.
    "tool_timeout_sec = 600",
    "",
    `[mcp_servers.${SERVER_NAME}.env]`,
    ...Object.entries(spec.env).map(([k, v]) => `${k} = ${tomlLit(v)}`),
  ];
  return lines.join("\n") + "\n";
}

/** Remove `[mcp_servers.lingxi]` and its sub-tables (`[mcp_servers.lingxi.*]`). */
export function stripCodexBlock(toml: string): string {
  const eol = toml.includes("\r\n") ? "\r\n" : "\n";
  const lines = toml.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (header) {
      const name = header[1]!;
      skipping = name === `mcp_servers.${SERVER_NAME}` || name.startsWith(`mcp_servers.${SERVER_NAME}.`);
    }
    if (!skipping) out.push(line);
  }
  return out.join(eol).replace(eol === "\r\n" ? /(\r\n){3,}/g : /\n{3,}/g, eol + eol);
}

function upsertCodex(spec: LaunchSpec | null, dry: boolean): void {
  const file = join(H, ".codex", "config.toml");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const stripped = stripCodexBlock(before);
  if (!spec && stripped === before) return log(dry, `  ${file}: no lingxi entry`);
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  const next = spec
    ? (stripped.trim() ? stripped.replace(/\s*$/, eol + eol) : "") + codexBlock(spec).replace(/\n/g, eol)
    : stripped;
  backup(file, dry);
  if (!dry) writeAtomic(file, next);
  log(dry, `  ${spec ? "registered in" : "removed from"} ${file}`);
}

// ── Claude Code — prefer the official CLI, fall back to editing ~/.claude.json ──

function hasClaudeCli(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore", timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

function upsertClaude(spec: LaunchSpec | null, dry: boolean): void {
  if (hasClaudeCli()) {
    if (!dry) {
      try {
        execFileSync("claude", ["mcp", "remove", "--scope", "user", SERVER_NAME], { stdio: "ignore", timeout: 30000 });
      } catch {
        /* not registered yet */
      }
    }
    if (spec) {
      const json = JSON.stringify({ type: "stdio", command: spec.command, args: spec.args, env: spec.env });
      if (!dry) execFileSync("claude", ["mcp", "add-json", "--scope", "user", SERVER_NAME, json], { stdio: "pipe", timeout: 30000 });
      log(dry, "  registered via `claude mcp add-json --scope user lingxi …`");
    } else {
      log(dry, "  removed via `claude mcp remove --scope user lingxi`");
    }
    return;
  }
  upsertJsonServer(join(H, ".claude.json"), spec ? { type: "stdio", ...spec } : null, dry);
}

// ── Skills ──

function installSkill(dir: string, dry: boolean): void {
  const dest = join(dir, "lingxi", "SKILL.md");
  if (!dry) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(skillSource(), dest);
  }
  log(dry, `  skill → ${dest}`);
}

function removeSkill(dir: string, dry: boolean): void {
  const d = join(dir, "lingxi");
  if (!existsSync(d)) return;
  if (!dry) rmSync(d, { recursive: true, force: true });
  log(dry, `  skill removed: ${d}`);
}

// ── Manual instructions for apps whose MCP config lives in their UI ──

function manualInstructions(target: Target, spec: LaunchSpec): string {
  const app = "豆包工作 → 自定义连接器 (MCP)";
  const json = JSON.stringify({ mcpServers: { [SERVER_NAME]: { command: spec.command, args: spec.args, env: spec.env } } }, null, 2);
  return [
    `  ⚠ ${target}: the MCP server must be added in the app UI (${app}). Use stdio with:`,
    `    name:    ${SERVER_NAME}`,
    `    command: ${spec.command}`,
    `    args:    (one per line, enter exactly as shown)`,
    ...spec.args.map((a) => `               ${a}`),
    `    env:     ${Object.entries(spec.env).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    `    (JSON form, if the app accepts pasting a config):`,
    ...json.split("\n").map((l) => `      ${l}`),
  ].join("\n");
}

// ───────────────────────────── entry points ─────────────────────────────

function resolveTargets(input: string[]): Target[] {
  if (!input.length || input.includes("all")) return [...TARGETS];
  const bad = input.filter((t) => !(TARGETS as readonly string[]).includes(t));
  if (bad.length) throw new Error(`Unknown target(s): ${bad.join(", ")}. Valid: ${TARGETS.join(", ")}, all`);
  return input as Target[];
}

export async function runInstall(input: string[], opts: InstallOptions): Promise<void> {
  const targets = resolveTargets(input);
  const doneSkillDirs = new Set<string>();
  const manual: string[] = [];
  for (const t of targets) {
    console.log(`\n▸ ${t}`);
    const spec = launchSpec(t);
    try {
      if (opts.mcp) {
        switch (t) {
          case "claude-code":
            upsertClaude(spec, opts.dryRun);
            break;
          case "codex":
            upsertCodex(spec, opts.dryRun);
            break;
          case "pi":
            upsertJsonServer(
              join(H, ".pi", "agent", "mcp.json"),
              { command: spec.command, args: spec.args, env: spec.env, description: SERVER_DESCRIPTION, exposure: "direct", timeout: 600 },
              opts.dryRun,
            );
            break;
          case "cursor":
            upsertJsonServer(join(H, ".cursor", "mcp.json"), { command: spec.command, args: spec.args, env: spec.env }, opts.dryRun);
            break;
          case "workbuddy":
            // WorkBuddy reads user MCP servers from ~/.workbuddy/mcp.json (UserMcpProvider, same dir as mcp-approvals.json).
            // It may ask once in the UI to approve the new server.
            upsertJsonServer(join(H, ".workbuddy", "mcp.json"), { command: spec.command, args: spec.args, env: spec.env, timeout: 600000 }, opts.dryRun);
            break;
          case "doubao":
            manual.push(manualInstructions(t, spec));
            log(opts.dryRun, "  MCP: manual step required (see summary below)");
            break;
        }
      }
      if (opts.skill) {
        const dir = SKILL_DIRS[t];
        if (doneSkillDirs.has(dir)) log(opts.dryRun, `  skill: shared with an earlier target (${dir})`);
        else {
          installSkill(dir, opts.dryRun);
          doneSkillDirs.add(dir);
        }
      }
    } catch (err) {
      console.error(`  ✗ ${t}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (manual.length) console.log(`\nManual steps:\n${manual.join("\n\n")}`);
  console.log(
    `\nDone${opts.dryRun ? " (dry run, nothing written)" : ""}. Restart running agent sessions (or /reload in pi) to pick up the lingxi tools.`,
  );
}

export async function runUninstall(input: string[], opts: { dryRun: boolean }): Promise<void> {
  const targets = resolveTargets(input);
  const shared = SKILL_DIRS.codex;
  const sharedUsers: Target[] = ["codex", "pi", "cursor"];
  for (const t of targets) {
    console.log(`\n▸ ${t}`);
    try {
      switch (t) {
        case "claude-code":
          upsertClaude(null, opts.dryRun);
          break;
        case "codex":
          upsertCodex(null, opts.dryRun);
          break;
        case "pi":
          upsertJsonServer(join(H, ".pi", "agent", "mcp.json"), null, opts.dryRun);
          break;
        case "cursor":
          upsertJsonServer(join(H, ".cursor", "mcp.json"), null, opts.dryRun);
          break;
        case "workbuddy":
          upsertJsonServer(join(H, ".workbuddy", "mcp.json"), null, opts.dryRun);
          break;
        case "doubao":
          log(opts.dryRun, "  MCP: remove the 'lingxi' connector in the app UI");
          break;
      }
      const dir = SKILL_DIRS[t];
      if (dir !== shared) removeSkill(dir, opts.dryRun);
      else if (sharedUsers.every((u) => targets.includes(u))) removeSkill(dir, opts.dryRun);
      else log(opts.dryRun, `  skill kept in ${dir} (shared by ${sharedUsers.join(", ")})`);
    } catch (err) {
      console.error(`  ✗ ${t}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
