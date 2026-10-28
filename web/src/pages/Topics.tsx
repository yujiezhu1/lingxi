import { ChevronRight, FileText, Folder, Home, Layers, Link2 } from "lucide-react";
import { useApi } from "../api";
import { href } from "../router";
import type { Card, Handoff, TimelineEvent, Topic, TopicOverview } from "../types";
import {
  AgentDot,
  AgentPill,
  Empty,
  ErrorBox,
  KINDS,
  KIND_ORDER,
  KindTag,
  Loading,
  Markdown,
  Panel,
  agentName,
  dayKey,
  fmtTime,
  lastSeg,
  sessionHref,
  topicHref,
} from "../ui";

const FILTERS = [
  { key: "active", label: "进行中" },
  { key: "project", label: "绑定项目" },
  { key: "archived", label: "已归档" },
];

export function Topics({ id, tab, filter }: { id?: string; tab: string; filter: string }) {
  const list = useApi<Topic[]>("topics?status=all");
  const all = list.data ?? [];
  const shown = all.filter((t) => (filter === "archived" ? t.status === "archived" : t.status === "active" && (filter !== "project" || (t.projects?.length ?? 0) > 0)));
  const selected = id ?? shown[0]?.id;

  return (
    <div className="topics">
      <aside className="topic-list">
        <div className="topic-list-h">
          <h2>工作线</h2>
          <span className="faint small">{all.filter((t) => t.status === "active").length}</span>
        </div>
        <div className="seg">
          {FILTERS.map((f) => (
            <a key={f.key} className={filter === f.key ? "on" : ""} href={href(`/topics${id ? `/${encodeURIComponent(id)}` : ""}`, { f: f.key, tab })}>
              {f.label}
            </a>
          ))}
        </div>
        <div className="topic-items">
          {list.error && <ErrorBox error={list.error} />}
          {list.data && shown.length === 0 && <Empty title="这里还没有工作线">在任意 agent 里说「保存交接到灵犀，topic 叫 XX」。</Empty>}
          {shown.map((t) => (
            <a key={t.id} className={`topic-item ${t.id === selected ? "on" : ""}`} href={href(`/topics/${encodeURIComponent(t.id)}`, { f: filter })}>
              <h3>
                {t.name}
                <span>{fmtTime(t.updated_at)}</span>
              </h3>
              {t.description && <p className="clamp-2">{t.description}</p>}
              <div className="meta">
                {t.projects?.[0] && (
                  <span title={t.projects[0]}>
                    <Folder size={13} />
                    {lastSeg(t.projects[0])}
                  </span>
                )}
                <span>
                  <FileText size={13} />
                  {t.handoffs ?? 0}
                </span>
                <span>
                  <Layers size={13} />
                  {t.cards ?? 0}
                </span>
              </div>
            </a>
          ))}
        </div>
      </aside>
      <div className="topic-main">{selected ? <TopicDetail id={selected} tab={tab} filter={filter} /> : list.data ? <Empty>选择一条工作线</Empty> : <Loading />}</div>
    </div>
  );
}

function TopicDetail({ id, tab, filter }: { id: string; tab: string; filter: string }) {
  const { data, error } = useApi<TopicOverview>(`topics/${encodeURIComponent(id)}`);
  if (error && !data) return <div className="topic-grid"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const t = data.topic;
  const authors = [...new Set([data.latestHandoff?.author_agent, ...data.otherHandoffs.map((h) => h.author_agent), ...data.cards.map((c) => c.author_agent)].filter(Boolean) as string[])];
  const handoffCount = data.otherHandoffs.length + (data.latestHandoff ? 1 : 0);
  const tabs = [
    { key: "overview", label: "概览" },
    { key: "timeline", label: "时间线" },
    { key: "history", label: `交接包历史${handoffCount ? `（${handoffCount}）` : ""}` },
  ];
  const tabHref = (k: string) => href(`/topics/${encodeURIComponent(id)}`, { tab: k, f: filter });

  return (
    <div className="topic-grid">
      <div>
        <div className="crumbs">
          <Home size={14} />
          <a href="#/topics">工作线</a>
          <ChevronRight size={13} />
          <span>{t.name}</span>
        </div>
        <h1 className="topic-title">{t.name}</h1>
        {t.description && <p className="topic-desc">{t.description}</p>}
        <div className="topic-meta">
          {data.projects.map((p) => (
            <span key={p} className="path" title={p}>
              <Folder size={14} />
              <span className="mono">{p}</span>
            </span>
          ))}
          {authors.length > 0 && (
            <span className="dots" title={authors.map(agentName).join("、")}>
              {authors.map((a) => (
                <AgentDot key={a} agent={a} />
              ))}
              <span style={{ marginLeft: 6 }}>{authors.map(agentName).join("、")} 参与</span>
            </span>
          )}
          <span>创建于 {fmtTime(t.created_at)}</span>
          {t.status === "archived" && <span className="tag">已归档</span>}
        </div>
        <nav className="tabs">
          {tabs.map((x) => (
            <a key={x.key} className={tab === x.key ? "on" : ""} href={tabHref(x.key)}>
              {x.label}
            </a>
          ))}
        </nav>
        {tab === "timeline" ? (
          <Timeline id={t.id} />
        ) : tab === "history" ? (
          <History id={t.id} />
        ) : data.latestHandoff ? (
          <section className="panel">
            <HandoffDoc h={data.latestHandoff} />
          </section>
        ) : (
          <section className="panel">
            <Empty title="还没有交接包">在 agent 里说「保存交接到灵犀，topic 叫 {t.name}」。</Empty>
          </section>
        )}
      </div>
      <Marginalia o={data} />
    </div>
  );
}

