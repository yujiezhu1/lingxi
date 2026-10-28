import { useApi } from "../api";
import { href } from "../router";
import type { ActivityReport, Message, Presence, Topic } from "../types";
import { AgentTag, Card, Empty, ErrorBox, Loading, SessionLink, fmtAgo, fmtTime, shortPath } from "../ui";
import { ProjectActivity } from "./Report";

interface TodayData {
  report: ActivityReport;
  presence: Presence[];
  topics: Topic[];
  unread: number;
  messages: Message[];
}

export function Today() {
  const { data, error } = useApi<TodayData>("today");
  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const sessions = data.report.projects.reduce((n, p) => n + p.sessions.length, 0);
  const commits = data.report.projects.reduce((n, p) => n + (p.git?.commits.length ?? 0), 0);
  const dirty = data.report.projects.filter((p) => (p.git?.status.length ?? 0) > 0).length;

  return (
    <div className="page">
      <h1>今日</h1>
      <div className="stats">
        <Stat label="在线会话" value={data.presence.length} to="#/messages" />
        <Stat label="今天的会话" value={sessions} to="#/report" />
        <Stat label="今天的提交" value={commits} to="#/report" />
        <Stat label="有未提交改动的项目" value={dirty} to="#/report" />
        <Stat label="未读消息" value={data.unread} to="#/messages" highlight={data.unread > 0} />
      </div>

      <div className="grid-2">
        <Card title="在线会话" extra={<a href="#/messages">发消息 →</a>}>
          {data.presence.length === 0 ? (
            <Empty>暂时没有在线会话</Empty>
          ) : (
            <ul className="list">
              {data.presence.map((p) => (
                <li key={p.key}>
                  <div className="row">
                    <AgentTag agent={p.agent} /> <b>{p.label}</b>
                    <span className="muted right">{fmtAgo(p.last_seen)}</span>
                  </div>
                  <div className="muted small">
                    {shortPath(p.cwd, 3)}
                    {p.activity && <> · {p.activity}</>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="最近的工作线" extra={<a href="#/topics">全部 →</a>}>
          {data.topics.length === 0 ? (
            <Empty>还没有工作线</Empty>
          ) : (
            <ul className="list">
              {data.topics.map((t) => (
                <li key={t.id}>
                  <div className="row">
                    <a href={href(`/topics/${encodeURIComponent(t.id)}`)}>
                      <b>{t.name}</b>
                    </a>
                    <span className="muted right">{fmtTime(t.updated_at)}</span>
                  </div>
                  <div className="muted small">
                    {t.handoffs} 个交接包 · {t.cards} 张卡片
                    {t.projects?.length ? <> · {shortPath(t.projects[0], 2)}</> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.messages.length > 0 && (
        <Card title="最近的消息" extra={<a href="#/messages">全部 →</a>}>
          <ul className="list">
            {data.messages.slice(0, 5).map((m) => (
              <li key={m.id}>
                <div className="row">
                  <AgentTag agent={m.from_agent} /> <b>{m.from_agent === "user" ? "我" : (m.from_label ?? m.from_agent)}</b>
                  <span className="muted">→ {targetLabel(m)}</span>
                  <span className="muted right">{fmtTime(m.created_at)}</span>
                </div>
                <div className="clamp-2">{m.body}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h2>今天各项目的进展</h2>
      {data.report.projects.length === 0 ? <Empty>今天还没有活动</Empty> : data.report.projects.map((p) => <ProjectActivity key={p.root} p={p} compact />)}
      <p className="muted small">
        想看更早的日期或复制成日报，去 <a href="#/report">日报</a>。点会话可以查看原文，例如{" "}
        {data.report.projects[0]?.sessions[0] && <SessionLink id={data.report.projects[0].sessions[0].id}>这个</SessionLink>}。
      </p>
    </div>
  );
}

export function targetLabel(m: Message): string {
  if (m.to_kind === "label") return m.to_value === "user" ? "我" : m.to_value;
  if (m.to_kind === "session") return `会话 ${m.to_value.slice(-12)}`;
  if (m.to_kind === "all") return "所有会话";
  return `${m.to_kind === "topic" ? "工作线" : "项目"} ${m.to_value}`;
}

function Stat({ label, value, to, highlight }: { label: string; value: number; to: string; highlight?: boolean }) {
  return (
    <a className={`stat ${highlight ? "hl" : ""}`} href={to}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </a>
  );
}
