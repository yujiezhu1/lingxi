import { useState } from "react";
import { api, bumpVersion, useApi } from "../api";
import { Card, ErrorBox, Loading, agentName } from "../ui";

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
  if (error && !data) return <ErrorBox error={error} />;
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
      <h1>状态</h1>
      <div className="grid-2">
        <Card title="数据">
          <table className="kv">
            <tbody>
              <tr>
                <td>版本</td>
                <td>
                  v{data.version}（数据库结构 v{data.schema}）
                </td>
              </tr>
              <tr>
                <td>数据目录</td>
                <td className="mono">{data.home}</td>
              </tr>
              <tr>
                <td>工作线</td>
                <td>{data.topics}</td>
              </tr>
              <tr>
                <td>交接包</td>
                <td>{data.handoffs}</td>
              </tr>
              <tr>
                <td>知识卡片</td>
                <td>{data.cards}</td>
              </tr>
              <tr>
                <td>在线会话</td>
                <td>{data.online}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card
          title="已导入的会话"
          extra={
            <button className="btn" disabled={busy} onClick={run}>
              {busy ? "同步中…" : "立即同步"}
            </button>
          }
        >
          <table className="kv">
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.agent}>
                  <td>{agentName(s.agent)}</td>
                  <td>
                    {s.n} 个会话 · {s.turns} 条消息
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sync && (
            <div className="small" style={{ marginTop: 8 }}>
              同步完成，用时 {sync.ms} 毫秒：
              {sync.agents.map((a) => (
                <div key={a.agent} className="muted">
                  {agentName(a.agent)}：变化 {a.changedFiles} 个文件，新会话 {a.newSessions}，新消息 {a.newTurns}
                  {a.removedSessions ? `，移除 ${a.removedSessions}` : ""}
                  {a.errors.length ? `，错误 ${a.errors.length}` : ""}
                </div>
              ))}
            </div>
          )}
          <p className="muted small">界面打开期间每 30 秒自动同步一次。</p>
        </Card>
      </div>
      <Card title="提示">
        <ul className="list tight small">
          <li>这个界面只在本机（127.0.0.1）可以访问，每次启动 `lingxi ui` 都会生成新的访问令牌。</li>
          <li>当前版本以查看为主；新建工作线、编辑卡片、后台咨询等操作仍在 agent 或命令行里进行。</li>
          <li>命令行速查：`lingxi guide`。</li>
        </ul>
      </Card>
    </div>
  );
}
