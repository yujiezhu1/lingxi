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
  fmtTimeline,
  fmtTopicLine,
  fmtTopicOverview,
  normalizeProjectPath,
  parseTimeBound,
  activityRange,
  activityReport,
  fmtActivity,
  fmtSessionHits,
  fmtSessionLine,
  fmtSessionTurns,
  listSessions,
  readSession,
  searchSessions,
  MESSAGE_KINDS,
  fmtInbox,
  fmtPresenceLine,
  inboxFor,
  listPresence,
  markRead,
  resolveTarget,
  sendMessage,
  upsertPresence,
  type MessageKind,
  type CardKind,
  type LinkType,
} from "../core/index.js";
import { Ingestor } from "../ingest/index.js";
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

// ── guide ──
program
  .command("guide")
  .description("使用速查 / quick usage guide (--full for the complete guide)")
  .option("--full", "show the complete usage guide (docs/USAGE.md)")
  .action(async (o: { full?: boolean }) => {
    const { renderGuide } = await import("./guide.js");
    console.log(renderGuide({ full: o.full }));
  });

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
      const ss = s.db.prepare("SELECT agent, COUNT(*) AS n, SUM(turn_count) AS t FROM sessions GROUP BY agent").all() as { agent: string; n: number; t: number }[];
      console.log(`sessions: ${ss.length ? ss.map((r) => `${r.agent} ${r.n} (${r.t} turns)`).join(", ") : "none imported yet (run lingxi sync)"}`);
    }),
  );

// ── topic ──
const topic = program.command("topic").description("Manage topics (work streams)");
const projectArg = (v: string | boolean | undefined): string | undefined =>
  v === undefined || v === false ? undefined : v === true ? process.cwd() : v;
const checkType = (type: string): LinkType => {
  if (!(LINK_TYPES as readonly string[]).includes(type)) throw new LingxiError(`Invalid type: ${type} (${LINK_TYPES.join(" | ")})`);
  return type as LinkType;
};

topic
  .command("ls")
  .option("-a, --all", "include archived")
  .option("-p, --project [path]", "only topics bound to this project (default: current directory)")
  .action((o: { all?: boolean; project?: string | boolean }) =>
    withStore((s) => {
      const project = projectArg(o.project);
      const list = s.listTopics({ status: o.all ? "all" : "active", project });
      console.log(list.length ? list.map(fmtTopicLine).join("\n") : project ? `No topic bound to ${project}.` : "No topics.");
    }),
  );
topic
  .command("new <name>")
  .option("-d, --description <text>")
  .option("-p, --project [path]", "bind to a project directory (default: current directory)")
  .action((name: string, o: { description?: string; project?: string | boolean }) =>
    withStore((s) => {
      const t = s.createTopic(name, o.description, projectArg(o.project));
      const p = s.topicProjects(t.id);
      console.log(`Created topic ${t.name} (${t.id})${p.length ? `, project: ${p.join(" | ")}` : ""}`);
    }),
  );
topic
  .command("show <topic>")
  .action((name: string) => withStore((s) => console.log(fmtTopicOverview(s.topicOverview(name), s, { maxBodyChars: Infinity }))));
topic
  .command("bind <topic> [path]")
  .description("Bind a topic to a project directory (default: current directory)")
  .action((name: string, path: string | undefined) =>
    withStore((s) => {
      const l = s.linkTopic(name, "project", path ?? process.cwd());
      console.log(`Bound ${s.topicName(l.topic_id)} → ${l.target_id}`);
    }),
  );
topic
  .command("unbind <topic> [path]")
  .description("Remove a project binding (default: current directory)")
  .action((name: string, path: string | undefined) =>
    withStore((s) => {
      const p = path ?? process.cwd();
      console.log(s.unlinkTopic(name, "project", p) ? `Unbound ${name} from ${p}` : `${name} is not bound to ${p}`);
    }),
  );
topic
  .command("link <topic> <type> <target>")
  .description(`type: ${LINK_TYPES.join(" | ")}`)
  .option("-n, --note <text>")
  .action((name: string, type: string, target: string, o: { note?: string }) =>
    withStore((s) => {
      const l = s.linkTopic(name, checkType(type), target, o.note);
      console.log(`Linked ${type} ${l.target_id} → ${s.topicName(l.topic_id)}`);
    }),
  );
