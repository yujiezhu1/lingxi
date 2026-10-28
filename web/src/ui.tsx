import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type ReactNode } from "react";
import { href } from "./router";

// ── formatting helpers ──

const pad = (n: number) => String(n).padStart(2, "0");

export function fmtTime(ms: number | null | undefined, withDate = true): string {
  if (!ms) return "";
  const d = new Date(ms);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!withDate) return t;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${t}`;
  const y = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return `昨天 ${t}`;
  return `${d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}-`}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${t}`;
}

export function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shortPath(p: string | null | undefined, keep = 2): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length <= keep ? p : "…/" + parts.slice(-keep).join("/");
}

// ── small components ──

const AGENT_META: Record<string, { name: string; color: string }> = {
  "claude-code": { name: "Claude Code", color: "#d97757" },
  codex: { name: "Codex", color: "#10a37f" },
  pi: { name: "pi", color: "#7c5cff" },
  cursor: { name: "Cursor", color: "#3b82f6" },
  workbuddy: { name: "WorkBuddy", color: "#0ea5e9" },
  doubao: { name: "豆包工作", color: "#f59e0b" },
  user: { name: "用户", color: "#64748b" },
  cli: { name: "CLI", color: "#64748b" },
};

export function agentName(a: string | null | undefined): string {
  return a ? (AGENT_META[a]?.name ?? a) : "未知";
}

export function AgentTag({ agent }: { agent: string | null | undefined }) {
  const m = agent ? AGENT_META[agent] : undefined;
  return (
    <span className="agent-tag" style={{ ["--c" as string]: m?.color ?? "#94a3b8" }}>
      {agentName(agent)}
    </span>
  );
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  decision: { label: "决策", cls: "k-decision" },
  fact: { label: "事实", cls: "k-fact" },
  finding: { label: "发现", cls: "k-finding" },
  constraint: { label: "约束", cls: "k-constraint" },
  todo: { label: "待办", cls: "k-todo" },
  dead_end: { label: "踩坑", cls: "k-dead" },
  note: { label: "备注", cls: "k-note" },
};
export const CARD_ORDER = ["decision", "constraint", "finding", "fact", "dead_end", "todo", "note"];

export function KindTag({ kind }: { kind: string | null }) {
  const m = kind ? KIND_META[kind] : undefined;
  return <span className={`kind-tag ${m?.cls ?? ""}`}>{m?.label ?? kind ?? ""}</span>;
}
export const kindLabel = (k: string) => KIND_META[k]?.label ?? k;

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <div className="empty">加载中…</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return <div className="error-box">出错了：{error}</div>;
}

export function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || extra) && (
        <header className="card-head">
          <h3>{title}</h3>
          {extra && <div className="card-extra">{extra}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

/** Turn a session ref ("pi:16eb5ec3b871#42") or full session id into a link to the session viewer. */
export function SessionLink({ id, seq, children }: { id: string; seq?: number; children: ReactNode }) {
  return <a href={href(`/sessions/${encodeURIComponent(id)}`, { seq })}>{children}</a>;
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** Highlight «…» markers produced by the search snippets. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span className="snippet">
      {parts.map((p, i) => (p.startsWith("«") ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </span>
  );
}
