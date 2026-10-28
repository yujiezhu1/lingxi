// Shapes returned by the Lingxi UI API (src/ui/server.ts).

export interface Topic {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  created_at: number;
  updated_at: number;
  handoffs?: number;
  cards?: number;
  projects?: string[];
}

export interface Handoff {
  id: string;
  topic_id: string | null;
  topic?: string | null;
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
  kind: string;
  content: string;
  refs: string[];
  author_agent: string | null;
  status: string;
  created_at: number;
}

export interface Link {
  id: number;
  target_type: string;
  target_id: string;
  note: string | null;
  created_at: number;
}

export interface SessionInfo {
  id: string;
  ref: string;
  agent: string;
  native_id: string;
  title: string | null;
  cwd: string | null;
  started_at: number | null;
  updated_at: number | null;
  turn_count: number;
  source_path?: string;
}

export interface TopicOverview {
  topic: Topic;
  projects: string[];
  recentSessions: SessionInfo[];
  links: Link[];
  latestHandoff: Handoff | null;
  otherHandoffs: Handoff[];
  cards: Card[];
}

export interface TimelineEvent {
  ts: number;
  type: "topic" | "handoff" | "card" | "link";
  topic_id: string | null;
  id: string;
  text: string;
  kind: string | null;
  author_agent: string | null;
  status: string | null;
}

export interface Turn {
  seq: number;
  role: "user" | "assistant" | "tool_call" | "tool_result";
  ts: number | null;
  text: string;
  tool_name: string | null;
}

export interface Presence {
  key: string;
  agent: string;
  session_native: string | null;
  label: string | null;
  cwd: string | null;
  via: string | null;
  topics: string[];
  activity: string | null;
  last_seen: number;
}

export interface Message {
  id: string;
  from_key: string | null;
  from_agent: string | null;
  from_label: string | null;
  to_kind: string;
  to_value: string;
  kind: string;
  body: string;
  refs: string[];
  reply_to: string | null;
  created_at: number;
  read_by_user?: boolean;
  to_user?: boolean;
}

export interface ActivitySession {
  id: string;
  agent: string;
  title: string | null;
  cwd: string | null;
  first_ts: number;
  last_ts: number;
  user_msgs: number;
  first_user: string | null;
  last_assistant: string | null;
}

export interface ActivityProject {
  root: string;
  isGit: boolean;
  sessions: ActivitySession[];
  notes: { type: "handoff" | "card"; id: string; topic: string; text: string; kind: string | null; author_agent: string | null; ts: number }[];
  git: { branch: string | null; commits: string[]; status: string[]; diffstat: string | null } | null;
}

export interface ActivityReport {
  since: number;
  until: number;
  projects: ActivityProject[];
  otherNotes: ActivityProject["notes"];
}
