import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CARD_KINDS,
  LINK_TYPES,
  LingxiStore,
  fmtCardLine,
  fmtHandoffFull,
  fmtHandoffLine,
  fmtSearchHits,
  fmtTimeline,
  fmtTopicLine,
  fmtTopicOverview,
  parseTimeBound,
} from "../core/index.js";
import { VERSION } from "../version.js";

export const HANDOFF_TEMPLATE = `## 目标 / Goal
## 当前状态 / Status (one line)
## 已确认的结论与决策 / Confirmed conclusions & decisions
- <conclusion>  [ref: <agent>:<sessionId>#<where> | <file/url>]
## 约束与前提 / Constraints
## 已尝试但失败或放弃的路线 / Dead ends
## 未解决问题 / Open questions
## 关键资源 / Key resources (files, links, Feishu docs, people)
## 建议的下一步 / Suggested next steps`;

const INSTRUCTIONS = `Lingxi (灵犀) is the user's local, cross-agent context hub. The same data is shared by every agent the user runs
(Claude Code, Codex, pi, Cursor, WorkBuddy, Doubao/豆包 …), so anything saved here can be picked up from any other agent or session.

Use it to:
- Pick up work started elsewhere: topic_get / load_handoff (start here when the user mentions a topic, "之前", "另一个会话", "豆包里", "调研结果"…).
- Hand work over: save_handoff when a milestone is reached, before switching tools, or when the user asks ("保存交接", "存到灵犀").
- Keep durable knowledge: remember (decision / fact / finding / constraint / todo / dead_end / note), recall to look it up.
- Find things: search across all handoffs and cards.
- Projects: topics can be bound to project directories. topic_list project=<cwd> finds the topics of the current project;
  topic_timeline shows a topic's or project's history (development log / progress).

Rules: write handoffs yourself from your own context using the template in save_handoff; cite sources with refs; prefer updating
an existing topic over creating near-duplicates (call topic_list first); never store secrets (API keys, tokens, passwords).`;

const AGENT_ALIASES: [RegExp, string][] = [
  [/claude/i, "claude-code"],
  [/codex/i, "codex"],
  [/^pi\b|pi-coding-agent/i, "pi"],
  [/cursor/i, "cursor"],
  [/workbuddy|codebuddy/i, "workbuddy"],
  [/doubao|豆包/i, "doubao"],
];

export function normalizeAgent(name: string | undefined | null): string | null {
  if (!name) return null;
  for (const [re, id] of AGENT_ALIASES) if (re.test(name)) return id;
  return name.trim() || null;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (err: unknown): ToolResult => ({
  content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
  isError: true,
});
function guard<A>(fn: (args: A) => string): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return ok(fn(args));
    } catch (err) {
      return fail(err);
    }
  };
}

