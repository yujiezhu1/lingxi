import { useApi } from "../api";
import { href } from "../router";
import { AgentTag, Empty, ErrorBox, KindTag, Loading, SessionLink, Snippet, fmtTime } from "../ui";

interface NoteHit {
  doc_type: "handoff" | "card";
  doc_id: string;
  topic_id: string | null;
  topic: string | null;
  title: string;
  snippet: string;
  created_at: number;
}
interface SessionHit {
  session_id: string;
  agent: string;
  title: string | null;
  seq: number;
  role: string;
  ts: number | null;
  snippet: string;
  ref: string;
}

export function Search({ q, scope }: { q: string; scope: string }) {
  const { data, error, loading } = useApi<{ notes: NoteHit[]; sessions: SessionHit[] }>(
    q ? `search?q=${encodeURIComponent(q)}&scope=${scope}&limit=30` : null,
    { live: false },
  );
  if (!q) return <Empty>在顶部输入关键词搜索</Empty>;
  return (
    <div className="page">
      <h1>搜索：{q}</h1>
      <div className="toolbar">
        {[
          ["all", "全部"],
          ["notes", "交接包和卡片"],
          ["sessions", "会话原文"],
        ].map(([k, l]) => (
          <a key={k} className={`chip ${scope === k ? "on" : ""}`} href={href("/search", { q, scope: k })}>
            {l}
          </a>
        ))}
      </div>
      <p className="muted small">多个关键词之间是「且」的关系；会话原文默认只搜对话（不含工具输出）。</p>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          {scope !== "sessions" && (
            <section>
              <h2>交接包和卡片（{data.notes.length}）</h2>
              {data.notes.length === 0 && <Empty>没有结果</Empty>}
              <ul className="list results">
                {data.notes.map((h) => (
                  <li key={h.doc_id}>
                    <div className="row">
                      {h.doc_type === "handoff" ? <span className="kind-tag k-handoff">交接包</span> : <KindTag kind={h.title.replace(/[[\]]/g, "")} />}
                      {h.topic_id ? (
                        <a href={href(`/topics/${encodeURIComponent(h.topic_id)}`)}>
                          <b>{h.doc_type === "handoff" ? h.title : h.topic}</b>
                        </a>
                      ) : (
                        <b>{h.title}</b>
                      )}
                      {h.topic && h.doc_type === "handoff" && <span className="pill">{h.topic}</span>}
                      <span className="muted right small">{fmtTime(h.created_at)}</span>
                    </div>
                    <Snippet text={h.snippet} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {scope !== "notes" && (
            <section>
              <h2>会话原文（{data.sessions.length}）</h2>
              {data.sessions.length === 0 && <Empty>没有结果</Empty>}
              <ul className="list results">
                {data.sessions.map((h) => (
                  <li key={`${h.session_id}-${h.seq}`}>
                    <div className="row">
                      <AgentTag agent={h.agent} />
                      <SessionLink id={h.session_id} seq={h.seq}>
                        <b>{h.title || "（无标题）"}</b>
                      </SessionLink>
                      <span className="muted small mono">{h.ref}</span>
                      <span className="muted right small">{fmtTime(h.ts)}</span>
                    </div>
                    <Snippet text={h.snippet} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
