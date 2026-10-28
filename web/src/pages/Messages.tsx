import { useState } from "react";
import { api, bumpVersion, useApi } from "../api";
import type { Message, Presence } from "../types";
import { AgentTag, Card, Empty, ErrorBox, Loading, fmtAgo, fmtTime, shortPath } from "../ui";

interface MessagesData {
  messages: Message[];
  presence: Presence[];
  unread: number;
}

const KIND: Record<string, string> = { note: "备注", question: "提问", answer: "回答", request: "请求", notify: "通知" };

export function Messages() {
  const { data, error } = useApi<MessagesData>("messages?limit=200");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("note");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const r = await api<{ target: { describe: string; live: string[] } }>("messages", { method: "POST", body: { to, body, kind } });
      setResult(`✓ 已发送给 ${r.target.describe}${r.target.live.length ? `（在线：${r.target.live.join("、")}）` : ""}`);
      setBody("");
      bumpVersion();
    } catch (e) {
      setResult(`✗ ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };
  const markAll = async () => {
    await api("messages/read", { method: "POST", body: {} });
    bumpVersion();
  };
  const shown = onlyMine ? data.messages.filter((m) => m.to_user || m.from_agent === "user") : data.messages;

  return (
    <div className="page">
      <h1>消息</h1>
      <div className="grid-main-side">
        <div>
          <Card
            title={`消息往来（${shown.length}）`}
            extra={
              <>
                <label className="check small">
                  <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> 只看和我有关
                </label>
                {data.unread > 0 && (
                  <button className="btn ghost small" onClick={markAll}>
                    全部标为已读（{data.unread}）
                  </button>
                )}
              </>
            }
          >
            {shown.length === 0 && <Empty>还没有消息</Empty>}
            <ul className="list messages">
              {shown.map((m) => (
                <li key={m.id} className={m.to_user && !m.read_by_user ? "unread" : ""}>
                  <div className="row">
                    <AgentTag agent={m.from_agent} />
                    <b>{m.from_agent === "user" ? "我" : (m.from_label ?? m.from_agent)}</b>
                    <span className="muted">→ {target(m)}</span>
                    <span className="pill">{KIND[m.kind] ?? m.kind}</span>
                    {m.to_user && !m.read_by_user && <span className="pill hl">未读</span>}
                    <span className="muted right small">{fmtTime(m.created_at)}</span>
                  </div>
                  <div className="msg-body">{m.body}</div>
                  {(m.refs.length > 0 || m.reply_to) && (
                    <div className="muted small">
                      {m.reply_to && <>回复 {m.reply_to} · </>}
                      {m.refs.join("、")}
                    </div>
                  )}
                  <div className="muted small">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (m.from_label) setTo(m.from_label);
                      }}
                    >
                      回复给 {m.from_label ?? "对方"}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div>
          <Card title="发消息（以「用户」身份）">
            <label className="field">
              收件人
              <input list="recipients" value={to} onChange={(e) => setTo(e.target.value)} placeholder="标签 / 会话引用 / topic:名称 / all" />
              <datalist id="recipients">
                {data.presence.map((p) => p.label && <option key={p.key} value={p.label} />)}
                <option value="all" />
              </datalist>
            </label>
            <label className="field">
              类型
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              内容
              <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="例如：项目实际用 FastAPI，请重新评估方案 B" />
            </label>
            <button className="btn primary" disabled={sending || !to.trim() || !body.trim()} onClick={send}>
              {sending ? "发送中…" : "发送"}
            </button>
            {result && <div className="small" style={{ marginTop: 8 }}>{result}</div>}
            <p className="muted small">pi 会实时收到；开启了钩子的 Claude Code / Codex 在你下一次发言时收到；其他 agent 在调用灵犀工具时会看到提醒。</p>
          </Card>
          <Card title={`在线会话（${data.presence.length}）`}>
            {data.presence.length === 0 && <Empty>暂时没有在线会话</Empty>}
            <ul className="list tight">
              {data.presence.map((p) => (
                <li key={p.key}>
                  <div className="row">
                    <AgentTag agent={p.agent} />
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (p.label) setTo(p.label);
                      }}
                    >
                      <b>{p.label}</b>
                    </a>
                    <span className="muted right small">{fmtAgo(p.last_seen)}</span>
                  </div>
                  <div className="muted small">
                    {shortPath(p.cwd, 2)} · {p.via}
                    {p.activity && <> · {p.activity}</>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function target(m: Message): string {
  if (m.to_kind === "label") return m.to_value === "user" ? "我" : m.to_value;
  if (m.to_kind === "session") return `会话 ${m.to_value.slice(-12)}`;
  if (m.to_kind === "all") return "所有会话";
  return `${m.to_kind === "topic" ? "工作线" : "项目"} ${m.to_value}`;
}
