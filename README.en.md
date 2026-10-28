# Lingxi 灵犀

[中文](README.md) | **English**

> Let your AI agents and sessions read each other's minds.
> A local-first context hub shared by all your AI agents — Claude Code, Codex, pi, Cursor, WorkBuddy, Doubao Work (豆包工作) …

## Sound familiar?

> 😩 **"I just worked this out in another session — now I have to explain it all over again."**
> You spend an afternoon untangling a problem in Claude Code, switch to Codex to implement it, and retype the background, conclusions and constraints — and still forget a few.

> 😩 **"The agent that can read my docs isn't the one that writes good code."**
> Requirements live in Feishu/Lark docs and group chats, which only your office agent can read. Getting them into your coding CLI means copy-paste, and links and details get lost on the way.

> 😩 **"Research and implementation live in two sessions, and I'm the courier."**
> pi is researching options while Codex builds the project. When the project reveals a new constraint, the research has to change; when research concludes, the code needs it. You relay everything by hand.

> 😩 **"It didn't seem related at first."**
> Last week you debugged the same issue in some session. You never saved it, and now you can't remember which tool or which session.

> 😩 **"Every new session re-reads the codebase from scratch."**
> Where the project stands, why it was designed this way, which approaches already failed — none of that is in the code, and nobody tells the new session.

> 😩 **"My daily report misses everything that isn't committed yet."**
> You hop between four or five agents all day. In the evening, `git log` is all you have — uncommitted work and the things you did in your office agent are forgotten.

**The root cause is the same: every agent and every session is an island.** Each vendor stores transcripts in its own format and location, invisible to the others.

## How Lingxi helps

Lingxi is a **local context hub shared by all your agents**. Handoffs, knowledge cards and topics saved in one agent can be loaded from any other agent or session, and every agent's raw transcripts are imported automatically and made searchable.

| Before | With Lingxi |
|---|---|
| Re-explain everything when switching agents | Say "save a handoff" before switching, "load topic X" in the new session |
| Copy-paste requirements from your office agent into the CLI | The office agent writes to Lingxi directly; even if you forgot, the CLI can search the original conversation |
| Relay research conclusions and dev constraints by hand | One topic for both; when something changes, `send_message` — pi receives it in real time |
| "Which session discussed this?" | `search_sessions` searches raw transcripts across 5 agents and opens hits by reference |
| Only that old session knows the detail | `consult_session` lets a read-only copy of it answer directly; the original is untouched |
| Every new session re-learns the project | Bind a topic to the project directory to keep status, decisions and dead ends; "load the project background" |
| Daily reports miss in-progress work | "What did I do today?" — per project: agent sessions, git commits **and uncommitted changes** |

### A typical cross-agent day (illustrative)

```text
[Doubao Work] after reading the Feishu requirement doc and group chat
  You:   Save the conclusions to Lingxi, topic "export-feature"
  Agent: Saved handoff ho_… (requirements / doc links / people / deadline)

[Codex]
  You:   Load "export-feature" from Lingxi and start implementing
  Codex: Loaded (saved by doubao 10 minutes ago) … starts coding
  You:   Record a decision: render PDFs with Playwright, A4 portrait only

[pi]
  You:   Which session talked about garbled Chinese fonts in PDFs?
  pi:    Found in claude-code:…#42 — the conclusion was a missing NotoSansCJK font …

[Evening, WorkBuddy]
  You:   Use Lingxi to see what I did today and draft my daily report
  Agent: Per project — 3 sessions, 2 commits, 1 uncommitted change, 1 new decision …
```

### Features

- 🔁 **Cross-agent handoffs** — finish requirements in one agent, continue in another with "load X".
- 🧠 **Project memory** — bind topics to project directories; keep background, decisions, dead ends and progress, with a timeline of how the project evolved.
- 🔎 **Searchable and cumulative** — everything persists, with full-text search that works for Chinese and English; newer handoffs supersede older ones while history is kept.
- 🗂️ **Recover what you never saved** — transcripts from Claude Code, Codex, pi, Doubao Work and WorkBuddy are imported automatically (read-only, incremental).
- 📨 **Message between live sessions** — running sessions can message each other: pi receives and acts in real time, Claude Code / Codex get messages on their next turn — no human courier.
- 💬 **Ask a past session** — a read-only, non-persisted copy of a past Claude Code / Codex / pi session answers with its full context, without switching tools or disturbing the original (costs tokens; confirmation required by default).
- 📝 **Activity reports** — one sentence summarizes today / this week across agents: what you asked, what got committed, and what is still uncommitted.
- 🖥️ **Web UI** — `lingxi ui` opens a local page to browse today's activity, topics, transcripts, messages and reports, with live refresh.
- 🔒 **Local only** — data lives in `~/.lingxi/`; no network access, no external model calls. Thinking traces are not imported; common secret formats are masked.
- 🧩 **Vendor-neutral** — built on MCP and Agent Skills; supports Claude Code, Codex, pi, Cursor, WorkBuddy and Doubao Work, and new agents only need an adapter.

