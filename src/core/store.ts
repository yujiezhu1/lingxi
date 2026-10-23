import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.js";
import { isoLocal, newId, nowMs } from "./ids.js";
import { dbPath, lingxiHome, vaultDir } from "./paths.js";
import { matchProject, normalizeProjectPath, type ProjectMatch } from "./project.js";
import type { Card, CardKind, Handoff, LinkType, SearchHit, TimelineEvent, Topic, TopicLink } from "./types.js";

type Row = Record<string, unknown>;

export class LingxiError extends Error {}

export interface StoreOptions {
  home?: string;
  /** Write handoffs as Markdown into the vault (default true). */
  mirrorVault?: boolean;
}

export interface SaveHandoffInput {
  title: string;
  body_md: string;
  topic?: string | null;
  source_session?: string | null;
  author_agent?: string | null;
  refs?: string[];
  supersedes?: string | null;
}

export interface RememberInput {
  kind: CardKind;
  content: string;
  topic?: string | null;
  refs?: string[];
  author_agent?: string | null;
}

export interface TopicOverview {
  topic: Topic;
  projects: string[];
  links: TopicLink[];
  latestHandoff: Handoff | null;
  otherHandoffs: Handoff[];
  cards: Card[];
}

export type TopicSummary = Topic & { handoffs: number; cards: number; projects: string[]; match?: ProjectMatch };

export interface TimelineOptions {
  topic?: string;
  /** All topics bound to this project path (exact / ancestor / descendant match). */
  project?: string;
  since?: number;
  until?: number;
  limit?: number;
  order?: "asc" | "desc";
  /** Include superseded handoffs and archived cards (default true: it's a history). */
  includeInactive?: boolean;
}

export class LingxiStore {
  readonly db: DatabaseSync;
  readonly home: string;
  private readonly mirrorVault: boolean;

