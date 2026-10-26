import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end: spawn the built CLI (`node dist/cli/index.js mcp`) twice, as two different agents,
 * and check that a handoff saved by one is visible to the other. Requires `npm run build` first.
 */
const CLI = resolve(__dirname, "../dist/cli/index.js");
let home: string;

async function connect(agent: string, clientName: string, extraEnv: Record<string, string> = {}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp"],
    env: { ...(process.env as Record<string, string>), LINGXI_HOME: home, LINGXI_AGENT: agent, LINGXI_INGEST: "none", PI_SESSION_ID: "", CODEX_THREAD_ID: "", ...extraEnv },
  });
  const client = new Client({ name: clientName, version: "0.0.0" });
  await client.connect(transport);
  return client;
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join("\n");

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "lingxi-e2e-"));
});
afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("MCP stdio server", () => {
  it("lists the P0 tools and shares data across agents", async () => {
    const doubao = await connect("doubao", "doubao-work");
    const codex = await connect("codex", "codex-mcp-client");
    try {
      const tools = (await doubao.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual(
        ["check_inbox", "consult_session", "forget", "list_agents", "register", "send_message", "whoami", "get_activity", "list_handoffs", "list_sessions", "load_handoff", "read_session", "recall", "remember", "save_handoff", "search", "search_sessions", "topic_create", "topic_get", "topic_link", "topic_list", "topic_timeline", "topic_unlink"].sort(),
      );

      const saved = text(
        await doubao.callTool({
          name: "save_handoff",
          arguments: {
            title: "飞书需求对接：导出功能",
            topic: "导出需求",
            body_md: "## 目标\n支持导出 PDF\n## 已确认的结论与决策\n- 只做 A4 竖版 [ref: https://feishu.cn/docx/abc]",
            source_session: "doubao:需求对接",
            refs: ["https://feishu.cn/docx/abc"],
          },
        }),
      );
      expect(saved).toMatch(/Saved handoff ho_/);

      const overview = text(await codex.callTool({ name: "topic_get", arguments: { topic: "导出需求" } }));
      expect(overview).toContain("飞书需求对接：导出功能");
      expect(overview).toContain("author: doubao");
      expect(overview).toContain("只做 A4 竖版");

      await codex.callTool({ name: "remember", arguments: { kind: "decision", content: "导出使用 Playwright 渲染 PDF", topic: "导出需求" } });
      const hits = text(await doubao.callTool({ name: "search", arguments: { query: "Playwright" } }));
      expect(hits).toContain("card cd_");

      const err = await codex.callTool({ name: "load_handoff", arguments: { id: "ho_nope" } });
      expect((err as { isError?: boolean }).isError).toBe(true);

      // project binding + timeline
      const proj = join(home, "repo");
      await codex.callTool({ name: "topic_link", arguments: { topic: "\u5bfc\u51fa\u9700\u6c42", target_type: "project", target_id: proj } });
      const listed = text(await doubao.callTool({ name: "topic_list", arguments: { project: join(proj, "src") } }));
      expect(listed).toContain("\u5bfc\u51fa\u9700\u6c42");
      expect(listed).toContain("bound to a parent folder");
      const tl = text(await doubao.callTool({ name: "topic_timeline", arguments: { project: proj } }));
      expect(tl).toMatch(/handoff \{\u5bfc\u51fa\u9700\u6c42\}/);
      expect(tl).toContain("(by doubao)");
      expect(tl).toContain("[decision]");

      // session tools respond even with ingestion disabled
      expect(text(await codex.callTool({ name: "list_sessions", arguments: {} }))).toContain("No sessions");
      expect(text(await codex.callTool({ name: "get_activity", arguments: { git: false } }))).toContain("{导出需求}");
    } finally {
      await doubao.close();
      await codex.close();
    }
  }, 30000);

  it("delivers messages between two live sessions, with an unread notice on other tool calls", async () => {
    const research = await connect("pi", "pi", { PI_SESSION_ID: "01a17000-1111-7000-8000-aaaaaaaaaaaa" });
    const dev = await connect("pi", "pi", { PI_SESSION_ID: "01a17000-2222-7000-8000-bbbbbbbbbbbb" });
    try {
      expect(text(await research.callTool({ name: "register", arguments: { label: "research-pdf", activity: "调研 PDF 方案" } }))).toContain("research-pdf");
      expect(text(await dev.callTool({ name: "whoami", arguments: {} }))).toContain("pi:bbbbbbbbbbbb");
      const agents = text(await dev.callTool({ name: "list_agents", arguments: {} }));
      expect(agents).toContain("research-pdf");
      expect(agents).toContain("调研 PDF 方案");

      const sent = text(await dev.callTool({ name: "send_message", arguments: { to: "research-pdf", body: "项目实际用 FastAPI，请评估方案 B", kind: "request" } }));
      expect(sent).toMatch(/Sent msg_.* Online now: research-pdf/);

      const other = text(await research.callTool({ name: "topic_list", arguments: {} }));
      expect(other).toContain("📬 1 unread Lingxi message");

      const inbox = text(await research.callTool({ name: "check_inbox", arguments: {} }));
      expect(inbox).toContain("项目实际用 FastAPI");
      expect(inbox).toContain("[request]");
      const id = inbox.match(/msg_[0-9a-z_]+/)![0];
      expect(text(await research.callTool({ name: "check_inbox", arguments: {} }))).toBe("No new messages.");

      await research.callTool({ name: "send_message", arguments: { to: "", reply_to: id, body: "方案 B 在 FastAPI 下可行" } });
      expect(text(await dev.callTool({ name: "check_inbox", arguments: {} }))).toContain("方案 B 在 FastAPI 下可行");
    } finally {
      await research.close();
      await dev.close();
    }
  }, 30000);
});