topic
  .command("unlink <topic> <type> <target>")
  .action((name: string, type: string, target: string) =>
    withStore((s) => console.log(s.unlinkTopic(name, checkType(type), target) ? `Unlinked ${type} ${target}` : "No such link.")),
  );
topic
  .command("archive <topic>")
  .action((name: string) => withStore((s) => console.log(`Archived ${s.setTopicStatus(name, "archived").name}`)));
topic
  .command("unarchive <topic>")
  .action((name: string) => withStore((s) => console.log(`Reactivated ${s.setTopicStatus(name, "active").name}`)));

// ── timeline ──
program
  .command("timeline [topic]")
  .description("History of a topic, or of all topics bound to a project (development log / progress)")
  .option("-p, --project [path]", "all topics bound to this project (default: current directory)")
  .option("--since <time>", "e.g. 7d, 24h, 2026-10-01")
  .option("--until <time>", "e.g. 2026-10-23")
  .option("--desc", "newest first")
  .option("-n, --limit <n>", "max events (default 200)", (v) => parseInt(v, 10))
  .action((name: string | undefined, o: { project?: string | boolean; since?: string; until?: string; desc?: boolean; limit?: number }) =>
    withStore((s) => {
      const project = name ? undefined : projectArg(o.project ?? true);
      const events = s.timeline({
        topic: name,
        project,
        since: parseTimeBound(o.since),
        until: parseTimeBound(o.until, { endOfDay: true }),
        order: o.desc ? "desc" : "asc",
        limit: o.limit,
      });
      if (!name && project) console.log(`Timeline of project ${normalizeProjectPath(project)}\n`);
      console.log(fmtTimeline(events, s, { showTopic: !name }));
    }),
  );

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
  .description("Search handoffs and cards; with -s, search imported agent session transcripts")
  .option("--topic <topic>")
  .addOption(new Option("--type <type>").choices(["handoff", "card"]))
  .option("-s, --sessions", "search imported agent session transcripts (Claude Code, Codex, pi, Doubao Work, WorkBuddy) instead")
  .option("--agent <agent>", "with -s: claude-code | codex | pi | doubao | workbuddy")
  .option("-p, --project [path]", "with -s: only sessions inside this project (default: current directory)")
  .option("--since <time>", "with -s: e.g. 7d, 2026-10-01")
  .option("--tools", "with -s: also search tool calls / outputs")
  .option("-n, --limit <n>", "max items", (v) => parseInt(v, 10))
  .action(
    (
      query: string[],
      o: { topic?: string; type?: "handoff" | "card"; sessions?: boolean; agent?: string; project?: string | boolean; since?: string; tools?: boolean; limit?: number },
    ) =>
      withStore((s) => {
        const q = query.join(" ");
        if (!o.sessions) return console.log(fmtSearchHits(s.search(q, { topic: o.topic, type: o.type, limit: o.limit }), s));
        syncQuiet(s);
        console.log(
          fmtSessionHits(
            searchSessions(s.db, q, {
              agent: o.agent,
              project: projectArg(o.project),
              since: parseTimeBound(o.since),
              includeTools: o.tools,
              limit: o.limit,
            }),
          ),
        );
      }),
  );

