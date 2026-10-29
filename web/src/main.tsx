import { createRoot } from "react-dom/client";
import { App } from "./App";
import { token } from "./api";
import "./styles.css";
import "./ink.css";
import "./night.css";
import "./theme";

const root = createRoot(document.getElementById("root")!);
if (!token) {
  root.render(
    <div className="no-token">
      <h2>🪢 灵犀 Lingxi</h2>
      <p>缺少访问令牌。请在终端运行 <code>lingxi ui</code>，用它打开的链接访问。</p>
    </div>,
  );
} else {
  root.render(<App />);
}
