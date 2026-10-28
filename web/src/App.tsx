import { FileText, Home, MessageSquareText, MessagesSquare, Settings2, Spline } from "lucide-react";
import { useApi, useLive } from "./api";
import { CommandPalette } from "./palette";
import { useRoute } from "./router";
import { Messages } from "./pages/Messages";
import { Report } from "./pages/Report";
import { Search } from "./pages/Search";
import { SessionView } from "./pages/SessionView";
import { Sessions } from "./pages/Sessions";
import { Status } from "./pages/Status";
import { Today } from "./pages/Today";
import { Topics } from "./pages/Topics";

const NAV = [
  { path: "", label: "今日", Icon: Home },
  { path: "topics", label: "工作线", Icon: Spline },
  { path: "sessions", label: "会话", Icon: MessageSquareText },
  { path: "messages", label: "消息", Icon: MessagesSquare },
  { path: "report", label: "日报", Icon: FileText },
  { path: "status", label: "状态", Icon: Settings2 },
];

export function App() {
  const route = useRoute();
  const { connected } = useLive();
  const msg = useApi<{ unread: number }>("messages?limit=1");
  const status = useApi<{ version: string }>("status", { live: false });
  const top = route.path[0] ?? "";

  let page;
  switch (route.path[0]) {
    case undefined:
      page = <Today />;
      break;
    case "topics":
      page = <Topics id={route.path[1]} tab={route.query.get("tab") ?? "overview"} filter={route.query.get("f") ?? "active"} />;
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
      page = <div className="page empty">没有这个页面</div>;
  }

  return (
    <div className="shell">
      <aside className="rail">
        <a className="rail-brand" href="#/">
          <b>灵犀</b>
          <span>让每个会话心有灵犀</span>
        </a>
        <nav aria-label="主导航">
          {NAV.map(({ path, label, Icon }) => (
            <a key={path} href={`#/${path}`} className={top === path ? "on" : ""}>
              <Icon size={18} strokeWidth={1.7} />
              {label}
              {path === "messages" && (msg.data?.unread ?? 0) > 0 && <span className="rail-dot" title={`${msg.data!.unread} 条未读`} />}
            </a>
          ))}
        </nav>
        <div className="rail-ink" aria-hidden />
        <div className="rail-foot">
          <span className={`live ${connected ? "on" : ""}`} />
          {connected ? "实时同步中" : "未连接"}
          <span className="faint">· v{status.data?.version ?? ""}</span>
        </div>
      </aside>
      <main className="main">{page}</main>
      <CommandPalette />
    </div>
  );
}
