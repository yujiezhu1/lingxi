export const CARD_KINDS = ["decision", "fact", "finding", "constraint", "todo", "dead_end", "note"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const LINK_TYPES = ["project", "session", "handoff", "card", "path", "url", "topic"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface Topic {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_at: number;
  updated_at: number;
}

export interface TopicLink {
  id: number;
  topic_id: string;
  target_type: LinkType;
  target_id: string;
  note: string | null;
  created_at: number;
}

export interface Handoff {
  id: string;
  topic_id: string | null;
  title: string;
  body_md: string;
  source_session: string | null;
  author_agent: string | null;
  refs: string[];
  supersedes: string | null;
  status: "active" | "superseded";
  created_at: number;
  file_path: string | null;
}

export interface Card {
  id: string;
  topic_id: string | null;
  kind: CardKind;
  content: string;
  refs: string[];
  author_agent: string | null;
  status: "active" | "archived";
  created_at: number;
  updated_at: number;
}

export interface SearchHit {
  doc_type: "handoff" | "card";
  doc_id: string;
  topic_id: string | null;
  title: string;
  snippet: string;
  created_at: number;
}

export type TimelineEventType = "topic" | "handoff" | "card" | "link";

export interface TimelineEvent {
  ts: number;
  type: TimelineEventType;
  topic_id: string | null;
  id: string;
  /** handoff title / card content / link target / topic name */
  text: string;
  /** card kind, link target_type, or 'created' for topics */
  kind: string | null;
  author_agent: string | null;
  /** superseded / archived marker, if any */
  status: string | null;
}
