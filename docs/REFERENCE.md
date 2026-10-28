# 灵犀参考手册

命令、工具参数、配置位置和数据存放的完整说明。怎么用见 [使用指南](USAGE.md)。

- [MCP 工具](#mcp-工具)
- [CLI 命令](#cli-命令)
- [各 agent 的接入位置](#各-agent-的接入位置)
- [数据与隐私](#数据与隐私)
- [环境变量](#环境变量)

---

## MCP 工具

agent 通过这些工具读写灵犀。在 pi 里显示为 `mcp__lingxi__<工具名>`，在 Claude Code 里也类似。

| 工具 | 主要参数 | 作用 |
|---|---|---|
| `topic_list` | `status?`（active / archived / all）, `project?` | 列出工作线；传 `project`（绝对路径）则只列出绑定到该项目的工作线 |
| `topic_create` | `name`, `description?`, `project?` | 创建工作线，可同时绑定项目目录（`save_handoff` / `remember` 遇到不存在的 topic 也会自动创建） |
| `topic_get` | `topic`, `card_limit?` | 工作线概览：绑定的项目 + 最新交接包全文 + 更早的交接包列表 + 卡片 + 关联项 |
| `topic_link` | `topic`, `target_type`, `target_id`, `note?` | 把项目目录、会话、交接包、卡片、文件、URL 关联到工作线 |
| `topic_unlink` | `topic`, `target_type`, `target_id` | 移除关联（例如解绑项目） |
| `topic_timeline` | `topic?` 或 `project?`, `since?`, `until?`, `order?`, `limit?` | 时间线：某个工作线或某个项目下所有工作线的创建、交接包（含已替换的）、卡片（含已归档的）、关联 |
| `save_handoff` | `title`, `body_md`, `topic?`, `source_session?`, `refs?`, `supersedes?` | 保存交接包（正文由当前 agent 按模板撰写） |
| `load_handoff` | `id?` 或 `topic?`，都不传则取最新一个 | 加载交接包 |
| `list_handoffs` | `topic?`, `include_superseded?`, `limit?` | 列出交接包 |
| `remember` | `kind`, `content`, `topic?`, `refs?` | 写入知识卡片 |
| `recall` | `query?`, `topic?`, `kind?`, `limit?` | 查找知识卡片 |
| `forget` | `id` | 归档一张卡片（不再出现在查找和搜索结果里） |
| `search` | `query`, `topic?`, `type?`（handoff / card）, `limit?` | 跨所有交接包和卡片全文检索；多个词之间是「且」的关系，中英文都支持 |
| `list_sessions` | `agent?`, `project?`, `since?`, `until?`, `limit?` | 列出自动导入的会话（Claude Code / Codex / pi / 豆包工作 / WorkBuddy，最新在前） |
| `search_sessions` | `query`, `agent?`, `project?`, `since?`, `until?`, `include_tools?`, `limit?` | 搜会话原文（默认只搜用户和助手的对话），结果带会话引用 |
| `read_session` | `ref`, `before?`, `after?`, `from?`, `limit?`, `tools?`, `max_chars?` | 读会话：`codex:<id>`（最后 40 条对话）、`pi:<id>#42`（第 42 条前后，含工具）、`claude-code:<id>#10..30`（区间） |
| `whoami` | — | 本会话在灵犀里的身份：agent、会话引用、标签、目录、加入的工作线 |
| `register` | `label?`, `topics?`, `activity?` | 设置好记的标签、加入工作线、说明正在做什么 |
| `list_agents` | `all?` | 在线会话列表（消息的收件人） |
| `send_message` | `to`, `body`, `kind?`, `refs?`, `reply_to?` | 给其他会话发消息；`to` 可以是标签、会话引用、`topic:<名称>`、`project:<路径>`、`all`；回复时用 `reply_to`（`to` 可留空） |
| `check_inbox` | `mark_read?`, `include_read?`, `limit?` | 读取发给本会话的消息 |
| `consult_session` | `ref`, `question`, `confirm?`, `model?`, `timeout_sec?`, `save_to_topic?` | 后台咨询：让历史会话（Claude Code / Codex / pi）的只读副本带着完整上下文回答问题。不带 `confirm` 时只返回大小估算；`confirm=true` 才真正执行（产生模型费用） |
| `get_activity` | `date?`（today / yesterday / YYYY-MM-DD）或 `since?` / `until?`, `project?`, `git?` | 活动汇总：按项目列出会话、灵犀笔记、git 提交、当前未提交改动 |

取值说明：

| 参数 | 可选值 |
|---|---|
| 卡片 `kind` | `decision` · `fact` · `finding` · `constraint` · `todo` · `dead_end` · `note` |
| 关联 `target_type` | `project`（项目目录）· `session`（如 `codex:<会话ID>`）· `handoff` · `card` · `path` · `url` · `topic` |
| 时间 `since` / `until` | 相对时间 `30m`、`12h`、`7d`、`2w`；或日期 `2026-10-23`、`2026-10-23 15:30` |
| 消息类型 `kind` | `note`（默认）· `question` · `answer` · `request` · `notify` |
| 消息收件人 `to` | 标签（如 `research-pdf`）· 会话引用（如 `codex:da497af449db`）· `topic:<名称>` · `project:<绝对路径>` · `all` |
| 会话引用 `ref` | `<agent>:<id 末段或开头>`，可加 `#序号` 或 `#起..止`，如 `codex:da497af449db#42`、`pi:01a16790` |

写入时会自动记录来源 agent：优先用安装器为每个 agent 设置的 `LINGXI_AGENT`，否则根据 MCP 客户端信息识别。

---

## CLI 命令

CLI 和 MCP 读写同一份数据，适合人手动查看、整理，也可以给接不了 MCP 的工具兜底。`lx` 是 `lingxi` 的别名。

```bash
# 图形界面
lingxi ui [--port N] [--no-open]                       # 本地网页界面（只监听 127.0.0.1，带访问令牌）

# 帮助
lingxi guide [--full]                                  # 使用速查（--full：完整使用指南）
lingxi --help ;  lingxi <命令> --help

# 状态
lingxi status

# 工作线
lingxi topic ls [-a] [-p [路径]]                       # -a 包含已归档；-p 只看绑定到某项目的（不带值 = 当前目录）
lingxi topic new <名称> [-d 描述] [-p [路径]]            # -p 同时绑定项目目录
lingxi topic show <名称或ID>                           # 完整概览
lingxi topic bind <topic> [路径] ;  lingxi topic unbind <topic> [路径]   # 绑定 / 解绑项目（默认当前目录）
lingxi topic link <topic> <type> <target> [-n 备注]    # type: project|session|handoff|card|path|url|topic
lingxi topic unlink <topic> <type> <target>
lingxi topic archive <topic> ;  lingxi topic unarchive <topic>

# 交接包
lingxi handoff save -t "标题" --topic X -f body.md     # 或从标准输入读正文：... | lingxi handoff save -t "标题"
            [--source codex:<id>] [--ref <来源>]... [--supersedes <旧ID>] [--agent <名称>]
lingxi handoff load [id] [--topic X]                   # 不传 id 取最新
lingxi handoff ls [--topic X] [-a] [-n 20]

# 知识卡片
lingxi remember <kind> <内容...> [--topic X] [--ref <来源>]...
lingxi recall [关键词...] [--topic X] [--kind decision] [-n 20]
lingxi forget <卡片ID>

# 搜索
lingxi search <关键词...> [--topic X] [--type handoff|card] [-n 10]
lingxi search -s <关键词...> [--agent codex] [-p [路径]] [--since 7d] [--tools] [-n 10]   # 搜会话原文

# 会话（Claude Code / Codex / pi / 豆包工作 / WorkBuddy，自动导入）
lingxi sync [--full] [--agent claude-code codex pi]    # 手动同步（查询前也会自动增量同步）
lingxi sessions [--agent X] [-p [路径]] [--since 7d] [-n 20]
lingxi show <ref> [--tools] [--from N] [-n 40] [--context 6]

# 跨会话消息
lingxi who [-a]                                        # 在线会话
lingxi send <收件人> <内容...> [--kind request] [--ref ...] [--reply-to <id>]   # 以「用户」身份发送；回复时收件人写 -
lingxi inbox [-a] [--as <标签或会话引用>]                # 看发给你的消息；--as 查看某个会话的收件箱（不标记已读）
lingxi hook <agent> <event>                            # 钩子入口（Claude Code / Codex 自动调用，一般不用手动运行）

# 后台咨询（产生模型费用）
lingxi consult <ref> <问题...> [--estimate] [-y] [--model M] [--timeout 180] [--save-topic X]

# 活动汇总（日报 / 周报）
lingxi activity [today|yesterday|YYYY-MM-DD] [--since 7d] [--until ...] [-p [路径]] [--no-git]

# 时间线（开发历程 / 进度）
lingxi timeline [topic] [-p [路径]] [--since 7d] [--until 2026-10-31] [--desc] [-n 200]
                                                       # 不传 topic 时 = 当前目录所属项目的全部工作线

# 接入与卸载
lingxi install   [claude-code codex pi cursor workbuddy doubao] [--dry-run] [--skill-only] [--mcp-only] [--hooks] [--no-extension]
lingxi uninstall [targets...] [--dry-run]

# MCP 服务（由各 agent 启动，一般不用手动运行）
lingxi mcp
```

例子：

```bash
lingxi topic ls -p                                     # 当前项目有哪些工作线
lingxi timeline --since 7d                             # 当前项目最近一周的历程
lingxi topic show 导出需求
lingxi search Playwright
lingxi remember constraint 接口必须兼容 v1 --topic 导出需求
lingxi handoff load --topic XX调研 > research.md       # 导出成文件，可以贴给任何工具
```

---

## 图形界面的实现

- `lingxi ui` 启动一个本地 HTTP 服务（Node 自带模块），只监听 `127.0.0.1`，前端是构建好的静态页面（`dist/web`）。
- **访问令牌**：每次启动随机生成，通过启动时打开的链接传给页面，页面存在当前标签页里并从地址栏移除。所有 `/api` 请求都要带令牌；修改类请求（发消息、同步）只接受请求头里的令牌，并检查来源是否是本页面。
- **防 DNS 重绑定**：只接受 Host 为 `127.0.0.1:<端口>` 或 `localhost:<端口>` 的请求。
- **实时刷新**：`/api/events`（服务器推送），后端每 2 秒检查一次数据库是否变化。
- 界面打开期间每 30 秒做一次增量会话同步。

## 跨会话消息的实现

- **身份**：每个会话在灵犀里有一条在线记录，键是 `<agent>:<会话 ID>`。会话 ID 的来源依次是：环境变量（如 pi 的 `PI_SESSION_ID`）→ pi 扩展或钩子已登记的同目录会话 → 导入的会话记录里同目录、启动时间对得上的最新会话；都拿不到时暂用进程号，拿到后自动切换。
- **在线**：MCP 服务每 30 秒、pi 扩展每 15 秒刷新一次；2 分钟没刷新算离线（只靠钩子登记的会话是 30 分钟）。
- **投递**：消息存进数据库，收件人在读取时匹配（直接 / 标签 / 工作线 / 项目 / 广播），按读者分别记录已读。
- **pi 扩展**：`~/.pi/agent/extensions/lingxi.ts`（一行转发到灵犀的 `dist/integrations/pi-extension.js`）。每 3 秒检查一次：空闲时以自定义消息开始新一轮，忙时作为 follow-up 排队。`LINGXI_PI_AUTOTRIGGER=0` 只排到下一轮、不自动开始；`/lingxi` 命令查看在线会话和未读数。
- **钩子**（`--hooks`，可选）：Claude Code 写入 `~/.claude/settings.json`，Codex 写入 `~/.codex/hooks.json`，事件为 `SessionStart` 和 `UserPromptSubmit`，输出 `hookSpecificOutput.additionalContext`。

## 后台咨询的实现

| Agent | 实际执行的命令（问题通过标准输入传入） | 只读与不留痕 |
|---|---|---|
| pi | `pi -p --session <临时副本> --session-dir <临时目录> --no-tools --no-mcp --no-skills --no-extensions --no-context-files --mode json` | 在会话文件的临时副本上继续，不碰原文件；禁用全部工具；结束后删除临时目录 |
| Codex | `codex exec fork <id> --ephemeral -c sandbox_mode=read-only -c approval_policy=never --json -o <文件> -` | `--ephemeral` 不保存新会话；只读沙箱 |
| Claude Code | `claude -p --resume <id> --fork-session --no-session-persistence --tools "" --output-format json`（在会话的工作目录下执行） | 复制会话、不保存、禁用全部工具（**尚未实测**） |

转发给副本的问题会加上一段说明：这是来自另一个会话的只读咨询，只根据已有上下文回答，不要调用工具、不要修改文件。

## 各 agent 的接入位置

`lingxi install` 写入的位置：

| Agent | MCP 注册位置 | Skill 位置 | 安装方式 |
|---|---|---|---|
| Claude Code | `claude mcp add-json --scope user`（写入 `~/.claude.json`）；`--hooks` 时另写 `~/.claude/settings.json` | `~/.claude/skills/lingxi` | 自动（钩子可选） |
| Codex | `~/.codex/config.toml` → `[mcp_servers.lingxi]`；`--hooks` 时另写 `~/.codex/hooks.json` | `~/.agents/skills/lingxi` | 自动（钩子可选，需在 `/hooks` 批准） |
| pi | `~/.pi/agent/mcp.json`（`exposure: direct`）+ 扩展 `~/.pi/agent/extensions/lingxi.ts` | `~/.agents/skills/lingxi` | 自动（`--no-extension` 不装扩展） |
| Cursor | `~/.cursor/mcp.json` | `~/.agents/skills/lingxi` | 自动 |
| WorkBuddy | `~/.workbuddy/mcp.json` | `~/.workbuddy/skills/lingxi` | 自动（首次使用可能需要在应用内批准） |
| 豆包工作 | 应用内「自定义连接器」 | `~/DoubaoWork/skills/lingxi` | MCP 需手动添加，Skill 自动 |

- `~/.agents/skills` 是 Codex、pi、Cursor 共用的 Skill 目录，只装一份。
- 启动命令是**绝对路径**（当前 `node.exe` 加 `dist/cli/index.js mcp`），不依赖 PATH。项目目录移动后需要重新执行 `npm run build && lingxi install`。
- 修改配置前会备份为 `<原文件>.lingxi-bak-<时间>`。
- 为了让后台咨询不被 agent 的工具超时打断，安装器会把超时调长：Codex `tool_timeout_sec = 600`，pi `timeout: 600`（秒），WorkBuddy `timeout: 600000`（毫秒）。

---

## 数据与隐私

| 内容 | 位置 |
|---|---|
| 数据库 | `~/.lingxi/lingxi.db`（SQLite，WAL 模式，多个 agent 同时读写是安全的） |
| 交接包 Markdown | `~/.lingxi/vault/handoffs/<年-月>/<id>.md` |
| 导入的会话 | 同一个数据库的 `sessions` / `turns` 表（只读导入，不修改原始会话文件） |
| 备份 | 复制 `~/.lingxi/` 整个目录即可 |

- **纯本地**：不联网，不调用任何外部模型；所有内容都由你正在用的 agent 自己写入。
- **会话导入**：只读取 `~/.claude/projects`、`~/.codex/sessions`、`~/.pi/agent/sessions`、豆包工作智能体模式的 `trajectory.jsonl`、`~/.workbuddy/projects`；不导入模型的思考过程；工具输出截断保存；常见密钥格式（`sk-…`、`Bearer …`、`api_key=…` 等）会被打码。可用 `LINGXI_INGEST` 关闭。
- **自定义打码**：在 `~/.lingxi/redact.txt` 里每行写一个要打码的字符串（以 `re:` 开头表示正则，`#` 开头是注释），然后执行 `lingxi sync --full` 重新导入。适合密码这类没有固定格式、内置规则识别不了的内容。
- **不要往灵犀里存密钥、token、密码**（Skill 也会提醒 agent 不要这样做）。

---

## 环境变量

| 变量 | 作用 |
|---|---|
| `LINGXI_HOME` | 数据目录，默认 `~/.lingxi`。在执行 `lingxi install` 之前设置，安装器会把它写进各 agent 的配置 |
| `LINGXI_AGENT` | 写入记录时的来源 agent 名称。安装器会为每个 agent 自动设置；CLI 不设置时记为 `cli` |
| `LINGXI_PI_AUTOTRIGGER` | pi 扩展：设为 `0` 时收到消息不自动开始新一轮，只排到下一轮 |
| `LINGXI_PI_POLL_MS` | pi 扩展检查新消息的间隔，默认 3000 毫秒 |
| `LINGXI_CONSULT_AUTOCONFIRM_TOKENS` | 后台咨询：估算 token 数不超过这个值时，agent 不用再确认就可以直接执行；默认 0（每次都确认） |
| `LINGXI_INGEST` | 要导入哪些 agent 的会话：逗号分隔（`claude-code,codex,pi,doubao,workbuddy`），`none` 关闭；默认全部 |
| `LINGXI_DOUBAO_DIR` / `LINGXI_WORKBUDDY_DIR` | 覆盖豆包工作（默认 `%LOCALAPPDATA%/DoubaoWork/User Data/Profile 1/.doubaowork/agent_mode/workspace/.sessions`）和 WorkBuddy（默认 `~/.workbuddy/projects`）的会话目录 |
| `LINGXI_CLAUDE_DIR` / `LINGXI_CODEX_DIR` / `LINGXI_PI_DIR` | 覆盖会话记录目录（默认 `~/.claude/projects`、`~/.codex`、`~/.pi/agent/sessions`） |
