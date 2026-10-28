import { FileText } from "lucide-react";
import { useApi } from "../api";
import { SearchTrigger } from "../palette";
import { href } from "../router";
import { AgentPill, Empty, ErrorBox, KindTag, Loading, PageHeader, Panel, Snippet, fmtTime, sessionHref, topicHref } from "../ui";

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
  const { data, error } = useApi<{ notes: NoteHit[]; sessions: SessionHit[] }>(q ? `search?q=${encodeURIComponent(q)}&scope=${scope}&limit=40` : null, { live: false });
  return (
    <div className="page">
      <PageHeader title={q ? `「${q}」` : "搜索"} sub={q ? "的搜索结果" : undefined} actions={<SearchTrigger />} />
      {!q && <Empty title="按 Ctrl K 开始搜索">可以搜交接包、知识卡片和五家 agent 的会话原文。</Empty>}
      {q && (
        <>
          <div className="toolbar">
            <div className="seg">
              {[
                ["all", "全部"],
                ["notes", "交接包与卡片"],
                ["sessions", "会话原文"],
              ].map(([k, l]) => (
                <a key={k} className={scope === k ? "on" : ""} href={href("/search", { q, scope: k })}>
                  {l}
                </a>
              ))}
            </div>
            <span className="faint xs">多个词之间是「且」；会话原文默认不含工具输出。</span>
          </div>
          {error && <ErrorBox error={error} />}
          {!data && <Loading />}
          {data && (
            <div className="cols cols-main-side">
              {scope !== "notes" && (
                <Panel title="会话原文" sub={`${data.sessions.length} 条`}>
                  {data.sessions.length === 0 && <Empty>会话里没有找到</Empty>}
                  {data.sessions.map((h) => (
                    <a key={`${h.session_id}-${h.seq}`} className="hit" href={sessionHref(h.session_id, h.seq)}>
                      <div className="hit-h">
                        <AgentPill agent={h.agent} />
                        <b className="ellipsis" style={{ maxWidth: 420 }}>{h.title || "（无标题）"}</b>
                        <span className="mono faint">#{h.seq}</span>
                        <span className="faint xs" style={{ marginLeft: "auto" }}>{fmtTime(h.ts)}</span>
                      </div>
                      <div className="hit-snippet"><Snippet text={h.snippet} /></div>
                    </a>
                  ))}
                </Panel>
              )}
              {scope !== "sessions" && (
                <Panel title="交接包与卡片" sub={`${data.notes.length} 条`}>
                  {data.notes.length === 0 && <Empty>交接包和卡片里没有找到</Empty>}
                  {data.notes.map((h) => (
                    <a key={h.doc_id} className="hit" href={h.topic_id ? topicHref(h.topic_id) : "#/topics"}>
                      <div className="hit-h">
                        {h.doc_type === "handoff" ? (
                          <span className="ktag k k-handoff"><FileText size={12} />交接包</span>
                        ) : (
                          <KindTag kind={h.title.replace(/[[\]]/g, "")} />
                        )}
                        <b className="serif">{h.doc_type === "handoff" ? h.title : h.topic}</b>
                        <span className="faint xs" style={{ marginLeft: "auto" }}>{fmtTime(h.created_at)}</span>
                      </div>
                      <div className="hit-snippet"><Snippet text={h.snippet} /></div>
                    </a>
                  ))}
                </Panel>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
