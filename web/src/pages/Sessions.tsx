import { useState } from "react";
import { useApi } from "../api";
import { href, navigate } from "../router";
import type { SessionInfo } from "../types";
import { AgentTag, Empty, ErrorBox, Loading, SessionLink, fmtTime, shortPath } from "../ui";

const AGENTS = [
  { key: "", label: "全部" },
  { key: "claude-code", label: "Claude Code" },
  { key: "codex", label: "Codex" },
  { key: "pi", label: "pi" },
  { key: "doubao", label: "豆包工作" },
  { key: "workbuddy", label: "WorkBuddy" },
];
const SINCE = [
  { key: "", label: "全部时间" },
  { key: "1d", label: "24 小时" },
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
];

export function Sessions({ query }: { query: URLSearchParams }) {
  const agent = query.get("agent") ?? "";
  const since = query.get("since") ?? "";
  const project = query.get("project") ?? "";
  const [proj, setProj] = useState(project);
  const qs = new URLSearchParams({ limit: "300" });
  if (agent) qs.set("agent", agent);
  if (since) qs.set("since", since);
  if (project) qs.set("project", project);
  const { data, error, loading } = useApi<SessionInfo[]>(`sessions?${qs.toString()}`);
  const cur = { agent, since, project };

  return (
    <div className="page">
      <h1>会话</h1>
      <p className="muted small">自动导入的 Claude Code、Codex、pi、豆包工作、WorkBuddy 会话（只读）。点开查看原文。</p>
      <div className="toolbar">
        {AGENTS.map((a) => (
          <a key={a.key} className={`chip ${agent === a.key ? "on" : ""}`} href={href("/sessions", { ...cur, agent: a.key })}>
            {a.label}
          </a>
        ))}
        <span className="sep" />
        {SINCE.map((s) => (
          <a key={s.key} className={`chip ${since === s.key ? "on" : ""}`} href={href("/sessions", { ...cur, since: s.key })}>
            {s.label}
          </a>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate("/sessions", { ...cur, project: proj.trim() });
          }}
        >
          <input placeholder="项目目录（如 D:\proj\app）" value={proj} onChange={(e) => setProj(e.target.value)} />
        </form>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && data.length === 0 && <Empty>没有符合条件的会话</Empty>}
      {data && data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>agent</th>
              <th>标题</th>
              <th>目录</th>
              <th>消息数</th>
              <th>最近活动</th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/sessions/${encodeURIComponent(s.id)}`)}>
                <td>
                  <AgentTag agent={s.agent} />
                </td>
                <td className="title-cell">
                  <SessionLink id={s.id}>{s.title || "（无标题）"}</SessionLink>
                  <div className="muted small mono">{s.ref}</div>
                </td>
                <td className="muted small" title={s.cwd ?? ""}>
                  {shortPath(s.cwd, 2) || "—"}
                </td>
                <td className="num">{s.turn_count}</td>
                <td className="muted small">{fmtTime(s.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
