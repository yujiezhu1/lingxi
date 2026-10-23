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

取值说明：

| 参数 | 可选值 |
|---|---|
| 卡片 `kind` | `decision` · `fact` · `finding` · `constraint` · `todo` · `dead_end` · `note` |
| 关联 `target_type` | `project`（项目目录）· `session`（如 `codex:<会话ID>`）· `handoff` · `card` · `path` · `url` · `topic` |
| 时间 `since` / `until` | 相对时间 `30m`、`12h`、`7d`、`2w`；或日期 `2026-10-23`、`2026-10-23 15:30` |

写入时会自动记录来源 agent：优先用安装器为每个 agent 设置的 `LINGXI_AGENT`，否则根据 MCP 客户端信息识别。

---

## CLI 命令

CLI 和 MCP 读写同一份数据，适合人手动查看、整理，也可以给接不了 MCP 的工具兜底。`lx` 是 `lingxi` 的别名。

```bash
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

# 时间线（开发历程 / 进度）
lingxi timeline [topic] [-p [路径]] [--since 7d] [--until 2026-10-31] [--desc] [-n 200]
                                                       # 不传 topic 时 = 当前目录所属项目的全部工作线

# 接入与卸载
lingxi install   [claude-code codex pi cursor workbuddy doubao] [--dry-run] [--skill-only] [--mcp-only]
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

## 各 agent 的接入位置

`lingxi install` 写入的位置：

| Agent | MCP 注册位置 | Skill 位置 | 安装方式 |
|---|---|---|---|
| Claude Code | `claude mcp add-json --scope user`（写入 `~/.claude.json`） | `~/.claude/skills/lingxi` | 自动 |
| Codex | `~/.codex/config.toml` → `[mcp_servers.lingxi]` | `~/.agents/skills/lingxi` | 自动 |
| pi | `~/.pi/agent/mcp.json`（`exposure: direct`） | `~/.agents/skills/lingxi` | 自动 |
| Cursor | `~/.cursor/mcp.json` | `~/.agents/skills/lingxi` | 自动 |
| WorkBuddy | `~/.workbuddy/mcp.json` | `~/.workbuddy/skills/lingxi` | 自动（首次使用可能需要在应用内批准） |
| 豆包工作 | 应用内「自定义连接器」 | `~/DoubaoWork/skills/lingxi` | MCP 需手动添加，Skill 自动 |

- `~/.agents/skills` 是 Codex、pi、Cursor 共用的 Skill 目录，只装一份。
- 启动命令是**绝对路径**（当前 `node.exe` 加 `dist/cli/index.js mcp`），不依赖 PATH。项目目录移动后需要重新执行 `npm run build && lingxi install`。
- 修改配置前会备份为 `<原文件>.lingxi-bak-<时间>`。

---

## 数据与隐私

| 内容 | 位置 |
|---|---|
| 数据库 | `~/.lingxi/lingxi.db`（SQLite，WAL 模式，多个 agent 同时读写是安全的） |
| 交接包 Markdown | `~/.lingxi/vault/handoffs/<年-月>/<id>.md` |
| 备份 | 复制 `~/.lingxi/` 整个目录即可 |

- **纯本地**：不联网，不调用任何外部模型；所有内容都由你正在用的 agent 自己写入。
- **不要往灵犀里存密钥、token、密码**（Skill 也会提醒 agent 不要这样做）。

---

## 环境变量

| 变量 | 作用 |
|---|---|
| `LINGXI_HOME` | 数据目录，默认 `~/.lingxi`。在执行 `lingxi install` 之前设置，安装器会把它写进各 agent 的配置 |
| `LINGXI_AGENT` | 写入记录时的来源 agent 名称。安装器会为每个 agent 自动设置；CLI 不设置时记为 `cli` |