  constructor(opts: StoreOptions = {}) {
    this.home = opts.home ?? lingxiHome();
    this.mirrorVault = opts.mirrorVault ?? true;
    this.db = openDb(dbPath(this.home));
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ───────────────────────────── topics ─────────────────────────────

  createTopic(name: string, description?: string | null, project?: string | null): Topic {
    const clean = name.trim();
    if (!clean) throw new LingxiError("Topic name must not be empty");
    if (this.findTopic(clean)) throw new LingxiError(`Topic already exists: ${clean}`);
    const now = nowMs();
    const t: Topic = {
      id: newId("tp"),
      name: clean,
      description: description?.trim() || null,
      status: "active",
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare("INSERT INTO topics (id,name,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run(t.id, t.name, t.description, t.status, t.created_at, t.updated_at);
    if (project?.trim()) this.linkTopic(t.id, "project", project);
    return t;
  }

  /** Find by id or (case-insensitive) name. */
  findTopic(idOrName: string): Topic | null {
    const key = idOrName.trim();
    const row = this.db.prepare("SELECT * FROM topics WHERE id = ? OR name = ? COLLATE NOCASE LIMIT 1").get(key, key) as
      | Row
      | undefined;
    return row ? (row as unknown as Topic) : null;
  }

  getTopic(idOrName: string): Topic {
    const t = this.findTopic(idOrName);
    if (!t) throw new LingxiError(`Topic not found: ${idOrName}`);
    return t;
  }

  /** Resolve a topic reference, creating it when it does not exist yet. */
  ensureTopic(idOrName: string): Topic {
    return this.findTopic(idOrName) ?? this.createTopic(idOrName);
  }

  listTopics(opts: { status?: "active" | "archived" | "all"; project?: string } = {}): TopicSummary[] {
    const status = opts.status ?? "active";
    const where = status === "all" ? "" : "WHERE t.status = ?";
    const sql = `
      SELECT t.*,
        (SELECT COUNT(*) FROM handoffs h WHERE h.topic_id = t.id AND h.status = 'active') AS handoffs,
        (SELECT COUNT(*) FROM cards c WHERE c.topic_id = t.id AND c.status = 'active') AS cards
      FROM topics t ${where} ORDER BY t.updated_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = (status === "all" ? stmt.all() : stmt.all(status)) as unknown as TopicSummary[];
    const projects = this.allProjectLinks();
    const list = rows.map((t) => ({ ...t, projects: projects.get(t.id) ?? [] }));
    if (!opts.project?.trim()) return list;
    const rank: Record<ProjectMatch, number> = { exact: 0, ancestor: 1, descendant: 2 };
    return list
      .map((t) => {
        const matches = t.projects.map((p) => matchProject(p, opts.project!)).filter((m): m is ProjectMatch => m !== null);
        const best = matches.sort((a, b) => rank[a] - rank[b])[0];
        return best ? { ...t, match: best } : null;
      })
      .filter((t): t is TopicSummary & { match: ProjectMatch } => t !== null)
      .sort((a, b) => rank[a.match] - rank[b.match] || b.updated_at - a.updated_at);
  }

  /** topic_id → bound project paths */
  private allProjectLinks(): Map<string, string[]> {
    const rows = this.db
      .prepare("SELECT topic_id, target_id FROM topic_links WHERE target_type = 'project' ORDER BY created_at")
      .all() as { topic_id: string; target_id: string }[];
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.topic_id, [...(map.get(r.topic_id) ?? []), r.target_id]);
    return map;
  }

  topicProjects(idOrName: string): string[] {
    const t = this.getTopic(idOrName);
    return this.allProjectLinks().get(t.id) ?? [];
  }

  setTopicStatus(idOrName: string, status: "active" | "archived"): Topic {
    const t = this.getTopic(idOrName);
    this.db.prepare("UPDATE topics SET status = ?, updated_at = ? WHERE id = ?").run(status, nowMs(), t.id);
    return this.getTopic(t.id);
  }

  private touchTopic(topicId: string | null): void {
    if (topicId) this.db.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(nowMs(), topicId);
  }

  linkTopic(topic: string, targetType: LinkType, targetId: string, note?: string | null): TopicLink {
    const t = this.ensureTopic(topic);
    const now = nowMs();
    const target = targetType === "project" ? normalizeProjectPath(targetId) : targetId.trim();
    if (!target) throw new LingxiError("Link target must not be empty");
    this.db
      .prepare(
        `INSERT INTO topic_links (topic_id,target_type,target_id,note,created_at) VALUES (?,?,?,?,?)
         ON CONFLICT(topic_id,target_type,target_id) DO UPDATE SET note = COALESCE(excluded.note, topic_links.note)`,
      )
      .run(t.id, targetType, target, note?.trim() || null, now);
    // Linking an existing handoff / card also moves it into the topic if it had none.
    if (targetType === "handoff") {
      this.db.prepare("UPDATE handoffs SET topic_id = ? WHERE id = ? AND topic_id IS NULL").run(t.id, targetId);
      this.db.prepare("UPDATE docs_fts SET topic_id = ? WHERE doc_type='handoff' AND doc_id = ? AND topic_id IS NULL").run(t.id, targetId);
    } else if (targetType === "card") {
      this.db.prepare("UPDATE cards SET topic_id = ? WHERE id = ? AND topic_id IS NULL").run(t.id, targetId);
      this.db.prepare("UPDATE docs_fts SET topic_id = ? WHERE doc_type='card' AND doc_id = ? AND topic_id IS NULL").run(t.id, targetId);
    }
    this.touchTopic(t.id);
    return this.db
      .prepare("SELECT * FROM topic_links WHERE topic_id = ? AND target_type = ? AND target_id = ?")
      .get(t.id, targetType, target) as unknown as TopicLink;
  }

  /** Remove a link. For projects the path is normalized and compared case-insensitively on Windows/macOS. */
  unlinkTopic(topic: string, targetType: LinkType, targetId: string): boolean {
    const t = this.getTopic(topic);
    const links = this.db
      .prepare("SELECT id, target_id FROM topic_links WHERE topic_id = ? AND target_type = ?")
      .all(t.id, targetType) as { id: number; target_id: string }[];
    const victim = links.find((l) =>
      targetType === "project" ? matchProject(l.target_id, targetId) === "exact" : l.target_id === targetId.trim(),
    );
    if (!victim) return false;
    this.db.prepare("DELETE FROM topic_links WHERE id = ?").run(victim.id);
    this.touchTopic(t.id);
    return true;
  }

  topicOverview(idOrName: string, opts: { cardLimit?: number; handoffLimit?: number } = {}): TopicOverview {
    const topic = this.getTopic(idOrName);
    const links = this.db
      .prepare("SELECT * FROM topic_links WHERE topic_id = ? ORDER BY created_at")
      .all(topic.id) as unknown as TopicLink[];
    const handoffs = this.listHandoffs({ topic: topic.id, limit: (opts.handoffLimit ?? 10) + 1 });
    const cards = this.listCards({ topic: topic.id, limit: opts.cardLimit ?? 50 });
    return {
      topic,
      projects: links.filter((l) => l.target_type === "project").map((l) => l.target_id),
      links: links.filter((l) => l.target_type !== "project"),
      latestHandoff: handoffs[0] ?? null,
      otherHandoffs: handoffs.slice(1),
      cards,
    };
  }

  // ───────────────────────────── timeline ─────────────────────────────

  /**
   * Chronological history of a topic, or of every topic bound to a project:
   * topic creation, handoffs (incl. superseded), cards (incl. archived) and links.
   */
  timeline(opts: TimelineOptions): TimelineEvent[] {
    let topicIds: string[];
    if (opts.topic) topicIds = [this.getTopic(opts.topic).id];
    else if (opts.project) topicIds = this.listTopics({ status: "all", project: opts.project }).map((t) => t.id);
    else throw new LingxiError("timeline needs a topic or a project");
    if (!topicIds.length) return [];

    const inactive = opts.includeInactive ?? true;
    const ph = topicIds.map(() => "?").join(",");
    const since = opts.since ?? 0;
    const until = opts.until ?? Number.MAX_SAFE_INTEGER;
    const sql = `
      SELECT created_at AS ts, 'topic' AS type, id AS topic_id, id, name AS text, 'created' AS kind,
             NULL AS author_agent, NULL AS status
        FROM topics WHERE id IN (${ph})
      UNION ALL
      SELECT created_at, 'handoff', topic_id, id, title, NULL, author_agent,
             CASE WHEN status = 'superseded' THEN 'superseded' ELSE NULL END
        FROM handoffs WHERE topic_id IN (${ph}) ${inactive ? "" : "AND status = 'active'"}
      UNION ALL
      SELECT created_at, 'card', topic_id, id, content, kind, author_agent,
             CASE WHEN status = 'archived' THEN 'archived' ELSE NULL END
        FROM cards WHERE topic_id IN (${ph}) ${inactive ? "" : "AND status = 'active'"}
      UNION ALL
      SELECT created_at, 'link', topic_id, CAST(id AS TEXT), target_id || COALESCE(' — ' || note, ''), target_type,
             NULL, NULL
        FROM topic_links WHERE topic_id IN (${ph})`;
    const rows = this.db
      .prepare(`SELECT * FROM (${sql}) WHERE ts >= ? AND ts <= ? ORDER BY ts ${opts.order === "desc" ? "DESC" : "ASC"}, CASE type WHEN 'topic' THEN 0 WHEN 'link' THEN 1 ELSE 2 END ${opts.order === "desc" ? "DESC" : "ASC"} LIMIT ?`)
      .all(...topicIds, ...topicIds, ...topicIds, ...topicIds, since, until, opts.limit ?? 200) as unknown as TimelineEvent[];
    return rows.map((r) => ({ ...r, ts: Number(r.ts) }));
  }

  // ───────────────────────────── handoffs ─────────────────────────────

  saveHandoff(input: SaveHandoffInput): Handoff {
    const title = input.title.trim();
    const body = input.body_md.trim();
    if (!title) throw new LingxiError("Handoff title must not be empty");
    if (!body) throw new LingxiError("Handoff body must not be empty");

    return this.tx(() => {
      const topic = input.topic ? this.ensureTopic(input.topic) : null;
      let supersedes: string | null = null;
      if (input.supersedes) {
        const old = this.getHandoff(input.supersedes);
        supersedes = old.id;
      }
      const h: Handoff = {
        id: newId("ho"),
        topic_id: topic?.id ?? null,
        title,
        body_md: body,
        source_session: input.source_session?.trim() || null,
        author_agent: input.author_agent?.trim() || null,
        refs: dedupe(input.refs ?? []),
        supersedes,
        status: "active",
        created_at: nowMs(),
        file_path: null,
      };
      if (this.mirrorVault) h.file_path = this.writeHandoffFile(h, topic);
      this.db
        .prepare(
          `INSERT INTO handoffs (id,topic_id,title,body_md,source_session,author_agent,refs,supersedes,status,created_at,file_path)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          h.id, h.topic_id, h.title, h.body_md, h.source_session, h.author_agent,
          JSON.stringify(h.refs), h.supersedes, h.status, h.created_at, h.file_path,
        );
      if (supersedes) this.db.prepare("UPDATE handoffs SET status = 'superseded' WHERE id = ?").run(supersedes);
      this.indexDoc("handoff", h.id, h.topic_id, h.title, h.body_md);
      this.touchTopic(h.topic_id);
      return h;
    });
  }

