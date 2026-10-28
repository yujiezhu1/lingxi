import { Check, ClipboardCopy, FolderGit2 } from "lucide-react";
import { useState } from "react";
import { useApi } from "../api";
import { SearchTrigger } from "../palette";
import { href, navigate } from "../router";
import type { ActivityProject, ActivityReport } from "../types";
import { AgentDot, Empty, ErrorBox, KindTag, Loading, PageHeader, Panel, agentName, copyText, fmtDay, fmtTime, lastSeg, sessionHref } from "../ui";

const PRESETS = [
  { key: "today", label: "今天", q: { date: "today" } },
  { key: "yesterday", label: "昨天", q: { date: "yesterday" } },
  { key: "7d", label: "近 7 天", q: { since: "7d" } },
  { key: "30d", label: "近 30 天", q: { since: "30d" } },
];

export function Report({ query }: { query: URLSearchParams }) {
  const since = query.get("since") ?? "";
  const date = since ? "" : (query.get("date") ?? "today");
  const qs = since ? `since=${since}` : `date=${date}`;
  const { data, error } = useApi<{ report: ActivityReport; markdown: string }>(`activity?${qs}`);
  const [copied, setCopied] = useState(false);
  const active = PRESETS.find((p) => ("date" in p.q ? !since && p.q.date === date : p.q.since === since))?.key;

  return (
    <div className="page">
      <PageHeader title="日报" sub={data ? (since ? `${fmtTime(data.report.since)} 至今` : fmtDay(data.report.since)) : undefined} actions={<SearchTrigger />} />
      <div className="toolbar">
        <div className="seg">
          {PRESETS.map((p) => (
            <a key={p.key} className={active === p.key ? "on" : ""} href={href("/report", p.q)}>{p.label}</a>
          ))}
        </div>
        <input type="date" className="input" value={!active && date ? date : ""} onChange={(e) => e.target.value && navigate("/report", { date: e.target.value })} />
        <span className="grow" />
        <button
          className="btn primary"
          disabled={!data}
          onClick={() => data && copyText(data.markdown).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
        >
          {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? "已复制" : "复制为 Markdown"}
        </button>
      </div>
      <p className="faint xs" style={{ marginTop: -6 }}>按项目汇总会话、灵犀笔记、提交和当前未提交的改动。复制后可以贴进飞书，或交给豆包润色。</p>
      {error && <ErrorBox error={error} />}
      {!data && <Loading />}
      {data && (
        <Panel flush>
          {data.report.projects.length === 0 && data.report.otherNotes.length === 0 && <Empty title="这段时间没有活动" />}
          {data.report.projects.map((p) => <ProjectBlock key={p.root} p={p} />)}
          {data.report.otherNotes.length > 0 && (
            <div className="proj">
              <div className="proj-h"><h3>未绑定项目的工作线</h3></div>
              <Notes notes={data.report.otherNotes} />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function Notes({ notes }: { notes: ActivityProject["notes"] }) {
  return (
    <div className="proj-sec">
      <span>灵犀笔记</span>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <span className="mono faint">{fmtTime(n.ts, false)}</span> {n.type === "handoff" ? <span className="ktag k k-handoff">交接包</span> : <KindTag kind={n.kind} />}{" "}
            <span className="tag">{n.topic}</span> {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectBlock({ p }: { p: ActivityProject }) {
  const noDir = p.root.startsWith("(");
  const name = noDir ? `${agentName(p.root.slice(1, p.root.indexOf(":")))}（无项目目录）` : lastSeg(p.root);
  return (
    <div className="proj">
      <div className="proj-h">
        <FolderGit2 size={17} color="var(--moss)" />
        <h3>{name}</h3>
        {p.git?.branch && <span className="tag branch">{p.git.branch}</span>}
        {!noDir && <span className="mono faint">{p.root}</span>}
      </div>
      {p.sessions.length > 0 && (
        <div className="proj-sec">
          <span>会话 {p.sessions.length}</span>
          <ul>
            {p.sessions.map((s) => (
              <li key={s.id}>
                <AgentDot agent={s.agent} /> <a href={sessionHref(s.id)}>{s.title || "（无标题）"}</a>{" "}
                <span className="faint xs">
                  {fmtTime(s.first_ts, false)}–{fmtTime(s.last_ts, false)} · {s.user_msgs} 次提问
                </span>
                {s.last_assistant && <div className="faint xs ellipsis">最后回复：{s.last_assistant}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.notes.length > 0 && <Notes notes={p.notes} />}
      {p.git && p.git.commits.length > 0 && (
        <div className="proj-sec">
          <span>提交 {p.git.commits.length}</span>
          <ul className="mono">
            {p.git.commits.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      {p.git && (p.git.status.length > 0 || p.git.diffstat) && (
        <div className="proj-sec">
          <span style={{ color: "#8a5f1c" }}>未提交</span>
          <div>
            {p.git.diffstat && <div className="small">{p.git.diffstat}</div>}
            <pre className="status-pre">{p.git.status.slice(0, 30).join("\n")}{p.git.status.length > 30 ? `\n…还有 ${p.git.status.length - 30} 个` : ""}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
