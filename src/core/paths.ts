import { homedir } from "node:os";
import { join } from "node:path";

/** Root data directory. Override with LINGXI_HOME (useful for tests / portable installs). */
export function lingxiHome(): string {
  const env = process.env.LINGXI_HOME?.trim();
  return env && env.length > 0 ? env : join(homedir(), ".lingxi");
}

export function dbPath(home = lingxiHome()): string {
  return join(home, "lingxi.db");
}

export function vaultDir(home = lingxiHome()): string {
  return join(home, "vault");
}
