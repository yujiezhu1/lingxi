#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, Option } from "commander";
import {
  CARD_KINDS,
  LINK_TYPES,
  LingxiError,
  LingxiStore,
  SCHEMA_VERSION,
  dbPath,
  fmtCardLine,
  fmtHandoffFull,
  fmtHandoffLine,
  fmtSearchHits,
  fmtTopicLine,
  fmtTopicOverview,
  type CardKind,
  type LinkType,
} from "../core/index.js";
import { VERSION } from "../version.js";

const program = new Command();
program
  .name("lingxi")
  .description("灵犀 Lingxi — local cross-agent context hub (handoffs, topics, knowledge cards)")
  .version(VERSION);

function withStore<T>(fn: (s: LingxiStore) => T): T {
  const s = new LingxiStore();
  try {
    return fn(s);
  } finally {
    s.close();
  }
}

const cliAgent = (explicit?: string) => explicit || process.env.LINGXI_AGENT || "cli";
const collect = (v: string, prev: string[] = []) => [...prev, v];

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// ── mcp ──
program
  .command("mcp")
  .description("Run the MCP server over stdio (agents launch this)")
  .action(async () => {
    const { runStdioServer } = await import("../mcp/server.js");
    await runStdioServer();
  });

// ── status ──
program
  .command("status")
  .description("Show data location and counts")
  .action(() =>
    withStore((s) => {
      const st = s.stats();
      console.log(`lingxi ${VERSION} (schema v${SCHEMA_VERSION})`);
      console.log(`home:     ${st.home}`);
      console.log(`database: ${dbPath(st.home)}`);
      console.log(`topics: ${st.topics}   handoffs: ${st.handoffs}   cards: ${st.cards}`);
    }),
  );

// ── topic ──
const topic = program.command("topic").description("Manage topics (work streams)");
topic
  .command("ls")
  .option("-a, --all", "include archived")
  .action((o: { all?: boolean }) =>
    withStore((s) => {
      const list = s.listTopics({ status: o.all ? "all" : "active" });
      console.log(list.length ? list.map(fmtTopicLine).join("\n") : "No topics.");
    }),
  );
topic
  .command("new <name>")
  .option("-d, --description <text>")
  .action((name: string, o: { description?: string }) =>
    withStore((s) => {
      const t = s.createTopic(name, o.description);
      console.log(`Created topic ${t.name} (${t.id})`);
    }),
  );
topic
  .command("show <topic>")
  .action((name: string) => withStore((s) => console.log(fmtTopicOverview(s.topicOverview(name), s, { maxBodyChars: Infinity }))));
topic
  .command("link <topic> <type> <target>")
  .description(`type: ${LINK_TYPES.join(" | ")}`)
  .option("-n, --note <text>")
  .action((name: string, type: string, target: string, o: { note?: string }) =>
    withStore((s) => {
      if (!(LINK_TYPES as readonly string[]).includes(type)) throw new LingxiError(`Invalid type: ${type}`);
      s.linkTopic(name, type as LinkType, target, o.note);
      console.log(`Linked ${type} ${target} → ${name}`);
    }),
  );
topic
  .command("archive <topic>")
  .action((name: string) => withStore((s) => console.log(`Archived ${s.setTopicStatus(name, "archived").name}`)));
topic
  .command("unarchive <topic>")
  .action((name: string) => withStore((s) => console.log(`Reactivated ${s.setTopicStatus(name, "active").name}`)));

// ── handoff ──
const handoff = program.command("handoff").description("Save / load handoffs");
handoff
  .command("save")
  .requiredOption("-t, --title <title>")
  .option("-f, --file <path>", "read body from a Markdown file (default: stdin)")
  .option("--topic <topic>")
  .option("--source <session>", "source session, e.g. codex:01a1…")
  .option("--ref <ref>", "source reference (repeatable)", collect)
  .option("--supersedes <id>")
  .option("--agent <name>")
  .action((o: { title: string; file?: string; topic?: string; source?: string; ref?: string[]; supersedes?: string; agent?: string }) =>
    withStore((s) => {
      const body = o.file ? readFileSync(o.file, "utf8") : readStdin();
      const h = s.saveHandoff({
        title: o.title,
        body_md: body,
        topic: o.topic,
        source_session: o.source,
        refs: o.ref,
        supersedes: o.supersedes,
        author_agent: cliAgent(o.agent),
      });
      console.log(`Saved ${h.id}${h.file_path ? `\n${h.file_path}` : ""}`);
    }),
  );
