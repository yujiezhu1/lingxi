import { FolderGit2, Search as SearchIcon } from "lucide-react";
import { useState } from "react";
import { useApi } from "../api";
import { SearchTrigger } from "../palette";
import { href, navigate } from "../router";
import type { SessionInfo } from "../types";
import { AgentPill, Empty, ErrorBox, Loading, PageHeader, Panel, cssAgent, fmtTime, shortPath } from "../ui";

const AGENT_FILTERS = [
  { key: "", label: "全部" },
  { key: "claude-code", label: "Claude Code" },
  { key: "codex", label: "Codex" },
  { key: "pi", label: "pi" },
  { key: "doubao", label: "豆包" },
  { key: "workbuddy", label: "WorkBuddy" },
];
const SINCE = [
  { key: "1d", label: "今天" },
  { key: "7d", label: "7 天" },
  { key: "30d", label: "30 天" },
  { key: "", label: "全部" },
];

export function Sessions({ query }: { query: URLSearchParams }) {
  const agent = query.get("agent") ?? "";
  const since = query.get("since") ?? "7d";
  const project = query.get("project") ?? "";
  const [proj, setProj] = useState(project);
  const qs = new URLSearchParams({ limit: "400" });
  if (agent) qs.set("agent", agent);
  if (since) qs.set("since", since);
  if (project) qs.set("project", project);
  const { data, error } = useApi<SessionInfo[]>(`sessions?${qs.toString()}`);
  const cur = { agent, since, project };

  return (
    <div className="page">
      <PageHeader title="会话" sub="五家 agent 的对话记录，自动导入、只读" actions={<SearchTrigger />} />
      <div className="toolbar">
        <div className="seg">
          {AGENT_FILTERS.map((a) => (
            <a key={a.key} className={agent === a.key ? "on" : ""} href={href("/sessions", { ...cur, agent: a.key })}>
              {a.label}
            </a>
          ))}
        </div>
        <div className="seg">
          {SINCE.map((s) => (
            <a key={s.key} className={since === s.key ? "on" : ""} href={href("/sessions", { ...cur, since: s.key })}>
              {s.label}
            </a>
          ))}
        </div>
        <form
          style={{ display: "flex", gap: 8, alignItems: "center" }}
          onSubmit={(e) => {
            e.preventDefault();
            navigate("/sessions", { ...cur, project: proj.trim() });
          }}
        >
          <FolderGit2 size={16} color="var(--moss)" />
          <input className="input" style={{ width: 300 }} placeholder="按项目目录筛选，回车确认" value={proj} onChange={(e) => setProj(e.target.value)} />
          {project && (
            <a className="btn quiet" href={href("/sessions", { ...cur, project: "" })}>
              清除
            </a>
          )}
        </form>
      </div>
      {error && <ErrorBox error={error} />}
      <Panel flush>
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty title="没有符合条件的会话">换个 agent 或时间范围试试；也可以按 Ctrl K 搜索会话原文。</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="spine" />
                <th>会话</th>
                <th>agent</th>
                <th>目录</th>
                <th style={{ textAlign: "right" }}>消息</th>
                <th>最近活动</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} onClick={() => navigate(`/sessions/${encodeURIComponent(s.id)}`)}>
                  <td className="spine" style={cssAgent(s.agent)}>
                    <i />
                  </td>
                  <td className="title">
                    <b className="ellipsis" style={{ display: "block" }}>{s.title || "（无标题）"}</b>
                    <span className="mono faint">{s.ref}</span>
                  </td>
                  <td>
                    <AgentPill agent={s.agent} />
                  </td>
                  <td className="mono faint" title={s.cwd ?? ""}>
                    {shortPath(s.cwd, 2) || "—"}
                  </td>
                  <td className="num">{s.turn_count}</td>
                  <td className="faint xs nowrap">{fmtTime(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="faint xs" style={{ marginTop: 10 }}>
        <SearchIcon size={12} style={{ verticalAlign: -2 }} /> 想找某句话？按 Ctrl K 直接搜索会话原文。
      </p>
    </div>
  );
}
