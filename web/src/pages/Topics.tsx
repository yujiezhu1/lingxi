import { useApi } from "../api";
import { href } from "../router";
import type { Handoff, TimelineEvent, Topic, TopicOverview } from "../types";
import {
  AgentTag,
  CARD_ORDER,
  Card,
  Empty,
  ErrorBox,
  KindTag,
  Loading,
  Markdown,
  SessionLink,
  dayKey,
  fmtTime,
  kindLabel,
  shortPath,
} from "../ui";

export function Topics({ id, tab }: { id?: string; tab: string }) {
  const list = useApi<Topic[]>("topics?status=all");
  const topics = list.data ?? [];
  const active = topics.filter((t) => t.status === "active");
  const archived = topics.filter((t) => t.status === "archived");

  return (
    <div className="split">
      <div className="split-list">
        <h2>工作线 <span className="muted small">{active.length}</span></h2>
        {list.error && <ErrorBox error={list.error} />}
        {active.map((t) => (
          <TopicItem key={t.id} t={t} selected={t.id === id || t.name === id} />
        ))}
        {archived.length > 0 && (
          <details>
            <summary className="muted">已归档（{archived.length}）</summary>
            {archived.map((t) => (
              <TopicItem key={t.id} t={t} selected={t.id === id} />
            ))}
          </details>
        )}
        {!list.loading && topics.length === 0 && <Empty>还没有工作线。在任意 agent 里说「保存交接到灵犀，topic 叫 XX」就会创建。</Empty>}
      </div>
      <div className="split-detail">{id ? <TopicDetail id={id} tab={tab} /> : <Empty>← 选择一条工作线</Empty>}</div>
    </div>
  );
}

function TopicItem({ t, selected }: { t: Topic; selected: boolean }) {
  return (
    <a className={`list-item ${selected ? "selected" : ""}`} href={href(`/topics/${encodeURIComponent(t.id)}`)}>
      <div className="row">
        <b>{t.name}</b>
        <span className="muted small right">{fmtTime(t.updated_at)}</span>
      </div>
      <div className="muted small">
        {t.handoffs ?? 0} 交接包 · {t.cards ?? 0} 卡片{t.projects?.length ? ` · ${shortPath(t.projects[0], 1)}` : ""}
      </div>
    </a>
  );
}

function TopicDetail({ id, tab }: { id: string; tab: string }) {
  const { data, error } = useApi<TopicOverview>(`topics/${encodeURIComponent(id)}`);
  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const t = data.topic;
  const tabs = [
    { key: "overview", label: "概览" },
    { key: "timeline", label: "时间线" },
    { key: "handoffs", label: `交接包历史（${data.otherHandoffs.length + (data.latestHandoff ? 1 : 0)}）` },
  ];
  return (
    <div>
      <div className="detail-head">
        <h1>
          {t.name} {t.status === "archived" && <span className="pill">已归档</span>}
        </h1>
        {t.description && <p className="muted">{t.description}</p>}
        <div className="muted small">
          {data.projects.length > 0 && <>📁 {data.projects.join("、")} · </>}创建于 {fmtTime(t.created_at)} · 更新于 {fmtTime(t.updated_at)}
        </div>
      </div>
      <div className="tabs">
        {tabs.map((x) => (
          <a key={x.key} className={tab === x.key ? "on" : ""} href={href(`/topics/${encodeURIComponent(id)}`, { tab: x.key })}>
            {x.label}
          </a>
        ))}
      </div>
      {tab === "timeline" ? <Timeline id={t.id} /> : tab === "handoffs" ? <HandoffHistory id={t.id} /> : <Overview o={data} />}
    </div>
  );
}