// ── sessions ──
function syncQuiet(s: LingxiStore): void {
  try {
    new Ingestor(s).sync();
  } catch (err) {
    console.error(`lingxi: session sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

program
  .command("sync")
  .description("Import / update agent session transcripts: Claude Code, Codex, pi, Doubao Work, WorkBuddy (incremental)")
  .option("--full", "re-import everything from scratch")
  .option("--agent <agent...>", "only these agents: claude-code codex pi doubao workbuddy")
  .action((o: { full?: boolean; agent?: string[] }) =>
    withStore((s) => {
      const r = new Ingestor(s).sync({ full: o.full, agents: o.agent });
      for (const a of r.agents) {
        console.log(`${a.agent.padEnd(12)} files ${a.files}  changed ${a.changedFiles}  new sessions ${a.newSessions}  new turns ${a.newTurns}${a.removedSessions ? `  removed ${a.removedSessions}` : ""}`);
        for (const e of a.errors.slice(0, 5)) console.log(`  ! ${e}`);
      }
      console.log(`done in ${r.ms} ms`);
    }),
  );

program
  .command("sessions")
  .description("List imported agent sessions (newest first)")
  .option("--agent <agent>", "claude-code | codex | pi | doubao | workbuddy")
  .option("-p, --project [path]", "only sessions inside this project (default: current directory)")
  .option("--since <time>", "e.g. 7d, 2026-10-01")
  .option("-n, --limit <n>", "max items (default 20)", (v) => parseInt(v, 10))
  .action((o: { agent?: string; project?: string | boolean; since?: string; limit?: number }) =>
    withStore((s) => {
      syncQuiet(s);
      const list = listSessions(s.db, { agent: o.agent, project: projectArg(o.project), since: parseTimeBound(o.since), limit: o.limit });
      console.log(list.length ? list.map(fmtSessionLine).join("\n") : "No sessions.");
    }),
  );

program
  .command("show <ref>")
  .description("Read a session: codex:01a167c8 | pi:01a16790#42 | claude-code:cb991d64#10..30")
  .option("--tools", "include tool calls / results")
  .option("--from <n>", "start turn", (v) => parseInt(v, 10))
  .option("-n, --limit <n>", "number of turns (default: last 40)", (v) => parseInt(v, 10))
  .option("--context <n>", "turns before/after a #seq ref (default 6)", (v) => parseInt(v, 10))
  .action((ref: string, o: { tools?: boolean; from?: number; limit?: number; context?: number }) =>
    withStore((s) => {
      syncQuiet(s);
      const r = readSession(s.db, ref, { tools: o.tools, from: o.from, limit: o.limit, before: o.context, after: o.context });
      console.log(fmtSessionTurns(r, { maxChars: 200000, perTurnChars: 20000 }));
    }),
  );

program
  .command("activity [date]")
  .description("Activity report by project: sessions, Lingxi notes, commits, uncommitted changes. date: today | yesterday | YYYY-MM-DD")
  .option("--since <time>", "period instead of a day, e.g. 7d")
  .option("--until <time>")
  .option("-p, --project [path]", "only this project (default: current directory)")
  .option("--no-git", "skip git commits / status")
  .action((date: string | undefined, o: { since?: string; until?: string; project?: string | boolean; git?: boolean }) =>
    withStore((s) => {
      syncQuiet(s);
      const range = activityRange(date, o.since, o.until);
      console.log(fmtActivity(activityReport(s, { ...range, project: projectArg(o.project), git: o.git })));
    }),
  );

// ── messaging ──
/** The human at the terminal, as a message participant. */
function terminalUser(s: LingxiStore) {
  return upsertPresence(s.db, { key: "user:terminal", agent: "user", session_native: "terminal", cwd: process.cwd(), via: "cli", label: "user" });
}

program
  .command("who")
  .description("List online agent sessions (possible message recipients)")
  .option("-a, --all", "include sessions seen earlier")
  .action((o: { all?: boolean }) =>
    withStore((s) => {
      const list = listPresence(s.db, { all: o.all }).filter((p) => p.agent !== "user");
      console.log(list.length ? list.map((p) => fmtPresenceLine(p)).join("\n") : "No agent sessions online.");
    }),
  );

program
  .command("send <to> <body...>")
  .description("Send a message to a session: label | session ref | topic:<name> | project:<path> | all (sender: user)")
  .addOption(new Option("--kind <kind>").choices([...MESSAGE_KINDS]))
  .option("--ref <ref>", "reference (repeatable)", collect)
  .option("--reply-to <id>", "reply to a message (use '-' as <to>)")
  .action((to: string, body: string[], o: { kind?: MessageKind; ref?: string[]; replyTo?: string }) =>
    withStore((s) => {
      const me = terminalUser(s);
      const { message, target } = sendMessage(s.db, me, to === "-" ? "" : to, body.join(" "), { kind: o.kind, refs: o.ref, reply_to: o.replyTo });
      const live = target.liveRecipients.map((p) => p.label ?? p.key);
      console.log(`Sent ${message.id} to ${target.describe}.${live.length ? ` Online now: ${live.join(", ")}.` : ""}`);
    }),
  );

program
  .command("inbox")
  .description("Show messages sent to you (label 'user'), or peek at a session's inbox with --as")
  .option("--as <who>", "label or session ref of the session to inspect (does not mark as read)")
  .option("-a, --all", "include already read messages")
  .action((o: { as?: string; all?: boolean }) =>
    withStore((s) => {
      let me = terminalUser(s);
      if (o.as) {
        const t = resolveTarget(s.db, o.as, null);
        const p =
          t.kind === "label"
            ? listPresence(s.db, { all: true }).find((x) => x.label === t.value)
            : t.kind === "session"
              ? listPresence(s.db, { all: true }).find((x) => x.session_native === t.value)
              : undefined;
        if (!p) throw new LingxiError(`No registered session for ${o.as}`);
        me = p;
      }
      const msgs = inboxFor(s.db, me, { includeRead: o.all });
      if (!o.as) markRead(s.db, me.key, msgs.map((m) => m.id));
      console.log(fmtInbox(msgs));
    }),
  );

// ── hook (Claude Code / Codex) ──
program
  .command("hook <agent> <event>")
  .description("Hook entry point for Claude Code / Codex: registers presence and injects unread messages (reads hook JSON on stdin)")
  .action(async (agentName: string, event: string) => {
    const { runHook } = await import("../integrations/hooks.js");
    process.stdout.write(runHook(agentName, event, readStdin()));
  });

// ── consult ──
program
  .command("consult <ref> <question...>")
  .description("Ask a read-only background copy of a Claude Code / Codex / pi session (costs model tokens)")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--estimate", "only show the size estimate, do not run")
  .option("--model <model>", "override the model")
  .option("--timeout <sec>", "timeout in seconds (default 180)", (v) => parseInt(v, 10))
  .option("--save-topic <topic>", "also store the Q&A as a finding card in this topic")
  .action(async (ref: string, question: string[], o: { yes?: boolean; estimate?: boolean; model?: string; timeout?: number; saveTopic?: string }) => {
    const { estimateConsult, consultSession, fmtEstimate, fmtConsult } = await import("../consult/index.js");
    const s = new LingxiStore();
    try {
      syncQuiet(s);
      const est = estimateConsult(s, ref);
      console.log(fmtEstimate(est));
      if (!est.supported || o.estimate) return;
      if (!o.yes) {
        if (!process.stdin.isTTY) throw new LingxiError("Consulting costs model tokens; re-run with -y to confirm.");
        const { createInterface } = await import("node:readline/promises");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ans = (await rl.question("Run the consultation now? [y/N] ")).trim().toLowerCase();
        rl.close();
        if (ans !== "y" && ans !== "yes") return console.log("Cancelled.");
      }
      const q = question.join(" ");
      console.log("Consulting… (this can take up to a few minutes)");
      const r = await consultSession(s, ref, q, { model: o.model, timeoutMs: (o.timeout ?? 180) * 1000 });
      console.log("\n" + fmtConsult(r));
      if (o.saveTopic) {
        const c = s.remember({
          kind: "finding",
          topic: o.saveTopic,
          content: `[consulted ${r.ref}] Q: ${q}\nA: ${r.answer.length > 1500 ? r.answer.slice(0, 1500) + "…" : r.answer}`,
          refs: [r.ref],
          author_agent: cliAgent(),
        });
        console.log(`Saved as card ${c.id} in topic "${o.saveTopic}".`);
      }
    } finally {
      s.close();
    }
  });

// ── install ──
program
  .command("install [targets...]")
  .description("Register the Lingxi MCP server + skill with agents: claude-code codex pi cursor workbuddy doubao (default: all)")
  .option("--dry-run", "show what would change without writing")
  .option("--skill-only", "only install the skill files")
  .option("--mcp-only", "only register the MCP server")
  .option("--hooks", "Claude Code / Codex: also add SessionStart + UserPromptSubmit hooks that deliver Lingxi messages")
  .option("--no-extension", "pi: do not install the real-time messaging extension")
  .action(async (targets: string[], o: { dryRun?: boolean; skillOnly?: boolean; mcpOnly?: boolean; hooks?: boolean; extension?: boolean }) => {
    const { runInstall } = await import("../install/index.js");
    await runInstall(targets, { dryRun: !!o.dryRun, skill: !o.mcpOnly, mcp: !o.skillOnly, hooks: !!o.hooks, extension: o.extension });
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
