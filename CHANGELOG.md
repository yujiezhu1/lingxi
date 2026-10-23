# 更新日志

## 0.2.0 — 2026-10-23

### 会话导入与检索（P1-a）

- 自动导入 **Claude Code、Codex、pi** 的会话记录（只读）：按字节偏移增量同步，查询前自动同步；能处理写了一半的行和被重写的文件。
  - 不导入模型思考过程、子代理会话、harness 注入的环境/指令文本；工具调用和输出截断保存；常见密钥格式打码。
  - 标题来源：Claude Code `ai-title`、Codex `session_index.jsonl`、pi `session_info`，否则取第一条用户消息。
- 新增 MCP 工具：`list_sessions`、`search_sessions`、`read_session`、`get_activity`（共 17 个工具）。
- `topic_get` 显示绑定项目里最近的会话。
- **活动汇总** `get_activity` / `lingxi activity`：按项目汇总会话（问了什么、最后回复）、灵犀笔记、git 提交和当前未提交改动，用于日报周报。
- CLI：`lingxi sync`、`sessions`、`show <ref>`、`search -s`、`activity`；`status` 显示导入的会话数。
- 会话引用：`<agent>:<id 末段>`，可加 `#序号` 或 `#起..止`（UUIDv7 的开头会撞，所以用末段），也接受 id 开头。
- 环境变量：`LINGXI_INGEST`、`LINGXI_CLAUDE_DIR` / `LINGXI_CODEX_DIR` / `LINGXI_PI_DIR`。
- 数据库 schema 升级到 v2（自动迁移）。


## 0.1.0 — 2026-10-23

### 文档与帮助

- 新增 `lingxi guide`：在终端查看使用速查（`--full` 显示完整使用指南）。
- 文档按读者拆分：README（简介与快速上手）、`docs/USAGE.md`（使用指南）、`docs/REFERENCE.md`（参考手册）、`docs/TROUBLESHOOTING.md`（常见问题与排错）。

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