function Overview({ o }: { o: TopicOverview }) {
  const groups = CARD_ORDER.map((k) => ({ k, cards: o.cards.filter((c) => c.kind === k) })).filter((g) => g.cards.length);
  return (
    <div className="grid-main-side">
      <div>
        <Card title="最新交接包">{o.latestHandoff ? <HandoffView h={o.latestHandoff} /> : <Empty>还没有交接包</Empty>}</Card>
      </div>
      <div>
        <Card title={`知识卡片（${o.cards.length}）`}>
          {groups.length === 0 && <Empty>还没有卡片</Empty>}
          {groups.map((g) => (
            <div key={g.k} className="card-group">
              <h4>
                <KindTag kind={g.k} /> {kindLabel(g.k)}（{g.cards.length}）
              </h4>
              <ul className="list tight">
                {g.cards.map((c) => (
                  <li key={c.id}>
                    {c.content}
                    <div className="muted small">
                      {c.author_agent && <>{c.author_agent} · </>}
                      {fmtTime(c.created_at)}
                      {c.refs.length > 0 && <> · {c.refs.join("、")}</>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
        {o.recentSessions.length > 0 && (
          <Card title="项目里最近的会话">
            <ul className="list tight">
              {o.recentSessions.map((s) => (
                <li key={s.id}>
                  <AgentTag agent={s.agent} /> <SessionLink id={s.id}>{s.title || "（无标题）"}</SessionLink>
                  <div className="muted small">
                    {fmtTime(s.updated_at)} · {s.turn_count} 条
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {o.links.length > 0 && (
          <Card title="关联项">
            <ul className="list tight">
              {o.links.map((l) => (
                <li key={l.id}>
                  <span className="pill">{l.target_type}</span> <LinkTarget type={l.target_type} id={l.target_id} />
                  {l.note && <span className="muted"> — {l.note}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function LinkTarget({ type, id }: { type: string; id: string }) {
  if (type === "url") return <a href={id} target="_blank" rel="noreferrer">{id}</a>;
  if (type === "topic") return <a href={href(`/topics/${encodeURIComponent(id)}`)}>{id}</a>;
  if (type === "session") return <a href={href("/sessions", { q: id })}>{id}</a>;
  return <span className="mono small">{id}</span>;
}

export function HandoffView({ h }: { h: Handoff }) {
  return (
    <div className="handoff">
      <div className="handoff-head">
        <h3>{h.title}</h3>
        <div className="muted small">
          <AgentTag agent={h.author_agent} /> {fmtTime(h.created_at)} · <span className="mono">{h.id}</span>
          {h.source_session && <> · 来源 {h.source_session}</>}
          {h.status === "superseded" && <span className="pill warn">已被替换</span>}
        </div>
        {h.refs.length > 0 && <div className="muted small">引用：{h.refs.join("、")}</div>}
      </div>
      <Markdown text={h.body_md} />
    </div>
  );
}

function HandoffHistory({ id }: { id: string }) {
  const { data } = useApi<Handoff[]>(`handoffs?topic=${encodeURIComponent(id)}&all=1&limit=100`);
  if (!data) return <Loading />;
  if (!data.length) return <Empty>还没有交接包</Empty>;
  return (
    <div>
      {data.map((h, i) => (
        <details key={h.id} className="history-item" open={i === 0}>
          <summary>
            <b>{h.title}</b> <span className="muted small">· {h.author_agent} · {fmtTime(h.created_at)}</span>
            {h.status === "superseded" && <span className="pill warn">已被替换</span>}
          </summary>
          <HandoffView h={h} />
        </details>
      ))}
    </div>
  );
}

const TL_LABEL: Record<string, string> = { topic: "创建", handoff: "交接包", card: "卡片", link: "关联" };

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
    <div className="timeline">
      {days.map(([d, evs]) => (
        <div key={d} className="tl-day">
          <div className="tl-date">{d}</div>
          {evs.map((e) => (
            <div key={`${e.type}-${e.id}`} className={`tl-item tl-${e.type} ${e.status ? "tl-inactive" : ""}`}>
              <span className="tl-time">{fmtTime(e.ts, false)}</span>
              <span className="tl-type">{e.type === "card" ? <KindTag kind={e.kind} /> : <span className="kind-tag k-handoff">{TL_LABEL[e.type]}</span>}</span>
              <span className="tl-text">
                {e.type === "link" ? `${e.kind}：${e.text}` : e.text}
                {e.status && <span className="pill warn">{e.status === "superseded" ? "已替换" : "已归档"}</span>}
              </span>
              {e.author_agent && <AgentTag agent={e.author_agent} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