**Current version: v0.5.0** (see the [roadmap](#roadmap)).

---

## Quick start

### 1. Install

Requires **Node.js ≥ 22.13** (uses the built-in `node:sqlite`; no native dependencies to compile).

```bash
git clone https://github.com/yujiezhu1/lingxi.git
cd lingxi
npm install
npm run build
npm link                       # provides the global `lingxi` / `lx` commands
```

### 2. Connect your agents

```bash
lingxi install --dry-run       # preview which files would change
lingxi install                 # Claude Code, Codex, pi, Cursor, WorkBuddy (configs are backed up first)
```

**Doubao Work** needs one manual step: in *Custom connectors (MCP)* choose stdio and enter the command and arguments printed by `lingxi install doubao`, with the environment variable `LINGXI_AGENT=doubao`.

Start a **new session** afterwards (in pi, `/reload` works). See [config locations](docs/REFERENCE.md#各-agent-的接入位置).

### 3. Verify

In agent A (e.g. Codex):

> Save a handoff in Lingxi, topic "lingxi-check", next step "B reads it".

In agent B (e.g. pi):

> Load "lingxi-check" from Lingxi and tell me the latest handoff's title, author and next step.

If B can answer, you're connected. Clean up with `lingxi topic archive lingxi-check`.

### 4. Three phrases to remember

| When | Say to your agent |
|---|---|
| Starting a new session on existing work | "Load X from Lingxi" / "Load this project's background from Lingxi" |
| Before switching tools, or at a milestone | "Save a handoff to Lingxi, topic X" |
| A decision was made, or an approach failed | "Remember this in Lingxi" |

Forgot? Run **`lingxi guide`** in a terminal. To browse visually, run **`lingxi ui`**.

### Handy commands

```bash
lingxi topic ls -p                  # topics bound to the current project
lingxi topic show <topic>           # full overview of a topic
lingxi timeline --since 7d          # how the current project evolved this week
lingxi search -s "pdf font"         # search raw transcripts across agents
lingxi show codex:da497af449db#42   # open a session around turn 42
lingxi activity                     # what happened today, incl. uncommitted changes
lingxi who                          # which sessions are online
lingxi send research-pdf "uses FastAPI"   # message a session
```

---

## Documentation

Detailed docs are currently in Chinese:

| Doc | Content |
|---|---|
| [Usage guide](docs/USAGE.md) | Daily workflow, six scenarios, writing handoffs, cards, habits |
| [Reference](docs/REFERENCE.md) | MCP tools, CLI, config locations, data, environment variables |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Connection and usage issues, uninstall, FAQ |
| [Design](docs/DESIGN.md) | Background, architecture, data model, roadmap |
| [Changelog](CHANGELOG.md) | Version history |
| [Skill](skills/lingxi/SKILL.md) | Instructions for agents (English; installed into each agent) |

### MCP tools (23)

| Group | Tools |
|---|---|
| Topics | `topic_list`, `topic_create`, `topic_get`, `topic_link`, `topic_unlink`, `topic_timeline` |
| Handoffs | `save_handoff`, `load_handoff`, `list_handoffs` |
| Knowledge cards | `remember`, `recall`, `forget` |
| Search | `search` (handoffs + cards) |
| Sessions & activity | `list_sessions`, `search_sessions`, `read_session`, `get_activity` |
| Consultation | `consult_session` |
| Messaging | `whoami`, `register`, `list_agents`, `send_message`, `check_inbox` |

---

## Roadmap

| Stage | Scope | Status |
|---|---|---|
| P0 Hub | Handoffs, topics, cards, full-text search, MCP stdio, CLI, Skill, installer | ✅ v0.1.0 |
| P0.5 Project memory | Topics bound to project directories, timeline, `lingxi guide` | ✅ v0.1.0 |
| P1-a Sessions & activity | Import Claude Code / Codex / pi transcripts, search and read them; activity report incl. uncommitted changes | ✅ v0.2.0 |
| P1-a+ Desktop agents | Import Doubao Work (agent mode) and WorkBuddy transcripts; custom redaction rules | ✅ v0.2.1 |
| P1-b Background consultation | Ask a read-only, non-persisted copy of a past session; size estimate + confirmation | ✅ v0.3.0 |
| P1-c Cross-session messaging | Presence, inbox, real-time delivery via a pi extension, Claude Code / Codex hooks, unread notices | ✅ v0.4.0 |
| P3-a Web UI | `lingxi ui`: today, topics, sessions, unified search, messages, reports, status (read-mostly) | ✅ v0.5.0 |
| P2 | Cursor transcripts, presence detection, better CJK search | Planned |
| P3 | Background service (HTTP MCP, message delivery), local web UI | Planned |
| P4 | Remote agents, multi-device sync, team sharing | Planned |

---

## Development

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest: storage, projects, session import & queries, installer, MCP end-to-end
```

| Directory | Content |
|---|---|
| `src/core` | Storage (node:sqlite + FTS5 trigram), migrations, search, project matching, formatting |
| `src/ingest` | Session adapters (Claude Code, Codex, pi, Doubao Work, WorkBuddy), incremental sync, redaction |
| `src/mcp` | MCP server (stdio) |
| `src/ui` | Local server for the web UI (API, live events) |
| `web` | Web UI frontend (React + Vite, built into `dist/web`) |
| `src/cli` | `lingxi` command |
| `src/install` | MCP + Skill installer for each agent |
| `skills/lingxi` | Agent Skill |
| `docs` | Usage, reference, troubleshooting, design |
| `test` | Unit and end-to-end tests |

## License

Not yet decided — currently all rights reserved (`UNLICENSED`). A license will be added before the first public release.
