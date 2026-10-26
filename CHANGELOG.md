# 更新日志

## 0.3.0 — 2026-10-26

### 后台咨询（P1-b）

- 新增 MCP 工具 `consult_session` 和命令 `lingxi consult`：让历史 Claude Code / Codex / pi 会话的**只读、不保存的副本**带着完整上下文回答问题，原会话不受影响。
  - pi：在会话文件的临时副本上继续，禁用全部工具；Codex：`exec fork --ephemeral`，只读沙箱；Claude Code：`--fork-session --no-session-persistence --tools ""`（尚未实测）。
  - 默认先返回大小估算，需确认后才执行（`confirm=true` / `-y`）；`LINGXI_CONSULT_AUTOCONFIRM_TOKENS` 可设置免确认阈值。
  - 可选把问答存成 finding 卡片（`save_to_topic` / `--save-topic`）。
  - 看到回答完成后最多再等 3 秒即结束进程树，避免 CLI 滞留拖慢响应；MCP 调用期间发送进度通知。
- 安装器为 Codex、pi、WorkBuddy 写入更长的 MCP 工具超时（600 秒）。
- 共 18 个 MCP 工具；测试 41 个（用假的 pi / codex 可执行文件测试咨询流程，不调用真实模型）。

### 文档与仓库


- README 增加痛点案例、「以前 vs 用灵犀」对照表、跨 agent 流程示意和常用命令；新增英文版 README.en.md。
- 新增演示录制脚本 docs/DEMO.md 和示例数据脚本 scripts/demo-seed.mjs（npm run demo:seed，使用独立目录，不读取真实会话）。
- GitHub 仓库添加主题标签。

## 0.2.1 — 2026-10-26

- **豆包工作会话导入**：读取智能体模式的本地明文记录（`.doubaowork/agent_mode/workspace/.sessions/<会话ID>/agents/<agentID>/system/trajectory.jsonl`），只取主 agent；过滤 `<system-reminder>` 等注入内容；记录没有逐条时间戳，用户消息按 `assignment.md` 里每轮需求的时间对齐，其余消息沿用前一条用户消息的时间；记录可能被重写，所以变化后整文件重新导入。
  - 更正：之前认为豆包的对话是加密存储的，这是错的；加密的只是部分配置（如连接器配置）。
- **WorkBuddy 会话导入**：从 `<user_query>` 中提取真正的用户输入；每个会话自动创建的临时工作目录不当作项目。
- 没有工作目录的会话（豆包、WorkBuddy 临时目录）在活动汇总里按 agent 分组。
- 打码增强：新增中文「密码 / 口令 / 密钥：…」规则；支持 `~/.lingxi/redact.txt` 自定义打码（字符串或 `re:` 正则）。
- 新增环境变量 `LINGXI_DOUBAO_DIR`、`LINGXI_WORKBUDDY_DIR`；`LINGXI_INGEST` 可选值增加 `doubao`、`workbuddy`。
- 会话短引用：非 UUID 的 id（如豆包的会话 ID）显示完整 id。


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
