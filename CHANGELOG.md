# 更新日志

## 0.1.0 — 2026-10-23

### P0.5 项目记忆

- 工作线可以**绑定项目目录**（多对多）。在子目录里能找到绑定在项目根目录的工作线，反过来在根目录也能看到绑定在子目录上的工作线；Windows 路径不区分大小写。
  - MCP：`topic_list` / `topic_create` 增加 `project` 参数；`topic_link` 支持 `target_type=project`；新增 `topic_unlink`。
  - CLI：`topic new -p`、`topic ls -p`、`topic bind` / `unbind`、`topic unlink`。
- **时间线**：按时间列出某个工作线或某个项目下所有工作线的创建、交接包（含已替换的）、卡片（含已归档的）和关联项。
  - MCP：`topic_timeline`；CLI：`lingxi timeline`，支持 `--since 7d` / `--until` / `--desc`。
- Skill 新增「把工作线当项目记忆」的用法说明。
- 按用户要求**不**自动写入或注入 CLAUDE.md / AGENTS.md。

### P0 中枢

- 本地 SQLite 存储（Node 内置 `node:sqlite`，WAL，FTS5 trigram 中文检索，短词回退到 LIKE），交接包同时另存为 Markdown 文件。
- MCP stdio 服务：工作线、交接包、知识卡片、全文搜索，共 11 个工具。通过 `LINGXI_AGENT` 或客户端信息自动识别写入的 agent。
- CLI：`lingxi` / `lx`。
- 通用 Skill（`skills/lingxi/SKILL.md`）。
- 安装器：自动接入 Claude Code、Codex、pi、Cursor、WorkBuddy（`~/.workbuddy/mcp.json`）；豆包打印手动配置。修改前自动备份，支持 `--dry-run` 和卸载。
- 实测：Codex 写入 → pi 读取；Claude Code、Codex、pi 的 MCP 连接正常。