export function createServer(store: LingxiStore): McpServer {
  const server = new McpServer({ name: "lingxi", version: VERSION }, { instructions: INSTRUCTIONS });

  const agent = (explicit?: string | null): string | null =>
    explicit?.trim() || process.env.LINGXI_AGENT?.trim() || normalizeAgent(server.server.getClientVersion()?.name);

  const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  // ── topics ──
  server.registerTool(
    "topic_list",
    {
      title: "List topics",
      description:
        "List topics (work streams that group handoffs and cards across agents). Call before creating a topic to avoid duplicates. " +
        "Pass project=<absolute path of the current working directory / repo root> to list only the topics bound to that project " +
        "(also matches topics bound to a parent folder or to a sub-folder).",
      inputSchema: {
        status: z.enum(["active", "archived", "all"]).optional().describe("Default: active"),
        project: z.string().optional().describe("Absolute project path, e.g. your current working directory"),
      },
      annotations: RO,
    },
    guard(({ status, project }) => {
      const list = store.listTopics({ status, project });
      if (list.length) return list.map(fmtTopicLine).join("\n");
      return project
        ? `No topic is bound to ${project}. Bind one with topic_link target_type=project, or topic_create with project.`
        : "No topics yet. save_handoff / remember with a topic name creates one.";
    }),
  );

  server.registerTool(
    "topic_create",
    {
      title: "Create topic",
      description:
        "Create a topic (work stream). Optionally bind it to a project directory (absolute path). " +
        "save_handoff and remember also auto-create missing topics.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        project: z.string().optional().describe("Absolute path of the project this topic belongs to"),
      },
      annotations: WR,
    },
    guard(({ name, description, project }) => {
      const t = store.createTopic(name, description, project);
      const p = store.topicProjects(t.id);
      return `Created topic ${t.name} (${t.id})${p.length ? `, bound to project ${p.join(", ")}` : ""}.`;
    }),
  );

  server.registerTool(
    "topic_get",
    {
      title: "Get topic overview",
      description:
        "Load everything about a topic: bound project, latest handoff (full), earlier handoffs, knowledge cards and linked items. " +
        "Best first call when resuming work on a topic in a new session or another agent.",
      inputSchema: {
        topic: z.string().min(1).describe("Topic name or id"),
        card_limit: z.number().int().min(0).max(500).optional(),
      },
      annotations: RO,
    },
    guard(({ topic, card_limit }) => fmtTopicOverview(store.topicOverview(topic, { cardLimit: card_limit }), store)),
  );

  server.registerTool(
    "topic_link",
    {
      title: "Link item to topic",
      description:
        "Attach an item to a topic (topic is created if missing). target_type=project binds the topic to a project directory " +
        "(absolute path; a topic may belong to several projects and a project may have several topics). Other types relate work " +
        "that only later turned out to be connected: session ('codex:<sessionId>'), path, url, handoff id, card id, topic.",
      inputSchema: {
        topic: z.string().min(1),
        target_type: z.enum(LINK_TYPES),
        target_id: z.string().min(1),
        note: z.string().optional(),
      },
      annotations: WR,
    },
    guard(({ topic, target_type, target_id, note }) => {
      const l = store.linkTopic(topic, target_type, target_id, note);
      return `Linked ${l.target_type} ${l.target_id} to topic ${store.topicName(l.topic_id)}.`;
    }),
  );

  server.registerTool(
    "topic_unlink",
    {
      title: "Unlink item from topic",
      description: "Remove a link from a topic, e.g. unbind a project (target_type=project) or drop a wrong session/path/url link.",
      inputSchema: {
        topic: z.string().min(1),
        target_type: z.enum(LINK_TYPES),
        target_id: z.string().min(1),
      },
      annotations: { ...WR, destructiveHint: true },
    },
    guard(({ topic, target_type, target_id }) =>
      store.unlinkTopic(topic, target_type, target_id)
        ? `Unlinked ${target_type} ${target_id} from topic ${topic}.`
        : `No ${target_type} link ${target_id} on topic ${topic}.`,
    ),
  );

  server.registerTool(
    "topic_timeline",
    {
      title: "Topic / project timeline",
      description:
        "Chronological history (development log / progress record) of a topic, or of all topics bound to a project: " +
        "topic creation, handoffs (incl. superseded), knowledge cards (incl. archived) and links. " +
        "Use when the user asks how a project/topic evolved, what was done when, or for progress reports.",
      inputSchema: {
        topic: z.string().optional().describe("Topic name or id"),
        project: z.string().optional().describe("Absolute project path (all topics bound to it); used when topic is omitted"),
        since: z.string().optional().describe("e.g. 7d, 24h, 2026-10-01"),
        until: z.string().optional().describe("e.g. 2026-10-23"),
        order: z.enum(["asc", "desc"]).optional().describe("Default asc (oldest first)"),
        limit: z.number().int().min(1).max(1000).optional().describe("Default 200"),
      },
      annotations: RO,
    },
    guard(({ topic, project, since, until, order, limit }) => {
      const events = store.timeline({
        topic,
        project,
        since: parseTimeBound(since),
        until: parseTimeBound(until, { endOfDay: true }),
        order,
        limit,
      });
      return fmtTimeline(events, store, { showTopic: !topic });
    }),
  );

  // ── handoffs ──
  server.registerTool(
    "save_handoff",
    {
      title: "Save handoff",
      description:
        "Save a structured handoff (snapshot of the current work state) so another session/agent can continue. " +
        "Write body_md yourself from your own context, in Markdown, following this template (omit empty sections):\n\n" +
        HANDOFF_TEMPLATE +
        "\n\nCite sources inline with [ref: …]. If this replaces an earlier handoff of the same topic, pass its id as supersedes.",
      inputSchema: {
        title: z.string().min(1).describe("Short title"),
        body_md: z.string().min(1).describe("Handoff body in Markdown (see template)"),
        topic: z.string().optional().describe("Topic name or id; created if missing"),
        source_session: z.string().optional().describe("Where this came from, e.g. 'pi:01a16790' or 'doubao:飞书需求对接'"),
        refs: z.array(z.string()).optional().describe("Source references: session refs, file paths, URLs, Feishu doc links"),
        supersedes: z.string().optional().describe("Id of an older handoff this one replaces"),
        author_agent: z.string().optional().describe("Override the detected agent name"),
      },
      annotations: WR,
    },
    guard((a) => {
      const h = store.saveHandoff({ ...a, author_agent: agent(a.author_agent) });
      const topic = store.topicName(h.topic_id);
      return `Saved handoff ${h.id}${topic ? ` in topic "${topic}"` : ""}${h.supersedes ? ` (supersedes ${h.supersedes})` : ""}.` +
        (h.file_path ? `\nFile: ${h.file_path}` : "");
    }),
  );

  server.registerTool(
    "load_handoff",
    {
      title: "Load handoff",
      description: "Load a handoff by id, or the latest active handoff of a topic, or (no arguments) the most recent handoff overall.",
      inputSchema: { id: z.string().optional(), topic: z.string().optional() },
      annotations: RO,
    },
    guard(({ id, topic }) => {
      const h = id ? store.getHandoff(id) : store.latestHandoff(topic);
      if (!h) return topic ? `No handoff in topic "${topic}" yet.` : "No handoffs yet.";
      return fmtHandoffFull(h, store);
    }),
  );

  server.registerTool(
    "list_handoffs",
    {
      title: "List handoffs",
      description: "List handoffs, newest first, optionally within a topic.",
      inputSchema: {
        topic: z.string().optional(),
        include_superseded: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: RO,
    },
    guard(({ topic, include_superseded, limit }) => {
      const list = store.listHandoffs({ topic, includeSuperseded: include_superseded, limit });
      return list.length ? list.map((h) => fmtHandoffLine(h, store)).join("\n") : "No handoffs.";
    }),
  );

  // ── cards ──
  server.registerTool(
    "remember",
    {
      title: "Remember (knowledge card)",
      description:
        "Store one atomic piece of durable knowledge: decision, fact, finding, constraint, todo, dead_end (tried and failed) or note. " +
        "Keep it self-contained (understandable without this conversation). Ask the user first unless they told you to save freely.",
      inputSchema: {
        kind: z.enum(CARD_KINDS),
        content: z.string().min(1),
        topic: z.string().optional(),
        refs: z.array(z.string()).optional(),
        author_agent: z.string().optional(),
      },
      annotations: WR,
    },
    guard((a) => {
      const c = store.remember({ ...a, author_agent: agent(a.author_agent) });
      return `Remembered ${c.kind} ${c.id}${c.topic_id ? ` in topic "${store.topicName(c.topic_id)}"` : ""}.`;
    }),
  );

  server.registerTool(
    "recall",
    {
      title: "Recall knowledge cards",
      description: "Look up knowledge cards by text query and/or topic and kind. Without query, lists the newest cards.",
      inputSchema: {
        query: z.string().optional(),
        topic: z.string().optional(),
        kind: z.enum(CARD_KINDS).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: RO,
    },
    guard(({ query, topic, kind, limit }) => {
      if (query?.trim()) {
        const hits = store.search(query, { topic, type: "card", limit: (limit ?? 20) * 3 });
        const cards = hits.map((h) => store.getCard(h.doc_id)).filter((c) => !kind || c.kind === kind).slice(0, limit ?? 20);
        return cards.length ? cards.map((c) => fmtCardLine(c, store)).join("\n") : "No matching cards.";
      }
      const cards = store.listCards({ topic, kind, limit: limit ?? 20 });
      return cards.length ? cards.map((c) => fmtCardLine(c, store)).join("\n") : "No cards.";
    }),
  );

  server.registerTool(
    "forget",
    {
      title: "Archive a knowledge card",
      description: "Archive a knowledge card that is wrong or obsolete (it stays in the database but is hidden from recall/search).",
      inputSchema: { id: z.string().min(1) },
      annotations: { ...WR, destructiveHint: true },
    },
    guard(({ id }) => `Archived card ${store.forget(id).id}.`),
  );

  // ── search ──
  server.registerTool(
    "search",
    {
      title: "Search Lingxi",
      description:
        "Full-text search over all handoffs and knowledge cards from every agent. Space-separated terms are AND-ed. " +
        "Works for Chinese and English. Follow up with load_handoff / topic_get for full content.",
      inputSchema: {
        query: z.string().min(1),
        topic: z.string().optional(),
        type: z.enum(["handoff", "card"]).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: RO,
    },
    guard(({ query, topic, type, limit }) => fmtSearchHits(store.search(query, { topic, type, limit }), store)),
  );

  return server;
}

export async function runStdioServer(): Promise<void> {
  const store = new LingxiStore();
  const server = createServer(store);
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      store.close();
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
  await server.connect(transport);
}
