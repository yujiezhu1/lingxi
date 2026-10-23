import { shortDate } from "./ids.js";
import type { LingxiStore, TopicOverview } from "./store.js";
import type { Card, Handoff, SearchHit, TimelineEvent, Topic } from "./types.js";

/** Plain-text / Markdown renderers shared by the MCP server and the CLI. */

export function fmtHandoffFull(h: Handoff, store: LingxiStore): string {
  const meta = [
    `id: ${h.id}`,
    store.topicName(h.topic_id) ? `topic: ${store.topicName(h.topic_id)}` : null,
    h.author_agent ? `author: ${h.author_agent}` : null,
    h.source_session ? `source: ${h.source_session}` : null,
    `created: ${shortDate(h.created_at)}`,
    h.status === "superseded" ? "status: superseded (a newer handoff replaces this one)" : null,
    h.supersedes ? `supersedes: ${h.supersedes}` : null,
    h.refs.length ? `refs: ${h.refs.join(", ")}` : null,
    h.file_path ? `file: ${h.file_path}` : null,
  ].filter(Boolean);
  return `# ${h.title}\n\n> ${meta.join(" | ")}\n\n${h.body_md}`;
}

export function fmtHandoffLine(h: Handoff, store?: LingxiStore): string {
  const topic = store?.topicName(h.topic_id);
  return `- ${h.id}  ${shortDate(h.created_at)}  ${h.title}` +
    (topic ? `  [topic: ${topic}]` : "") +
    (h.author_agent ? `  (by ${h.author_agent})` : "") +
    (h.status === "superseded" ? "  (superseded)" : "");
}

export function fmtCardLine(c: Card, store?: LingxiStore): string {
  const topic = store?.topicName(c.topic_id);
  return `- [${c.kind}] ${c.content.replace(/\s*\n\s*/g, " ")}` +
    `  (${c.id}${topic ? `, topic: ${topic}` : ""}${c.author_agent ? `, by ${c.author_agent}` : ""}` +
    `${c.refs.length ? `, refs: ${c.refs.join(" ")}` : ""})`;
}

export function fmtTopicLine(
  t: Topic & { handoffs?: number; cards?: number; projects?: string[]; match?: string },
): string {
  return `- ${t.name}  (${t.id}, updated ${shortDate(t.updated_at)}` +
    (t.handoffs !== undefined ? `, ${t.handoffs} handoffs, ${t.cards} cards` : "") +
    (t.status === "archived" ? ", archived" : "") +
    (t.match && t.match !== "exact" ? `, ${t.match === "ancestor" ? "bound to a parent folder" : "bound to a sub-folder"}` : "") + ")" +
    (t.description ? `\n  ${t.description}` : "") +
    (t.projects?.length ? `\n  project: ${t.projects.join(" | ")}` : "");
}

export function fmtTopicOverview(o: TopicOverview, store: LingxiStore, opts: { maxBodyChars?: number } = {}): string {
  const out: string[] = [];
  out.push(`# Topic: ${o.topic.name}  (${o.topic.id}${o.topic.status === "archived" ? ", archived" : ""})`);
  if (o.topic.description) out.push(o.topic.description);
  if (o.projects.length) out.push(`Project: ${o.projects.join(" | ")}`);

  out.push("", "## Latest handoff");
  if (o.latestHandoff) {
    let full = fmtHandoffFull(o.latestHandoff, store);
    const max = opts.maxBodyChars ?? 12000;
    if (full.length > max) full = full.slice(0, max) + `\n\n…(truncated, call load_handoff id=${o.latestHandoff.id} for the full text)`;
    out.push(full.replace(/^# /, "### "));
  } else {
    out.push("(none yet)");
  }

  if (o.otherHandoffs.length) {
    out.push("", "## Earlier handoffs");
    out.push(...o.otherHandoffs.map((h) => fmtHandoffLine(h)));
  }

  out.push("", "## Knowledge cards");
  if (o.cards.length) {
    const order = ["decision", "constraint", "finding", "fact", "dead_end", "todo", "note"];
    const sorted = [...o.cards].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    out.push(...sorted.map((c) => fmtCardLine(c)));
  } else {
    out.push("(none yet)");
  }

  if (o.links.length) {
    out.push("", "## Linked items");
    out.push(...o.links.map((l) => `- ${l.target_type}: ${l.target_id}${l.note ? ` — ${l.note}` : ""}`));
  }
  return out.join("\n");
}

export function fmtSearchHits(hits: SearchHit[], store: LingxiStore): string {
  if (!hits.length) return "No results.";
  return hits
    .map((h) => {
      const topic = store.topicName(h.topic_id);
      return `- ${h.doc_type} ${h.doc_id}  ${shortDate(h.created_at)}${topic ? `  [topic: ${topic}]` : ""}\n  ${h.title}\n  ${h.snippet}`;
    })
    .join("\n");
}

const EVENT_LABEL: Record<string, string> = { topic: "topic", handoff: "handoff", card: "card", link: "link" };

/** Timeline grouped by day. `showTopic` adds the topic name (useful for project-wide timelines). */
export function fmtTimeline(events: TimelineEvent[], store: LingxiStore, opts: { showTopic?: boolean } = {}): string {
  if (!events.length) return "No events.";
  const out: string[] = [];
  let day = "";
  for (const e of events) {
    const stamp = shortDate(e.ts);
    const d = stamp.slice(0, 10);
    if (d !== day) {
      if (day) out.push("");
      out.push(`## ${d}`);
      day = d;
    }
    const time = stamp.slice(11);
    const topic = opts.showTopic ? ` {${store.topicName(e.topic_id) ?? "?"}}` : "";
    const who = e.author_agent ? ` (by ${e.author_agent})` : "";
    const st = e.status ? ` [${e.status}]` : "";
    let body: string;
    switch (e.type) {
      case "topic":
        body = `topic created: ${e.text}`;
        break;
      case "handoff":
        body = `handoff ${e.id}: ${e.text}`;
        break;
      case "card":
        body = `[${e.kind}] ${e.text.replace(/\s*\n\s*/g, " ")}  (${e.id})`;
        break;
      default:
        body = `linked ${e.kind}: ${e.text}`;
    }
    out.push(`- ${time} ${EVENT_LABEL[e.type]}${topic}  ${body}${who}${st}`);
  }
  return out.join("\n");
}
