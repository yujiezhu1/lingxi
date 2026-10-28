import { useState } from "react";
import { useApi, useLive } from "./api";
import { href, navigate, useRoute } from "./router";
import { Messages } from "./pages/Messages";
import { Report } from "./pages/Report";
import { Search } from "./pages/Search";
import { SessionView } from "./pages/SessionView";
import { Sessions } from "./pages/Sessions";
import { Status } from "./pages/Status";
import { Today } from "./pages/Today";
import { Topics } from "./pages/Topics";

const NAV = [
  { path: "/", label: "今日", icon: "🏠" },
  { path: "/topics", label: "工作线", icon: "🧵" },
  { path: "/sessions", label: "会话", icon: "🗂" },
  { path: "/messages", label: "消息", icon: "📨" },
  { path: "/report", label: "日报", icon: "📝" },
  { path: "/status", label: "状态", icon: "⚙" },
];

export function App() {
  const route = useRoute();
  const { connected } = useLive();
  const top = "/" + (route.path[0] ?? "");
  const [q, setQ] = useState(route.path[0] === "search" ? (route.query.get("q") ?? "") : "");
  const msg = useApi<{ unread: number; presence: unknown[] }>("messages?limit=1");

  let page;
  switch (route.path[0]) {
    case undefined:
      page = <Today />;
      break;
    case "topics":
      page = <Topics id={route.path[1]} tab={route.query.get("tab") ?? "overview"} />;
      break;
    case "sessions":
      page = route.path[1] ? <SessionView id={route.path[1]} seq={Number(route.query.get("seq")) || undefined} /> : <Sessions query={route.query} />;
      break;
    case "search":
      page = <Search q={route.query.get("q") ?? ""} scope={route.query.get("scope") ?? "all"} />;
      break;
    case "messages":
      page = <Messages />;
      break;
    case "report":
      page = <Report query={route.query} />;
      break;
    case "status":
      page = <Status />;
      break;
    default:
      page = <div className="empty">页面不存在</div>;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="logo">🪢</span>
          <span>
            <b>灵犀</b>
            <small>Lingxi</small>
          </span>
        </a>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={top === n.path || (n.path === "/" && top === "/") ? "active" : ""}>
              <span className="nav-icon">{n.icon}</span>
              {n.label}
              {n.path === "/messages" && (msg.data?.unread ?? 0) > 0 && <span className="badge">{msg.data!.unread}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`dot ${connected ? "on" : "off"}`} /> {connected ? "实时连接" : "未连接"}
          <br />
          <span className="muted">在线会话 {msg.data?.presence.length ?? 0} 个</span>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) navigate("/search", { q: q.trim() });
            }}
          >
            <input className="search-input" placeholder="🔍 搜索交接包、卡片、会话原文…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <a className="btn ghost" href={href("/messages")}>
            📬 {msg.data?.unread ?? 0}
          </a>
        </header>
        <main>{page}</main>
      </div>
    </div>
  );
}