handoff
  .command("load [id]")
  .option("--topic <topic>")
  .action((id: string | undefined, o: { topic?: string }) =>
    withStore((s) => {
      const h = id ? s.getHandoff(id) : s.latestHandoff(o.topic);
      console.log(h ? fmtHandoffFull(h, s) : "No handoff found.");
    }),
  );
handoff
  .command("ls")
  .option("--topic <topic>")
  .option("-a, --all", "include superseded")
  .option("-n, --limit <n>", "max items", (v) => parseInt(v, 10))
  .action((o: { topic?: string; all?: boolean; limit?: number }) =>
    withStore((s) => {
      const list = s.listHandoffs({ topic: o.topic, includeSuperseded: o.all, limit: o.limit });
      console.log(list.length ? list.map((h) => fmtHandoffLine(h, s)).join("\n") : "No handoffs.");
    }),
  );

// ── cards ──
program
  .command("remember <kind> <content...>")
  .description(`Store a knowledge card. kind: ${CARD_KINDS.join(" | ")}`)
  .option("--topic <topic>")
  .option("--ref <ref>", "source reference (repeatable)", collect)
  .option("--agent <name>")
  .action((kind: string, content: string[], o: { topic?: string; ref?: string[]; agent?: string }) =>
    withStore((s) => {
      if (!(CARD_KINDS as readonly string[]).includes(kind)) throw new LingxiError(`Invalid kind: ${kind}`);
      const c = s.remember({ kind: kind as CardKind, content: content.join(" "), topic: o.topic, refs: o.ref, author_agent: cliAgent(o.agent) });
      console.log(`Remembered ${c.id}`);
    }),
  );
program
  .command("recall [query...]")
  .option("--topic <topic>")
  .addOption(new Option("--kind <kind>").choices([...CARD_KINDS]))
  .option("-n, --limit <n>", "max items", (v) => parseInt(v, 10))
  .action((query: string[], o: { topic?: string; kind?: CardKind; limit?: number }) =>
    withStore((s) => {
      const q = query.join(" ").trim();
      const cards = q
        ? s.search(q, { topic: o.topic, type: "card", limit: 200 }).map((h) => s.getCard(h.doc_id)).filter((c) => !o.kind || c.kind === o.kind)
        : s.listCards({ topic: o.topic, kind: o.kind, limit: o.limit ?? 20 });
      const shown = cards.slice(0, o.limit ?? 20);
      console.log(shown.length ? shown.map((c) => fmtCardLine(c, s)).join("\n") : "No cards.");
    }),
  );
program
  .command("forget <id>")
  .description("Archive a knowledge card")
  .action((id: string) => withStore((s) => console.log(`Archived ${s.forget(id).id}`)));

// ── search ──
program
  .command("search <query...>")
  .option("--topic <topic>")
  .addOption(new Option("--type <type>").choices(["handoff", "card"]))
  .option("-n, --limit <n>", "max items", (v) => parseInt(v, 10))
  .action((query: string[], o: { topic?: string; type?: "handoff" | "card"; limit?: number }) =>
    withStore((s) => console.log(fmtSearchHits(s.search(query.join(" "), { topic: o.topic, type: o.type, limit: o.limit }), s))),
  );

// ── install ──
program
  .command("install [targets...]")
  .description("Register the Lingxi MCP server + skill with agents: claude-code codex pi cursor workbuddy doubao (default: all)")
  .option("--dry-run", "show what would change without writing")
  .option("--skill-only", "only install the skill files")
  .option("--mcp-only", "only register the MCP server")
  .action(async (targets: string[], o: { dryRun?: boolean; skillOnly?: boolean; mcpOnly?: boolean }) => {
    const { runInstall } = await import("../install/index.js");
    await runInstall(targets, { dryRun: !!o.dryRun, skill: !o.mcpOnly, mcp: !o.skillOnly });
  });
program
  .command("uninstall [targets...]")
  .description("Remove the Lingxi MCP server + skill from agents (default: all)")
  .option("--dry-run")
  .action(async (targets: string[], o: { dryRun?: boolean }) => {
    const { runUninstall } = await import("../install/index.js");
    await runUninstall(targets, { dryRun: !!o.dryRun });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof LingxiError ? `lingxi: ${err.message}` : err);
  process.exit(1);
});
