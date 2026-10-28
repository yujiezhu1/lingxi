import { ArrowLeft, Copy, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { href } from "../router";
import type { SessionInfo, Turn } from "../types";
import { AgentPill, ErrorBox, Loading, Markdown, PageHeader, agentName, copyText, fmtTime } from "../ui";

const PAGE = 400;

type Block = { kind: "turn"; turn: Turn } | { kind: "tools"; turns: Turn[] };

/** Consecutive tool calls / outputs are folded into one quiet block between messages. */
function toBlocks(turns: Turn[]): Block[] {
  const out: Block[] = [];
  for (const t of turns) {
    if (t.role === "tool_call" || t.role === "tool_result") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.turns.push(t);
      else out.push({ kind: "tools", turns: [t] });
    } else out.push({ kind: "turn", turn: t });
  }
  return out;
}

export function SessionView({ id, seq }: { id: string; seq?: number }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const target = useRef<HTMLDivElement | null>(null);

  const load = (from: number, append: boolean) => {
    setLoading(true);
    api<{ session: SessionInfo; turns: Turn[] }>(`sessions/${encodeURIComponent(id)}?from=${from}&limit=${PAGE}&tools=1`)
      .then((r) => {
        setSession(r.session);
        setTurns((t) => (append ? [...t, ...r.turns] : r.turns));
        setMore(r.turns.length === PAGE);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(seq ? Math.max(1, seq - 30) : 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (seq && target.current) target.current.scrollIntoView({ block: "center" });
  }, [turns, seq]);

  if (error && !session) return <div className="page"><ErrorBox error={error} /></div>;
  if (!session) return <Loading />;
  const blocks = toBlocks(turns);

  return (
    <div className="page reader">
      <a className="small" href={href("/sessions")} style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <ArrowLeft size={14} /> 会话列表
      </a>
      <PageHeader
        title={session.title && session.title.length < 40 ? session.title : "会话记录"}
        actions={
          <button
            className="btn"
            onClick={() =>
              copyText(session.ref).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              })
            }
          >
            <Copy size={14} /> {copied ? "已复制" : "复制会话引用"}
          </button>
        }
      />
      {session.title && session.title.length >= 40 && <p className="muted" style={{ marginTop: -10 }}>{session.title}</p>}
      <div className="topic-meta">
        <AgentPill agent={session.agent} />
        <span className="mono">{session.ref}</span>
        <span>{session.turn_count} 条</span>
        <span>
          {fmtTime(session.started_at)} → {fmtTime(session.updated_at)}
        </span>
        {session.cwd && <span className="mono">{session.cwd}</span>}
      </div>
      {seq && seq > 31 && turns[0] && turns[0].seq > 1 && (
        <button className="btn quiet" onClick={() => load(1, false)}>
          ↑ 从第一条开始看
        </button>
      )}
      <section className="panel" style={{ padding: "6px 24px" }}>
        {blocks.map((b, i) =>
          b.kind === "tools" ? (
            <ToolBlock key={`t${i}`} turns={b.turns} open={!!seq && b.turns.some((t) => t.seq === seq)} targetRef={target} seq={seq} />
          ) : (
            <div key={b.turn.seq} ref={b.turn.seq === seq ? target : undefined} className={`turn ${b.turn.role} ${b.turn.seq === seq ? "target" : ""}`}>
              <div className="turn-side">
                #{b.turn.seq}
                <br />
                {fmtTime(b.turn.ts, false)}
              </div>
              <div>
                <div className="turn-who">
                  <b>{b.turn.role === "user" ? "你" : agentName(session.agent)}</b>
                </div>
                <Markdown text={b.turn.text} compact />
              </div>
            </div>
          ),
        )}
        {loading && <Loading />}
      </section>
      {more && !loading && (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => load((turns[turns.length - 1]?.seq ?? 0) + 1, true)}>
          继续加载
        </button>
      )}
    </div>
  );
}

function ToolBlock({ turns, open, targetRef, seq }: { turns: Turn[]; open: boolean; targetRef: React.MutableRefObject<HTMLDivElement | null>; seq?: number }) {
  const calls = turns.filter((t) => t.role === "tool_call");
  const names = [...new Set(calls.map((c) => c.tool_name).filter(Boolean))].slice(0, 4).join("、");
  return (
    <div className="turn" style={{ padding: "6px 0" }}>
      <div className="turn-side">#{turns[0]!.seq}</div>
      <details className="tools" open={open}>
        <summary>
          <Wrench size={13} /> {calls.length || turns.length} 次工具调用{names && ` · ${names}`}
        </summary>
        {turns.map((t) => (
          <div key={t.seq} className="tool-item" ref={t.seq === seq ? targetRef : undefined}>
            <span className="faint">#{t.seq} {t.role === "tool_call" ? "调用" : "输出"}</span> {t.tool_name}
            <pre>{t.text}</pre>
          </div>
        ))}
      </details>
    </div>
  );
}
