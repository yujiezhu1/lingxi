import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { api, bumpVersion, useApi } from "../api";
import { SearchTrigger } from "../palette";
import { AgentPill, ErrorBox, Loading, PageHeader, Panel } from "../ui";

interface StatusData {
  version: string;
  schema: number;
  home: string;
  topics: number;
  handoffs: number;
  cards: number;
  sessions: { agent: string; n: number; turns: number }[];
  online: number;
}
interface SyncResult {
  ms: number;
  agents: { agent: string; files: number; changedFiles: number; newSessions: number; newTurns: number; removedSessions?: number; errors: string[] }[];
}

export function Status() {
  const { data, error } = useApi<StatusData>("status");
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  if (error && !data) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const run = async () => {
    setBusy(true);
    try {
      setSync(await api<SyncResult>("sync", { method: "POST", body: {} }));
      bumpVersion();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <PageHeader title="状态" sub={`灵犀 v${data.version}`} actions={<SearchTrigger />} />
      <div className="cols cols-main-side">
        <Panel
          title="已导入的会话"
          sub="只读，自动增量同步"
          action={
            <button className="btn" disabled={busy} onClick={run}>
              <RefreshCw size={14} /> {busy ? "同步中…" : "立即同步"}
            </button>
          }
        >
          <table className="kv">
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.agent}>
                  <td><AgentPill agent={s.agent} /></td>
                  <td>{s.n} 个会话 · {s.turns.toLocaleString()} 条消息</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sync && (
            <p className="small muted">
              同步完成（{sync.ms} 毫秒）：
              {sync.agents
                .filter((a) => a.changedFiles || a.removedSessions || a.errors.length)
                .map((a) => `${a.agent} 新增 ${a.newTurns} 条${a.removedSessions ? `、移除 ${a.removedSessions} 个会话` : ""}${a.errors.length ? `、${a.errors.length} 个错误` : ""}`)
                .join("；") || "没有变化"}
            </p>
          )}
        </Panel>
        <Panel title="数据">
          <table className="kv">
            <tbody>
              <tr><td>工作线</td><td>{data.topics}</td></tr>
              <tr><td>交接包</td><td>{data.handoffs}</td></tr>
              <tr><td>知识卡片</td><td>{data.cards}</td></tr>
              <tr><td>在线会话</td><td>{data.online}</td></tr>
              <tr><td>数据目录</td><td className="mono">{data.home}</td></tr>
              <tr><td>数据库结构</td><td>v{data.schema}</td></tr>
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel title="使用提示">
        <ul className="rows small">
          <li style={{ padding: "8px 0" }}>按 <kbd>Ctrl</kbd> <kbd>K</kbd> 随时搜索工作线、交接包和会话原文。</li>
          <li style={{ padding: "8px 0" }}>界面只在本机可以访问；每次运行 <span className="mono">lingxi ui</span> 都会换一个访问令牌。</li>
          <li style={{ padding: "8px 0" }}>新建工作线、编辑卡片、后台咨询目前在 agent 或命令行里操作；命令速查：<span className="mono">lingxi guide</span>。</li>
        </ul>
      </Panel>
    </div>
  );
}
