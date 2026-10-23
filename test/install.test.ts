import { describe, expect, it } from "vitest";
import { codexBlock, stripCodexBlock } from "../src/install/index.js";

const spec = {
  command: "C:\\Program Files\\nodejs\\node.exe",
  args: ["D:\\x\\lingxi\\dist\\cli\\index.js", "mcp"],
  env: { LINGXI_AGENT: "codex" },
};

describe("codex config.toml editing", () => {
  it("renders a block with literal strings (Windows paths keep backslashes)", () => {
    const b = codexBlock(spec);
    expect(b).toContain("[mcp_servers.lingxi]");
    expect(b).toContain("command = 'C:\\Program Files\\nodejs\\node.exe'");
    expect(b).toContain("[mcp_servers.lingxi.env]");
    expect(b).toContain("LINGXI_AGENT = 'codex'");
  });

  it("strips only the lingxi tables and keeps everything else", () => {
    const toml = [
      'model = "x"',
      "",
      "[mcp_servers.exa]",
      'url = "https://mcp.exa.ai/mcp"',
      "",
      codexBlock(spec).trimEnd(),
      "",
      "[shell_environment_policy]",
      'inherit = "core"',
      "",
      "[mcp_servers.lingxi_other]",
      "command = 'keep-me'",
    ].join("\n");
    const out = stripCodexBlock(toml);
    expect(out).not.toContain("[mcp_servers.lingxi]");
    expect(out).not.toContain("LINGXI_AGENT");
    expect(out).toContain("[mcp_servers.exa]");
    expect(out).toContain("[shell_environment_policy]");
    expect(out).toContain("[mcp_servers.lingxi_other]");
    expect(out).toContain("keep-me");
  });

  it("preserves CRLF line endings", () => {
    const toml = "a = 1\r\n\r\n[mcp_servers.lingxi]\r\ncommand = 'x'\r\n\r\n[b]\r\nc = 2\r\n";
    const out = stripCodexBlock(toml);
    expect(out).toBe("a = 1\r\n\r\n[b]\r\nc = 2\r\n");
  });
});
