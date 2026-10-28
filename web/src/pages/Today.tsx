import { ChevronRight, FileText, FolderGit2, GitBranch, Mail } from "lucide-react";
import { useApi } from "../api";
import { SearchTrigger } from "../palette";
import { href } from "../router";
import type { Message, Presence, ProjectSummary, Topic, WeaveData } from "../types";
import { AgentAvatar, AgentDot, Empty, ErrorBox, Loading, PageHeader, Panel, agentName, fmtAgo, fmtDay, fmtTime, shortPath, topicHref } from "../ui";
import { Loom } from "./Loom";

interface TodayData {
  presence: Presence[];
  topics: Topic[];
  unread: number;
  messages: Message[];
}

export function Today() {
  const today = useApi<TodayData>("today?git=0");
  const day = new URLSearchParams(location.hash.split("?")[1] ?? "").get("day") ?? "today";
  const weave = useApi<WeaveData>(`weave?date=${day}`);
  const projects = useApi<ProjectSummary[]>("projects?since=14d&limit=6");
  const inbox = useApi<{ messages: Message[]; unread: number }>("messages?limit=50");

  if (today.error && !today.data) return <div className="page"><ErrorBox error={today.error} /></div>;
  const t = today.data;
  const online = t?.presence ?? [];
  const activeAgents = new Set(online.map((p) => p.agent)).size;

  // Things that want the user's attention right now.
  const attention: { key: string; icon: React.ReactNode; who: string; title: string; sub: string; time: number; to: string }[] = [];
  for (const m of (inbox.data?.messages ?? []).filter((x) => x.to_user && !x.read_by_user).slice(0, 3))
    attention.push({ key: m.id, icon: <AgentAvatar agent={m.from_agent} />, who: m.from_label ?? agentName(m.from_agent), title: "给你发来一条消息", sub: m.body, time: m.created_at, to: href("/messages") });
  for (const p of (projects.data ?? []).filter((x) => x.dirty > 0).slice(0, 3))
    attention.push({ key: p.root, icon: <span className="avatar"><GitBranch size={16} /></span>, who: p.name, title: "有未提交的改动", sub: `${p.dirty} 个文件未提交${p.branch ? ` · ${p.branch}` : ""}`, time: p.last, to: href("/report") });
  for (const k of (weave.data?.knots ?? []).filter((x) => x.type === "handoff").slice(-2).reverse())
    attention.push({ key: k.id, icon: <span className="avatar"><FileText size={16} /></span>, who: k.topic ?? "未归类", title: "交接包已更新", sub: `${agentName(k.agent)} 保存了「${k.text}」`, time: k.ts, to: k.topic_id ? topicHref(k.topic_id) : href("/topics") });

  return (
    <div className="page">
      <PageHeader title="今日" sub={fmtDay(Date.now())} actions={<SearchTrigger />} />

      <Panel
        title={day === "today" ? "今日织机" : "昨日织机"}
        sub={online.length ? `${online.length} 个会话在线 · ${activeAgents} 种 agent` : "现在没有在线的会话"}
        action={
          <div className="seg">
            <a className={day === "today" ? "on" : ""} href="#/?day=today">今天</a>
            <a className={day === "yesterday" ? "on" : ""} href="#/?day=yesterday">昨天</a>
          </div>
        }
        flush
      >
        {weave.data ? <Loom data={weave.data} isToday={day === "today"} /> : <Loading />}
        <div className="loom-legend">
          <span><i className="dot" style={{ ["--c" as string]: "var(--celadon)", width: 18, height: 6, borderRadius: 3 }} />一条线是一个会话的活跃时段</span>
          <span><i className="dot" style={{ ["--c" as string]: "var(--brass)" }} />结点是保存的交接包和卡片</span>
          <span>⤳ 虚线箭头是会话之间的消息</span>
          <span className="faint">悬停查看详情，点击打开</span>
        </div>
      </Panel>

      <div className="cols cols-today" style={{ marginTop: 16 }}>
        <div className="stack">
          <Panel title="需要关注" sub={attention.length ? `${attention.length} 件` : undefined}>
            {attention.length === 0 ? (
              <Empty title="眼下没有需要你处理的事">新消息、未提交的改动和刚更新的交接包会出现在这里。</Empty>
            ) : (
              <ul className="rows">
                {attention.map((a) => (
                  <li key={a.key}>
                    <a className="row" href={a.to}>
                      {a.icon}
                      <span style={{ width: 130 }} className="row-title ellipsis">{a.who}</span>
                      <span className="grow">
                        <span className="row-title" style={{ fontWeight: 500 }}>{a.title}</span>
                        <span className="row-sub ellipsis" style={{ display: "block" }}>{a.sub}</span>
                      </span>
                      <span className="faint xs nowrap">{fmtTime(a.time)}</span>
                      <ChevronRight size={16} className="chev" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="项目" sub="最近两周有 agent 工作过的目录" action={<a href={href("/report")}>看日报</a>}>
            {!projects.data ? (
              <Loading />
            ) : projects.data.length === 0 ? (
              <Empty>最近两周没有项目活动</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 0 }}>名称</th>
                    <th>分支</th>
                    <th>参与的 agent</th>
                    <th>状态</th>
                    <th>最近</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.data.map((p) => (
                    <tr key={p.root} onClick={() => (location.hash = href("/sessions", { project: p.root }).slice(1))} title={p.root}>
                      <td style={{ paddingLeft: 0 }}>
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <FolderGit2 size={16} color="var(--moss)" />
                          <b style={{ fontWeight: 600 }}>{p.name}</b>
                        </span>
                      </td>
                      <td>{p.branch ? <span className="tag branch">{p.branch.length > 26 ? "…" + p.branch.slice(-24) : p.branch}</span> : <span className="faint">—</span>}</td>
                      <td>
                        <span className="dots">{p.agents.map((a) => <AgentDot key={a} agent={a} />)}</span>
                      </td>
                      <td>{p.dirty > 0 ? <span className="tag warn">{p.dirty} 处改动</span> : <span className="faint xs">干净</span>}</td>
                      <td className="faint xs nowrap">{fmtAgo(p.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="在线" sub={`${online.length} 个会话`} action={<a href={href("/messages")}>发消息</a>}>
            {!t ? (
              <Loading />
            ) : online.length === 0 ? (
              <Empty title="现在没有在线的会话">打开 pi、Claude Code 或 Codex，它们会自动出现在这里。</Empty>
            ) : (
              <ul className="rows">
                {online.map((p) => (
                  <li key={p.key}>
                    <div className="row">
                      <AgentAvatar agent={p.agent} />
                      <span className="grow">
                        <span className="row-title">{p.label}</span>
                        <span className="row-sub ellipsis" style={{ display: "block" }}>
                          {agentName(p.agent)} · {p.activity ?? fmtAgo(p.last_seen)}
                        </span>
                      </span>
                      <span className="mono faint ellipsis" style={{ maxWidth: 170 }} title={p.cwd ?? ""}>
                        {shortPath(p.cwd, 2)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="最近的工作线" action={<a href={href("/topics")}>全部</a>}>
            {!t ? (
              <Loading />
            ) : t.topics.length === 0 ? (
              <Empty title="还没有工作线">在任意 agent 里说「保存交接到灵犀，topic 叫 XX」就会创建一条。</Empty>
            ) : (
              <ul className="rows">
                {t.topics.slice(0, 5).map((tp) => (
                  <li key={tp.id}>
                    <a className="row" href={topicHref(tp.id)}>
                      <span style={{ width: 2, alignSelf: "stretch", background: "var(--line)", borderRadius: 1 }} />
                      <span className="grow">
                        <span className="row-title serif" style={{ fontSize: 15 }}>{tp.name}</span>
                        <span className="row-sub" style={{ display: "block" }}>
                          {fmtTime(tp.updated_at)} · {tp.handoffs ?? 0} 个交接包 · {tp.cards ?? 0} 张卡片
                        </span>
                      </span>
                      <ChevronRight size={16} className="chev" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {(inbox.data?.unread ?? 0) > 0 && (
            <a className="btn" href={href("/messages")} style={{ justifyContent: "center" }}>
              <Mail size={15} /> {inbox.data!.unread} 条未读消息
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