  getHandoff(id: string): Handoff {
    const row = this.db.prepare("SELECT * FROM handoffs WHERE id = ?").get(id.trim()) as Row | undefined;
    if (!row) throw new LingxiError(`Handoff not found: ${id}`);
    return toHandoff(row);
  }

  /** Latest active handoff of a topic (or globally when topic omitted). */
  latestHandoff(topic?: string | null): Handoff | null {
    const list = this.listHandoffs({ topic: topic ?? undefined, limit: 1 });
    return list[0] ?? null;
  }

  listHandoffs(opts: { topic?: string; includeSuperseded?: boolean; limit?: number } = {}): Handoff[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.topic) {
      where.push("topic_id = ?");
      args.push(this.getTopic(opts.topic).id);
    }
    if (!opts.includeSuperseded) where.push("status = 'active'");
    const sql = `SELECT * FROM handoffs ${where.length ? "WHERE " + where.join(" AND ") : ""}
                 ORDER BY created_at DESC LIMIT ?`;
    args.push(opts.limit ?? 20);
    return (this.db.prepare(sql).all(...args) as Row[]).map(toHandoff);
  }

  private writeHandoffFile(h: Handoff, topic: Topic | null): string {
    const month = isoLocal(h.created_at).slice(0, 7);
    const dir = join(vaultDir(this.home), "handoffs", month);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${h.id}.md`);
    writeFileSync(file, renderHandoffFile(h, topic), "utf8");
    return file;
  }

  // ───────────────────────────── cards ─────────────────────────────

  remember(input: RememberInput): Card {
    const content = input.content.trim();
    if (!content) throw new LingxiError("Card content must not be empty");
    return this.tx(() => {
      const topic = input.topic ? this.ensureTopic(input.topic) : null;
      const now = nowMs();
      const c: Card = {
        id: newId("cd"),
        topic_id: topic?.id ?? null,
        kind: input.kind,
        content,
        refs: dedupe(input.refs ?? []),
        author_agent: input.author_agent?.trim() || null,
        status: "active",
        created_at: now,
        updated_at: now,
      };
      this.db
        .prepare(
          `INSERT INTO cards (id,topic_id,kind,content,refs,author_agent,status,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(c.id, c.topic_id, c.kind, c.content, JSON.stringify(c.refs), c.author_agent, c.status, c.created_at, c.updated_at);
      this.indexDoc("card", c.id, c.topic_id, `[${c.kind}]`, c.content);
      this.touchTopic(c.topic_id);
      return c;
    });
  }

  getCard(id: string): Card {
    const row = this.db.prepare("SELECT * FROM cards WHERE id = ?").get(id.trim()) as Row | undefined;
    if (!row) throw new LingxiError(`Card not found: ${id}`);
    return toCard(row);
  }

  forget(id: string): Card {
    const c = this.getCard(id);
    this.db.prepare("UPDATE cards SET status = 'archived', updated_at = ? WHERE id = ?").run(nowMs(), c.id);
    this.db.prepare("DELETE FROM docs_fts WHERE doc_type = 'card' AND doc_id = ?").run(c.id);
    return this.getCard(c.id);
  }

  listCards(opts: { topic?: string; kind?: CardKind; limit?: number; includeArchived?: boolean } = {}): Card[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.topic) {
      where.push("topic_id = ?");
      args.push(this.getTopic(opts.topic).id);
    }
    if (opts.kind) {
      where.push("kind = ?");
      args.push(opts.kind);
    }
    if (!opts.includeArchived) where.push("status = 'active'");
    const sql = `SELECT * FROM cards ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
    args.push(opts.limit ?? 50);
    return (this.db.prepare(sql).all(...args) as Row[]).map(toCard);
  }

  // ───────────────────────────── search ─────────────────────────────

  private indexDoc(type: "handoff" | "card", id: string, topicId: string | null, title: string, body: string): void {
    this.db.prepare("DELETE FROM docs_fts WHERE doc_type = ? AND doc_id = ?").run(type, id);
    this.db.prepare("INSERT INTO docs_fts (doc_type,doc_id,topic_id,title,body) VALUES (?,?,?,?,?)").run(type, id, topicId, title, body);
  }

  /**
   * Full-text search over handoffs and cards.
   * Terms are AND-ed. trigram FTS needs ≥3 chars per term; shorter terms (common for Chinese words)
   * fall back to LIKE so that e.g. "交接" still matches.
   */
  search(query: string, opts: { topic?: string; type?: "handoff" | "card"; limit?: number; includeSuperseded?: boolean } = {}): SearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const limit = opts.limit ?? 10;
    const filters: string[] = [];
    const fargs: string[] = [];
    if (opts.topic) {
      filters.push("docs_fts.topic_id = ?");
      fargs.push(this.getTopic(opts.topic).id);
    }
    if (opts.type) {
      filters.push("docs_fts.doc_type = ?");
      fargs.push(opts.type);
    }
    if (!opts.includeSuperseded) {
      filters.push("NOT (docs_fts.doc_type = 'handoff' AND docs_fts.doc_id IN (SELECT id FROM handoffs WHERE status = 'superseded'))");
    }
    const created = `COALESCE((SELECT created_at FROM handoffs WHERE id = docs_fts.doc_id),(SELECT created_at FROM cards WHERE id = docs_fts.doc_id))`;

    let rows: Row[];
    if (terms.every((t) => [...t].length >= 3)) {
      const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
      const sql = `
        SELECT docs_fts.doc_type, docs_fts.doc_id, docs_fts.topic_id, docs_fts.title,
               snippet(docs_fts, 4, '«', '»', ' … ', 24) AS snippet, ${created} AS created_at
        FROM docs_fts WHERE docs_fts MATCH ? ${filters.map((x) => "AND " + x).join(" ")}
        ORDER BY bm25(docs_fts) LIMIT ?`;
      rows = this.db.prepare(sql).all(match, ...fargs, limit) as Row[];
    } else {
      const likes = terms.map(() => "(docs_fts.title LIKE ? ESCAPE '\\' OR docs_fts.body LIKE ? ESCAPE '\\')");
      const largs = terms.flatMap((t) => {
        const p = `%${t.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
        return [p, p];
      });
      const sql = `
        SELECT docs_fts.doc_type, docs_fts.doc_id, docs_fts.topic_id, docs_fts.title, docs_fts.body AS body, ${created} AS created_at
        FROM docs_fts WHERE ${[...likes, ...filters].join(" AND ")}
        ORDER BY created_at DESC LIMIT ?`;
      rows = (this.db.prepare(sql).all(...largs, ...fargs, limit) as Row[]).map((r) => ({
        ...r,
        snippet: makeSnippet(String(r.body ?? ""), terms[0]!),
      }));
    }
    return rows.map((r) => ({
      doc_type: r.doc_type as "handoff" | "card",
      doc_id: String(r.doc_id),
      topic_id: (r.topic_id as string | null) ?? null,
      title: String(r.title ?? ""),
      snippet: String(r.snippet ?? ""),
      created_at: Number(r.created_at ?? 0),
    }));
  }

  topicName(topicId: string | null): string | null {
    if (!topicId) return null;
    const row = this.db.prepare("SELECT name FROM topics WHERE id = ?").get(topicId) as { name: string } | undefined;
    return row?.name ?? null;
  }

  stats(): { topics: number; handoffs: number; cards: number; home: string } {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      topics: n("SELECT COUNT(*) AS n FROM topics"),
      handoffs: n("SELECT COUNT(*) AS n FROM handoffs"),
      cards: n("SELECT COUNT(*) AS n FROM cards WHERE status = 'active'"),
      home: this.home,
    };
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function dedupe(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

function parseJsonArray(v: unknown): string[] {
  try {
    const arr = JSON.parse(String(v ?? "[]"));
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function toHandoff(r: Row): Handoff {
  return { ...(r as unknown as Handoff), refs: parseJsonArray(r.refs) };
}

function toCard(r: Row): Card {
  return { ...(r as unknown as Card), refs: parseJsonArray(r.refs) };
}

function makeSnippet(body: string, term: string, radius = 40): string {
  const flat = body.replace(/\s+/g, " ");
  const i = flat.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return flat.slice(0, radius * 2);
  const start = Math.max(0, i - radius);
  const end = Math.min(flat.length, i + term.length + radius);
  return (
    (start > 0 ? "… " : "") +
    flat.slice(start, i) + "«" + flat.slice(i, i + term.length) + "»" + flat.slice(i + term.length, end) +
    (end < flat.length ? " …" : "")
  );
}

function yamlStr(s: string): string {
  return JSON.stringify(s); // JSON strings are valid YAML scalars
}

export function renderHandoffFile(h: Handoff, topic: Topic | null): string {
  const fm = [
    "---",
    `id: ${h.id}`,
    `title: ${yamlStr(h.title)}`,
    topic ? `topic: ${yamlStr(topic.name)}` : null,
    h.source_session ? `source: ${yamlStr(h.source_session)}` : null,
    h.author_agent ? `author_agent: ${yamlStr(h.author_agent)}` : null,
    `created_at: ${isoLocal(h.created_at)}`,
    h.supersedes ? `supersedes: ${h.supersedes}` : null,
    h.refs.length ? `refs:\n${h.refs.map((r) => `  - ${yamlStr(r)}`).join("\n")}` : null,
    "---",
  ].filter((x) => x !== null);
  return `${fm.join("\n")}\n\n${h.body_md}\n`;
}
