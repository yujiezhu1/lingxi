import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LingxiError,
  LingxiStore,
  SCHEMA_VERSION,
  activityRange,
  activityReport,
  fmtActivity,
  inboxFor,
  listPresence,
  listSessions,
  markRead,
  parseTimeBound,
  searchSessions,
  sendMessage,
  shortRef,
  upsertPresence,
  type Message,
  type MessageKind,
} from "../core/index.js";
import { Ingestor } from "../ingest/index.js";
import { VERSION } from "../version.js";
import { projects, weave } from "./views.js";

export interface UiServerOptions {
  port?: number;
  token?: string;
  home?: string;
  /** Background session import interval (0 disables). */
  syncIntervalMs?: number;
  webRoot?: string;
}

export interface UiServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function defaultWebRoot(): string {
  return fileURLToPath(new URL("../web/", import.meta.url));
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new HttpError(413, "Body too large"));
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolveBody(text ? (JSON.parse(text) as Record<string, unknown>) : {});
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** The human using the UI, as a message participant (same identity as the `lingxi send` CLI). */
function uiUser(store: LingxiStore) {
  return upsertPresence(store.db, { key: "user:terminal", agent: "user", session_native: "terminal", via: "cli", label: "user" });
}

function messageView(m: Message, readers: Set<string>) {
  return { ...m, read_by_user: readers.has(m.id) };
}

