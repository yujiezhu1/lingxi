import { useState } from "react";
import { useApi } from "../api";
import { href, navigate } from "../router";
import type { ActivityProject, ActivityReport } from "../types";
import { AgentTag, Card, Empty, ErrorBox, KindTag, Loading, SessionLink, copyText, fmtTime, shortPath } from "../ui";

const PRESETS = [
  { key: "today", label: "今天", q: { date: "today" } },
  { key: "yesterday", label: "昨天", q: { date: "yesterday" } },
  { key: "7d", label: "最近 7 天", q: { since: "7d" } },
  { key: "30d", label: "最近 30 天", q: { since: "30d" } },
];

export function Report({ query }: { query: URLSearchParams }) {
  const date = query.get("date") ?? (query.get("since") ? "" : "today");
  const since = query.get("since") ?? "";
  const [custom, setCustom] = useState(date && date !== "today" && date !== "yesterday" ? date : "");
  const qs = new URLSearchParams();
  if (since) qs.set("since", since);
  else qs.set("date", date || "today");
  const { data, error, loading } = useApi<{ report: ActivityReport; markdown: string }>(`activity?${qs.toString()}`);
  const [copied, setCopied] = useState(false);
  const active = PRESETS.find((p) => ("date" in p.q ? p.q.date === date && !since : p.q.since === since))?.key;

  return (
    <div className="page">
      <h1>日报</h1>
      <div className="toolbar">
        {PRESETS.map((p) => (
          <a key={p.key} className={`chip ${active === p.key ? "on" : ""}`} href={href("/report", p.q)}>
            {p.label}
          </a>
        ))}
        <input
          type="date"
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            if (e.target.value) navigate("/report", { date: e.target.value });
          }}
        />
        <span className="spacer" />
        <button
          className="btn"
          disabled={!data}
          onClick={() =>
            data &&
            copyText(data.markdown).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? "已复制 ✓" : "📋 复制为 Markdown"}
        </button>
      </div>
      <p className="muted small">
        按项目汇总各 agent 的会话、灵犀里新增的交接包和卡片、git 提交，以及当前未提交的改动。复制后可以直接贴到飞书，或交给豆包润色成日报。
      </p>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="muted small">
            {fmtTime(data.report.since)} → {fmtTime(data.report.until)}
          </div>
          {data.report.projects.length === 0 && data.report.otherNotes.length === 0 && <Empty>这段时间没有活动</Empty>}
          {data.report.projects.map((p) => (
            <ProjectActivity key={p.root} p={p} />
          ))}
          {data.report.otherNotes.length > 0 && (
            <Card title="未绑定项目的工作线">
              <NotesList notes={data.report.otherNotes} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function NotesList({ notes }: { notes: ActivityProject["notes"] }) {
  return (
    <ul className="list tight">
      {notes.map((n) => (
        <li key={n.id}>
          <span className="muted">{fmtTime(n.ts, false)}</span> <span className="pill">{n.topic}</span>{" "}
          {n.type === "handoff" ? <span className="kind-tag k-handoff">交接包</span> : <KindTag kind={n.kind} />} {n.text}
          {n.author_agent && <span className="muted"> · {n.author_agent}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ProjectActivity({ p, compact }: { p: ActivityProject; compact?: boolean }) {
  const title = p.root.startsWith("(") ? p.root.replace(": no project directory", "：无项目目录") : shortPath(p.root, 3);
  return (
    <Card
      className="project-card"
      title={
        <>
          📁 {title}
          {p.git?.branch && <span className="branch">⎇ {p.git.branch}</span>}
        </>
      }
      extra={!p.root.startsWith("(") && <span className="muted small mono">{p.root}</span>}
    >
      {p.sessions.length > 0 && (
        <div className="sub">
          <h4>会话（{p.sessions.length}）</h4>
          <ul className="list tight">
            {p.sessions.slice(0, compact ? 4 : 50).map((s) => (
              <li key={s.id}>
                <div className="row">
                  <AgentTag agent={s.agent} />
                  <SessionLink id={s.id}>
                    <b>{s.title || "（无标题）"}</b>
                  </SessionLink>
                  <span className="muted right">
                    {fmtTime(s.first_ts, false)}–{fmtTime(s.last_ts, false)} · {s.user_msgs} 次提问
                  </span>
                </div>
                {!compact && s.first_user && <div className="muted small clamp-1">问：{s.first_user}</div>}
                {s.last_assistant && <div className="muted small clamp-1">最后回复：{s.last_assistant}</div>}
              </li>
            ))}
            {compact && p.sessions.length > 4 && <li className="muted small">……还有 {p.sessions.length - 4} 个会话</li>}
          </ul>
        </div>
      )}
      {p.notes.length > 0 && (
        <div className="sub">
          <h4>灵犀笔记（{p.notes.length}）</h4>
          <NotesList notes={compact ? p.notes.slice(-4) : p.notes} />
        </div>
      )}
      {p.git && p.git.commits.length > 0 && (
        <div className="sub">
          <h4>提交（{p.git.commits.length}）</h4>
          <ul className="list tight mono small">
            {p.git.commits.slice(0, compact ? 5 : 30).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {p.git && (p.git.status.length > 0 || p.git.diffstat) && (
        <div className="sub">
          <h4 className="warn">未提交的改动</h4>
          {p.git.diffstat && <div className="small">{p.git.diffstat}</div>}
          <pre className="status-pre">{p.git.status.slice(0, compact ? 8 : 40).join("\n")}</pre>
        </div>
      )}
    </Card>
  );
}
