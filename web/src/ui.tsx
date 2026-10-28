import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { href } from "./router";

// ── formatting ──
const pad = (n: number) => String(n).padStart(2, "0");
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function fmtTime(ms: number | null | undefined, withDate = true): string {
  if (!ms) return "";
  const d = new Date(ms);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!withDate) return t;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${t}`;
  if (d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString()) return `昨天 ${t}`;
  return `${d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日 ${t}`;
}
export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`;
}
export function fmtAgo(ms: number | null | undefined): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "刚刚";
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
  return parts.length <= keep ? p.replace(/\\/g, "/") : "…/" + parts.slice(-keep).join("/");
}
export function lastSeg(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

// ── agents ──
export const AGENTS: Record<string, { name: string; color: string }> = {
  "claude-code": { name: "Claude Code", color: "var(--a-claude)" },
  codex: { name: "Codex", color: "var(--a-codex)" },
  pi: { name: "pi", color: "var(--a-pi)" },
  doubao: { name: "豆包", color: "var(--a-doubao)" },
  workbuddy: { name: "WorkBuddy", color: "var(--a-workbuddy)" },
  cursor: { name: "Cursor", color: "var(--a-cursor)" },
  user: { name: "我", color: "var(--a-user)" },
  cli: { name: "命令行", color: "var(--a-user)" },
};
export const agentName = (a: string | null | undefined) => (a ? (AGENTS[a]?.name ?? a) : "未知");
export const agentColor = (a: string | null | undefined) => (a ? (AGENTS[a]?.color ?? "#8a968f") : "#8a968f");
const cvar = (a: string | null | undefined) => ({ ["--c" as string]: agentColor(a) }) as CSSProperties;

export function AgentDot({ agent, title }: { agent: string | null | undefined; title?: string }) {
  return <span className="dot" style={cvar(agent)} title={title ?? agentName(agent)} />;
}
export function AgentPill({ agent, label }: { agent: string | null | undefined; label?: string }) {
  return (
    <span className="apill" style={cvar(agent)}>
      <span className="dot" />
      {label ?? agentName(agent)}
    </span>
  );
}
export function AgentAvatar({ agent }: { agent: string | null | undefined }) {
  return (
    <span className="avatar agent" style={cvar(agent)} title={agentName(agent)}>
      <i />
    </span>
  );
}
export function cssAgent(agent: string | null | undefined): CSSProperties {
  return cvar(agent);
}

// ── knowledge card kinds ──
export const KINDS: Record<string, string> = {
  decision: "决策",
  constraint: "约束",
  finding: "发现",
  fact: "事实",
  dead_end: "踩坑",
  todo: "待办",
  note: "备注",
  handoff: "交接包",
};
export const KIND_ORDER = ["decision", "constraint", "finding", "fact", "dead_end", "todo", "note"];
export function KindTag({ kind }: { kind: string | null | undefined }) {
  const k = kind ?? "note";
  return <span className={`ktag k k-${k}`}>{KINDS[k] ?? k}</span>;
}

// ── content ──
export function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string), [text]);
  return <div className={`md ${compact ? "compact" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return <>{parts.map((p, i) => (p.startsWith("«") ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>;
}

// ── layout ──
export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="ph">
      <h1>{title}</h1>
      {sub && <div className="ph-sub">{sub}</div>}
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
  );
}
export function Panel({ title, sub, action, children, flush, className }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {(title || action) && (
        <div className="panel-h">
          {title && <h2>{title}</h2>}
          {sub && <span className="panel-sub">{sub}</span>}
          {action && <div className="panel-act">{action}</div>}
        </div>
      )}
      <div className={`panel-b ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}
export function Empty({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}
export const Loading = () => <div className="empty">载入中…</div>;
export const ErrorBox = ({ error }: { error: string }) => <div className="error">{error}</div>;

export const sessionHref = (id: string, seq?: number) => href(`/sessions/${encodeURIComponent(id)}`, { seq });
export const topicHref = (id: string, tab?: string) => href(`/topics/${encodeURIComponent(id)}`, { tab });

export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}
