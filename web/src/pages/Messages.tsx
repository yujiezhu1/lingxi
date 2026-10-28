import { Send } from "lucide-react";
import { useState } from "react";
import { api, bumpVersion, useApi } from "../api";
import { SearchTrigger } from "../palette";
import type { Message, Presence } from "../types";
import { AgentAvatar, AgentPill, Empty, ErrorBox, Loading, PageHeader, Panel, agentName, fmtAgo, fmtTime, shortPath } from "../ui";

interface MessagesData {
  messages: Message[];
  presence: Presence[];
  unread: number;
}
const KIND: Record<string, string> = { note: "备注", question: "提问", answer: "回答", request: "请求", notify: "通知" };

function targetLabel(m: Message): string {
  if (m.to_kind === "label") return m.to_value === "user" ? "我" : m.to_value;
  if (m.to_kind === "session") return `会话 …${m.to_value.slice(-12)}`;
  if (m.to_kind === "all") return "所有会话";
  return `${m.to_kind === "topic" ? "工作线" : "项目"} ${m.to_value}`;
}

export function Messages() {
  const { data, error } = useApi<MessagesData>("messages?limit=200");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("note");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [mine, setMine] = useState(false);

  if (error && !data) return <div className="page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await api<{ target: { describe: string; live: string[] } }>("messages", { method: "POST", body: { to, body, kind } });
      setResult(`已发送给 ${r.target.describe}${r.target.live.length ? `，${r.target.live.join("、")} 在线` : ""}`);
      setBody("");
      bumpVersion();
    } catch (e) {
      setResult(`没有发出去：${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };
  const markAll = async () => {
    await api("messages/read", { method: "POST", body: {} });
    bumpVersion();
  };
  const list = (mine ? data.messages.filter((m) => m.to_user || m.from_agent === "user") : data.messages).slice().reverse();

  return (
    <div className="page">
      <PageHeader title="消息" sub="正在运行的会话之间的往来" actions={<SearchTrigger />} />
      <div className="cols cols-main-side">
        <Panel
          title="往来记录"
          sub={`${list.length} 条`}
          action={
            <>
              <div className="seg">
                <button className={!mine ? "on" : ""} onClick={() => setMine(false)}>全部</button>
                <button className={mine ? "on" : ""} onClick={() => setMine(true)}>与我有关</button>
              </div>
              {data.unread > 0 && (
                <button className="btn" onClick={markAll}>
                  {data.unread} 条未读，全部标为已读
                </button>
              )}
            </>
          }
        >
          {list.length === 0 ? (
            <Empty title="还没有消息">在右边给某个会话发一条，或者在 agent 里说「告诉 xxx：……」。</Empty>
          ) : (
            <div className="chat">
              {list.map((m) => {
                const isMine = m.from_agent === "user";
                return (
                  <div key={m.id} className={`bubble-row ${isMine ? "mine" : ""} ${m.to_user && !m.read_by_user ? "unread" : ""}`}>
                    <AgentAvatar agent={m.from_agent} />
                    <div className="bubble">
                      <div className="bubble-meta">
                        <b style={{ color: "var(--ink)" }}>{isMine ? "我" : (m.from_label ?? agentName(m.from_agent))}</b>
                        <span>→ {targetLabel(m)}</span>
                        <span className="tag">{KIND[m.kind] ?? m.kind}</span>
                        <span className="faint">{fmtTime(m.created_at)}</span>
                      </div>
                      <div className="bubble-body">{m.body}</div>
                      {(m.reply_to || m.refs.length > 0 || (!isMine && m.from_label)) && (
                        <div className="bubble-foot">
                          {m.reply_to && <>回复 {m.reply_to} · </>}
                          {m.refs.length > 0 && <>{m.refs.join("、")} · </>}
                          {!isMine && m.from_label && (
                            <a href="#" onClick={(e) => (e.preventDefault(), setTo(m.from_label!))}>
                              回复 {m.from_label}
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
        <div className="stack">
          <Panel title="发一条消息" sub="以「我」的身份">
            <label className="field">
              发给
              <input className="input" list="recipients" value={to} onChange={(e) => setTo(e.target.value)} placeholder="会话标签、topic:工作线名，或 all" />
              <datalist id="recipients">
                {data.presence.map((p) => p.label && <option key={p.key} value={p.label} />)}
                <option value="all" />
              </datalist>
            </label>
            <label className="field">
              类型
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </label>
            <label className="field">
              内容
              <textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="例如：项目实际用 FastAPI，请重新评估方案 B" />
            </label>
            <button className="btn primary" disabled={sending || !to.trim() || !body.trim()} onClick={send}>
              <Send size={14} /> {sending ? "发送中…" : "发送"}
            </button>
            {result && <p className="small" style={{ marginBottom: 0 }}>{result}</p>}
            <p className="faint xs" style={{ marginBottom: 0 }}>pi 会马上收到；Claude Code 和 Codex 在你下一次发言时收到；其他 agent 调用灵犀时会看到提醒。</p>
          </Panel>
          <Panel title="在线" sub={`${data.presence.length} 个会话`}>
            {data.presence.length === 0 ? (
              <Empty>现在没有在线的会话</Empty>
            ) : (
              <ul className="rows">
                {data.presence.map((p) => (
                  <li key={p.key}>
                    <div className="row click" onClick={() => p.label && setTo(p.label)} style={{ cursor: "pointer" }} title="点击填入收件人">
                      <AgentAvatar agent={p.agent} />
                      <span className="grow">
                        <span className="row-title">{p.label}</span>
                        <span className="row-sub ellipsis" style={{ display: "block" }}>
                          {shortPath(p.cwd, 2)} · {fmtAgo(p.last_seen)}
                        </span>
                      </span>
                      <AgentPill agent={p.agent} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
