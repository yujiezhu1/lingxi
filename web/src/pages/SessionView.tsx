import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { href } from "../router";
import type { SessionInfo, Turn } from "../types";
import { AgentTag, ErrorBox, Loading, Markdown, copyText, fmtTime } from "../ui";

const PAGE = 300;

export function SessionView({ id, seq }: { id: string; seq?: number }) {
  const [tools, setTools] = useState(!!seq);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const target = useRef<HTMLDivElement | null>(null);

  const load = (from: number, append: boolean) => {
    setLoading(true);
    api<{ session: SessionInfo; turns: Turn[] }>(`sessions/${encodeURIComponent(id)}?from=${from}&limit=${PAGE}&tools=${tools ? 1 : 0}`)
      .then((r) => {
        setSession(r.session);
        setTurns((t) => (append ? [...t, ...r.turns] : r.turns));
        setMore(r.turns.length === PAGE);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Jump near #seq: start a bit before it.
  useEffect(() => {
    load(seq ? Math.max(1, seq - 20) : 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tools]);

  useEffect(() => {
    if (seq && target.current) target.current.scrollIntoView({ block: "center" });
  }, [turns, seq]);

  if (error && !session) return <ErrorBox error={error} />;
  if (!session) return <Loading />;

  return (
    <div className="page session-page">
      <a className="muted small" href={href("/sessions")}>
        ← 返回会话列表
      </a>
      <div className="detail-head">
        <h1>{session.title || "（无标题）"}</h1>
        <div className="muted small">
          <AgentTag agent={session.agent} /> <span className="mono">{session.ref}</span> · {session.turn_count} 条 · {fmtTime(session.started_at)} →{" "}
          {fmtTime(session.updated_at)}
        </div>
        <div className="muted small mono">{session.cwd}</div>
      </div>
      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={tools} onChange={(e) => setTools(e.target.checked)} /> 显示工具调用和输出
        </label>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => copyText(session.ref)}>
          复制会话引用
        </button>
      </div>
      {seq && seq > 21 && (
        <button className="btn ghost" onClick={() => load(1, false)}>
          ↑ 从头开始显示
        </button>
      )}
      <div className="transcript">
        {turns.map((t) => (
          <div key={t.seq} ref={t.seq === seq ? target : undefined} className={`turn turn-${t.role} ${t.seq === seq ? "turn-target" : ""}`}>
            <div className="turn-meta">
              <span className="turn-seq">#{t.seq}</span>
              <span>{ROLE[t.role]}</span>
              {t.tool_name && <span className="mono">{t.tool_name}</span>}
              <span className="muted">{fmtTime(t.ts)}</span>
            </div>
            {t.role === "user" || t.role === "assistant" ? (
              <Markdown text={t.text} />
            ) : (
              <details>
                <summary className="mono small tool-summary">{t.text.slice(0, 240)}</summary>
                <pre className="tool-pre">{t.text}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
      {loading && <Loading />}
      {more && !loading && (
        <button className="btn" onClick={() => load((turns[turns.length - 1]?.seq ?? 0) + 1, true)}>
          加载更多
        </button>
      )}
    </div>
  );
}

const ROLE: Record<Turn["role"], string> = { user: "🧑 用户", assistant: "🤖 助手", tool_call: "🔧 工具调用", tool_result: "📤 工具输出" };