export function HandoffDoc({ h, version }: { h: Handoff; version?: number }) {
  return (
    <article className="doc">
      <div className="doc-cap">
        <AgentPill agent={h.author_agent} />
        <span>
          由 {agentName(h.author_agent)} 保存 · {fmtTime(h.created_at)}
        </span>
        {h.source_session && <span className="mono">来源 {h.source_session}</span>}
        {h.status === "superseded" && <span className="tag warn">已被新版本替换</span>}
        {version !== undefined && <span className="ver">第 {version} 版</span>}
      </div>
      <h1 className="doc-title">{h.title}</h1>
      {h.refs.length > 0 && (
        <div className="doc-refs">
          <Link2 size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
          {h.refs.join(" · ")}
        </div>
      )}
      <Markdown text={h.body_md} />
    </article>
  );
}

function Marginalia({ o }: { o: TopicOverview }) {
  const groups = KIND_ORDER.map((k) => ({ k, cards: o.cards.filter((c) => c.kind === k) })).filter((g) => g.cards.length > 0);
  return (
    <aside className="margin-notes">
      <div className="mn-h">
        <h2>知识与批注</h2>
        <span className="faint small">{o.cards.length} 张卡片</span>
      </div>
      {groups.length === 0 && (
        <div className="note k k-note">
          <Empty>还没有卡片。agent 在定下决策、踩到坑时会提议记一张。</Empty>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.k} className={`note k k-${g.k}`}>
          <div className="note-h">
            <KindTag kind={g.k} />
            <span className="count">{g.cards.length}</span>
          </div>
          <ul>
            {g.cards.slice(0, 8).map((c) => (
              <NoteItem key={c.id} c={c} />
            ))}
            {g.cards.length > 8 && <li className="faint xs">还有 {g.cards.length - 8} 条…</li>}
          </ul>
        </div>
      ))}
      {o.recentSessions.length > 0 && (
        <Panel title="近期会话">
          <ul className="rows">
            {o.recentSessions.slice(0, 5).map((s) => (
              <li key={s.id}>
                <a className="row" href={sessionHref(s.id)} style={{ padding: "9px 0" }}>
                  <AgentDot agent={s.agent} />
                  <span className="grow">
                    <span className="row-title ellipsis" style={{ display: "block", fontWeight: 500 }}>
                      {s.title || "（无标题）"}
                    </span>
                    <span className="row-sub">
                      {fmtTime(s.updated_at)} · {s.turn_count} 条
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {o.links.length > 0 && (
        <Panel title="关联">
          <ul className="rows">
            {o.links.map((l) => (
              <li key={l.id} className="small" style={{ padding: "7px 0", wordBreak: "break-all" }}>
                <span className="tag">{l.target_type}</span>{" "}
                {l.target_type === "url" ? (
                  <a href={l.target_id} target="_blank" rel="noreferrer">
                    {l.target_id}
                  </a>
                ) : (
                  <span className="mono">{l.target_id}</span>
                )}
                {l.note && <span className="faint"> — {l.note}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </aside>
  );
}

function NoteItem({ c }: { c: Card }) {
  return (
    <li>
      <span>{c.content}</span>
      <span className="from">
        {c.author_agent ? `${agentName(c.author_agent)} · ` : ""}
        {fmtTime(c.created_at)}
      </span>
    </li>
  );
}

function History({ id }: { id: string }) {
  const { data } = useApi<Handoff[]>(`handoffs?topic=${encodeURIComponent(id)}&all=1&limit=100`);
  if (!data) return <Loading />;
  if (!data.length) return <Empty>还没有交接包</Empty>;
  return (
    <div className="stack">
      {data.map((h, i) => (
        <details key={h.id} className="panel" open={i === 0}>
          <summary style={{ padding: "14px 20px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
            <span className="serif" style={{ fontWeight: 600, fontSize: 15.5 }}>{h.title}</span>
            <AgentPill agent={h.author_agent} />
            <span className="faint xs">{fmtTime(h.created_at)}</span>
            {h.status === "superseded" && <span className="tag warn">已替换</span>}
            <span className="faint mono" style={{ marginLeft: "auto" }}>第 {data.length - i} 版</span>
          </summary>
          <div style={{ borderTop: "1px solid var(--line-2)" }}>
            <HandoffDoc h={h} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const { data } = useApi<TimelineEvent[]>(`topics/${encodeURIComponent(id)}/timeline`);
  if (!data) return <Loading />;
  if (!data.length) return <Empty>暂无记录</Empty>;
  const days: [string, TimelineEvent[]][] = [];
  for (const e of data) {
    const d = dayKey(e.ts);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(e);
    else days.push([d, [e]]);
  }
  return (
    <section className="panel" style={{ padding: "18px 22px" }}>
      <div className="tl">
        {days.map(([d, evs]) => (
          <div key={d} className="tl-day">
            <h3>{d}</h3>
            {evs.map((e) => (
              <div key={`${e.type}-${e.id}`} className={`tl-ev ${e.status ? "off" : ""}`}>
                <span className="t">{fmtTime(e.ts, false)}</span>
                <span>
                  {e.type === "card" ? (
                    <KindTag kind={e.kind} />
                  ) : (
                    <span className={`ktag k k-handoff`}>{e.type === "handoff" ? KINDS.handoff : e.type === "topic" ? "创建" : "关联"}</span>
                  )}
                </span>
                <span className="txt">
                  {e.type === "link" ? `${e.kind}：${e.text}` : e.text}
                  {e.status && <span className="tag" style={{ marginLeft: 8 }}>{e.status === "superseded" ? "已替换" : "已归档"}</span>}
                </span>
                <span>{e.author_agent && <AgentPill agent={e.author_agent} />}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export { topicHref };