export async function startUiServer(opts: UiServerOptions = {}): Promise<UiServer> {
  const store = new LingxiStore({ home: opts.home });
  const ingestor = new Ingestor(store);
  const token = opts.token ?? randomBytes(18).toString("base64url");
  const webRoot = resolve(opts.webRoot ?? defaultWebRoot());
  let port = opts.port ?? 0;

  const safeSync = () => {
    try {
      return ingestor.sync();
    } catch {
      return null;
    }
  };

  // ───────────── change detection for live refresh ─────────────
  const signature = (): string => {
    const r = store.db
      .prepare(
        `SELECT (SELECT MAX(updated_at) FROM topics) a, (SELECT COUNT(*) FROM handoffs) b, (SELECT MAX(updated_at) FROM cards) c,
                (SELECT COUNT(*) FROM cards) d, (SELECT COUNT(*) FROM messages) e, (SELECT COUNT(*) FROM message_reads) f,
                (SELECT MAX(updated_at) FROM sessions) g, (SELECT COUNT(*) FROM sessions) h, (SELECT COUNT(*) FROM presence) i,
                (SELECT MAX(last_seen) / 60000 FROM presence) j`,
      )
      .get() as Record<string, unknown>;
    return JSON.stringify(r);
  };
  const clients = new Set<ServerResponse>();
  let lastSig = signature();
  const watcher = setInterval(() => {
    try {
      const sig = signature();
      if (sig !== lastSig) {
        lastSig = sig;
        for (const c of clients) c.write(`event: change\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
      }
    } catch {
      /* db busy */
    }
  }, 2000);
  const pinger = setInterval(() => {
    for (const c of clients) c.write(`: ping\n\n`);
  }, 20_000);
  const syncTimer = opts.syncIntervalMs === 0 ? null : setInterval(safeSync, opts.syncIntervalMs ?? 30_000);

  // ───────────── API ─────────────
  const api = async (method: string, path: string, q: URLSearchParams, req: IncomingMessage): Promise<unknown> => {
    const seg = path.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // drop "api"
    const num = (k: string, d: number) => {
      const v = Number(q.get(k));
      return Number.isFinite(v) && q.get(k) !== null ? v : d;
    };
    const str = (k: string) => q.get(k)?.trim() || undefined;

    if (method === "GET") {
      switch (seg[0]) {
        case "status": {
          const s = store.stats();
          const sessions = store.db.prepare("SELECT agent, COUNT(*) AS n, SUM(turn_count) AS turns FROM sessions GROUP BY agent").all();
          return { version: VERSION, schema: SCHEMA_VERSION, ...s, sessions, online: listPresence(store.db).filter((p) => p.agent !== "user").length };
        }
        case "today": {
          const range = activityRange("today");
          const report = activityReport(store, { ...range, git: str("git") !== "0", sessionLimit: 8 });
          const me = uiUser(store);
          const recent = (store.db.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT 8").all() as Record<string, unknown>[]).map(
            (r) => ({ ...r, refs: JSON.parse(String(r.refs ?? "[]")) }),
          );
          return {
            report,
            presence: listPresence(store.db).filter((p) => p.agent !== "user"),
            topics: store.listTopics().slice(0, 8),
            unread: inboxFor(store.db, me).length,
            messages: recent,
          };
        }
        case "topics": {
          if (!seg[1]) return store.listTopics({ status: (str("status") as "active" | "archived" | "all") ?? "active" });
          if (seg[2] === "timeline") {
            return store.timeline({ topic: seg[1], since: parseTimeBound(str("since")), order: "desc", limit: num("limit", 300) });
          }
          const o = store.topicOverview(seg[1], { cardLimit: 200, handoffLimit: 50, sessionLimit: 10 });
          return { ...o, recentSessions: o.recentSessions.map((s) => ({ ...s, ref: shortRef(s) })) };
        }
        case "handoffs": {
          if (seg[1]) {
            const h = store.getHandoff(seg[1]);
            return { ...h, topic: store.topicName(h.topic_id) };
          }
          return store.listHandoffs({ topic: str("topic"), includeSuperseded: str("all") === "1", limit: num("limit", 50) });
        }
        case "sessions": {
          if (!seg[1]) {
            return listSessions(store.db, {
              agent: str("agent"),
              project: str("project"),
              since: parseTimeBound(str("since")),
              limit: Math.min(num("limit", 100), 1000),
            }).map((s) => ({ ...s, ref: shortRef(s) }));
          }
          const s = store.db.prepare("SELECT id, agent, native_id, title, cwd, started_at, updated_at, turn_count, source_path FROM sessions WHERE id = ?").get(seg[1]) as
            | Record<string, unknown>
            | undefined;
          if (!s) throw new HttpError(404, `Session not found: ${seg[1]}`);
          const tools = str("tools") === "1";
          const from = Math.max(1, num("from", 1));
          const limit = Math.min(num("limit", 200), 1000);
          const turns = store.db
            .prepare(
              `SELECT seq, role, ts, text, tool_name FROM turns WHERE session_id = ? AND seq >= ? ${tools ? "" : "AND role IN ('user','assistant')"}
               ORDER BY seq LIMIT ?`,
            )
            .all(seg[1], from, limit);
          return { session: { ...s, ref: shortRef(s as { agent: string; native_id: string }) }, turns, from, limit };
        }
        case "search": {
          const query = str("q");
          if (!query) return { notes: [], sessions: [] };
          const scope = str("scope") ?? "all";
          const limit = Math.min(num("limit", 20), 100);
          const notes =
            scope === "sessions"
              ? []
              : store.search(query, { limit }).map((h) => ({ ...h, topic: store.topicName(h.topic_id) }));
          const sessions =
            scope === "notes"
              ? []
              : searchSessions(store.db, query, { agent: str("agent"), limit, includeTools: str("tools") === "1" }).map((h) => ({
                  ...h,
                  ref: `${shortRef({ agent: h.agent, native_id: h.session_id.slice(h.session_id.indexOf(":") + 1) })}#${h.seq}`,
                }));
          return { notes, sessions };
        }
        case "activity": {
          const range = activityRange(str("date"), str("since"), str("until"));
          const report = activityReport(store, { ...range, project: str("project"), git: str("git") !== "0" });
          return { report, markdown: fmtActivity(report, { maxSessionsPerProject: 30 }) };
        }
        case "messages": {
          const me = uiUser(store);
          const reads = new Set(
            (store.db.prepare("SELECT message_id FROM message_reads WHERE reader_key = ?").all(me.key) as { message_id: string }[]).map((r) => r.message_id),
          );
          const inboxIds = new Set(inboxFor(store.db, me, { includeRead: true, limit: 500 }).map((m) => m.id));
          const rows = store.db.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?").all(Math.min(num("limit", 100), 500)) as Record<string, unknown>[];
          return {
            messages: rows.map((r) => ({ ...messageView({ ...(r as unknown as Message), refs: JSON.parse(String(r.refs ?? "[]")) }, reads), to_user: inboxIds.has(String(r.id)) })),
            presence: listPresence(store.db, { all: str("all") === "1" }).filter((p) => p.agent !== "user"),
            unread: inboxFor(store.db, me).length,
          };
        }
        case "presence":
          return listPresence(store.db, { all: str("all") === "1" });
        case "weave": {
          const range = activityRange(str("date"), str("since"), str("until"));
          return weave(store, range.since, range.until);
        }
        case "projects":
          return projects(store, parseTimeBound(str("since") ?? "14d")!, Math.min(num("limit", 8), 30));
      }
    }

    if (method === "POST") {
      const body = await readBody(req);
      switch (seg[0]) {
        case "sync":
          return safeSync();
        case "messages": {
          if (seg[1] === "read") {
            const me = uiUser(store);
            const ids = inboxFor(store.db, me).map((m) => m.id);
            markRead(store.db, me.key, ids);
            return { marked: ids.length };
          }
          const me = uiUser(store);
          const { message, target } = sendMessage(store.db, me, String(body.to ?? ""), String(body.body ?? ""), {
            kind: (body.kind as MessageKind | undefined) ?? undefined,
            reply_to: body.reply_to ? String(body.reply_to) : undefined,
          });
          return { message, target: { describe: target.describe, live: target.liveRecipients.map((p) => p.label) } };
        }
      }
    }
    throw new HttpError(404, `Unknown API: ${method} ${path}`);
  };

  // ───────────── static files ─────────────
  const serveStatic = (path: string, res: ServerResponse) => {
    if (!existsSync(join(webRoot, "index.html"))) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Lingxi UI is not built. Run `npm run build` in the lingxi project.");
      return;
    }
    let file = resolve(webRoot, "." + normalize(decodeURIComponent(path)));
    if (!file.startsWith(webRoot + sep) && file !== webRoot) throw new HttpError(403, "Forbidden");
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, "index.html"); // SPA fallback
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const cache = file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" });
    res.end(readFileSync(file));
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // DNS-rebinding protection: only accept our own host names.
      const host = (req.headers.host ?? "").toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "Bad host");

      if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res);

      const headerToken = req.headers["x-lingxi-token"];
      const given = (Array.isArray(headerToken) ? headerToken[0] : headerToken) ?? url.searchParams.get("token");
      if (given !== token) throw new HttpError(401, "Missing or invalid token");
      if (req.method !== "GET") {
        // State-changing requests: header token only (never from the URL) and same-origin.
        if (headerToken !== token) throw new HttpError(401, "Token header required");
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) throw new HttpError(403, "Bad origin");
      }

      if (url.pathname === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(`event: hello\ndata: {}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }

      const data = await api(req.method ?? "GET", url.pathname, url.searchParams, req);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(data ?? null));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : err instanceof LingxiError ? 400 : 500;
      if (!res.headersSent) res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });

  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok());
  });
  port = (server.address() as { port: number }).port;
  setImmediate(safeSync); // first import in the background

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    close: async () => {
      clearInterval(watcher);
      clearInterval(pinger);
      if (syncTimer) clearInterval(syncTimer);
      for (const c of clients) c.end();
      await new Promise<void>((ok) => server.close(() => ok()));
      store.close();
    },
  };
}

