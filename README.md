# 灵犀 Lingxi

> 让不同 agent、不同会话之间「心有灵犀」。
> Local-first context hub shared by all your AI agents — Claude Code, Codex, pi, Cursor, WorkBuddy, 豆包工作 …

一个 agent 里沉淀的**交接包（handoff）**、**知识卡片（card）**、**工作线（topic）**，在任何其他 agent / 会话里都能加载。
设计文档：[docs/DESIGN.md](docs/DESIGN.md)。

**当前阶段：P0**（中枢 + MCP stdio + CLI + Skill + 安装器）。会话记录导入、消息、后台咨询见路线图 P1+。

## 安装（开发版）

```bash
cd lingxi
npm install
npm run build
npm link            # 可选：全局提供 `lingxi` / `lx` 命令
node dist/cli/index.js install --dry-run   # 先看会改哪些文件
node dist/cli/index.js install             # 写入各 agent 的 MCP 配置 + Skill（会自动备份原配置）
```

要求 Node ≥ 22.13（使用内置 `node:sqlite`，无原生依赖）。

| Agent | MCP 注册位置 | Skill 位置 |
|---|---|---|
| Claude Code | `claude mcp add-json --scope user`（~/.claude.json） | `~/.claude/skills/lingxi` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.lingxi]` | `~/.agents/skills/lingxi` |
| pi | `~/.pi/agent/mcp.json`（exposure: direct） | `~/.agents/skills/lingxi` |
| Cursor | `~/.cursor/mcp.json` | `~/.agents/skills/lingxi` |
| WorkBuddy | `~/.workbuddy/mcp.json`（首次使用可能需要在应用内批准） | `~/.workbuddy/skills/lingxi` |
| 豆包工作 | 自定义连接器 → stdio（安装器会打印配置） | `~/DoubaoWork/skills/lingxi` |

卸载：`lingxi uninstall [targets...]`。数据目录：`~/.lingxi/`（可用 `LINGXI_HOME` 覆盖）。

## MCP 工具

| 工具 | 作用 |
|---|---|
| `topic_list` / `topic_create` / `topic_get` / `topic_link` | 工作线：列表、创建、概览（最新交接包 + 卡片 + 关联项）、关联会话/文件/URL |
| `save_handoff` / `load_handoff` / `list_handoffs` | 保存（由当前 agent 按模板撰写）/ 加载 / 列出交接包；支持 `supersedes` |
| `remember` / `recall` / `forget` | 知识卡片：decision · fact · finding · constraint · todo · dead_end · note |
| `search` | 跨所有交接包和卡片全文检索（中英文） |

写入时自动识别来源 agent（安装器为每个 agent 设置 `LINGXI_AGENT`）。

## CLI

```bash
lingxi status
lingxi topic ls | new <name> | show <topic> | link <topic> <type> <target> | archive <topic>
lingxi handoff save -t "标题" --topic X [-f body.md | < stdin] [--ref ...] [--supersedes id]
lingxi handoff load [id] [--topic X] ;  lingxi handoff ls [--topic X]
lingxi remember decision "采用方案B" --topic X ;  lingxi recall [query] ;  lingxi forget <id>
lingxi search 关键词 [--topic X]
lingxi install|uninstall [claude-code codex pi cursor workbuddy doubao] [--dry-run]
```

## 用法示例

- 豆包里：「把刚才飞书需求对接的结论存到灵犀，topic 叫 导出需求」
- Codex 里：「加载灵犀里的 导出需求」→ 调用 `topic_get`
- pi 调研结束：「保存交接到 topic XX调研」；Codex 里：「把 XX调研 的结论拿过来，结合项目现状给出开发方案，并把决策记到灵犀」

## 开发

```bash
npm run build && npm test
```

目录：`src/core`（存储、检索、格式化）· `src/mcp`（MCP 服务）· `src/cli`（命令行）· `src/install`（安装器）· `skills/lingxi`（通用 Skill）。
