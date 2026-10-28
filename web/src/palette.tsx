import { ArrowRight, FileText, Hash, MessagesSquare, Search, Spline } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { navigate } from "./router";
import type { Topic } from "./types";
import { AgentDot, KindTag, Snippet, agentName } from "./ui";

type Item = { key: string; group: string; icon: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode; go: () => void };

const NAV: [string, string][] = [
  ["/", "今日"],
  ["/topics", "工作线"],
  ["/sessions", "会话"],
  ["/messages", "消息"],
  ["/report", "日报"],
  ["/status", "状态"],
];

export function openPalette() {
  window.dispatchEvent(new Event("lingxi:palette"));
}

/** Ctrl/⌘+K: jump to pages and topics, search handoffs, cards and session transcripts. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [hits, setHits] = useState<{ notes: any[]; sessions: any[] }>({ notes: [], sessions: [] });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("lingxi:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lingxi:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setHits({ notes: [], sessions: [] });
    api<Topic[]>("topics?status=all").then(setTopics).catch(() => {});
    setTimeout(() => input.current?.focus(), 10);
  }, [open]);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return setHits({ notes: [], sessions: [] });
    const id = setTimeout(() => {
      api<{ notes: any[]; sessions: any[] }>(`search?q=${encodeURIComponent(t)}&limit=6`).then(setHits).catch(() => {});
    }, 180);
    return () => clearTimeout(id);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const close = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const out: Item[] = [];
    if (t) out.push({ key: "search", group: "搜索", icon: <Search size={16} />, label: <>在全部内容里搜索「{q.trim()}」</>, go: close(() => navigate("/search", { q: q.trim() })) });
    for (const [p, l] of NAV) if (!t || l.includes(t)) out.push({ key: `nav${p}`, group: "页面", icon: <ArrowRight size={16} />, label: l, go: close(() => navigate(p)) });
    for (const tp of topics.filter((x) => !t || x.name.toLowerCase().includes(t)).slice(0, t ? 6 : 5))
      out.push({ key: tp.id, group: "工作线", icon: <Spline size={16} />, label: tp.name, sub: `${tp.handoffs ?? 0} 交接包 · ${tp.cards ?? 0} 卡片`, go: close(() => navigate(`/topics/${encodeURIComponent(tp.id)}`)) });
    for (const h of hits.notes)
      out.push({
        key: h.doc_id,
        group: "交接包与卡片",
        icon: h.doc_type === "handoff" ? <FileText size={16} /> : <KindTag kind={h.title.replace(/[[\]]/g, "")} />,
        label: <span className="ellipsis">{h.doc_type === "handoff" ? h.title : <Snippet text={h.snippet} />}</span>,
        sub: h.topic,
        go: close(() => h.topic_id && navigate(`/topics/${encodeURIComponent(h.topic_id)}`)),
      });
    for (const h of hits.sessions)
      out.push({
        key: `${h.session_id}#${h.seq}`,
        group: "会话原文",
        icon: <AgentDot agent={h.agent} />,
        label: <span className="ellipsis"><Snippet text={h.snippet} /></span>,
        sub: `${agentName(h.agent)} · ${h.title ?? ""}`,
        go: close(() => navigate(`/sessions/${encodeURIComponent(h.session_id)}`, { seq: h.seq })),
      });
    return out;
  }, [q, topics, hits]);

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, items.length - 1))), [items.length]);
  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="palette-back" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="搜索与跳转">
        <input
          ref={input}
          value={q}
          placeholder="搜索工作线、交接包、会话原文，或输入页面名…"
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") items[sel]?.go();
          }}
        />
        <div className="palette-list">
          {items.length === 0 && <div className="empty">没有匹配的内容</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="palette-group">{(lastGroup = it.group)}</div> : null;
            return (
              <div key={it.key}>
                {head}
                <div className={`palette-item ${i === sel ? "on" : ""}`} onMouseEnter={() => setSel(i)} onClick={it.go}>
                  {it.icon}
                  <span className="grow ellipsis">{it.label}</span>
                  {it.sub && <span className="sub ellipsis">{it.sub}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SearchTrigger() {
  return (
    <button className="kbd-search" onClick={openPalette} aria-label="搜索（Ctrl K）">
      <Search size={16} />
      <span>搜索工作线、交接包、会话…</span>
      <kbd>Ctrl</kbd>
      <kbd>K</kbd>
    </button>
  );
}

export const HashIcon = Hash;
export const ChatIcon = MessagesSquare;
