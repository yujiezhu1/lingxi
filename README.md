# 灵犀 Lingxi

> 让不同 agent、不同会话之间「心有灵犀」。
> Local-first context hub shared by all your AI agents — Claude Code, Codex, pi, Cursor, WorkBuddy, 豆包工作 …

在一个 agent 里沉淀的**交接包（handoff）**、**知识卡片（card）**、**工作线（topic）**，在任何其他 agent、任何会话里都能加载。
不用再复制粘贴、重新解释背景，也不用担心信息在转述中走样。

- 设计文档：[docs/DESIGN.md](docs/DESIGN.md)
- **当前阶段：P0.5**（中枢 + MCP stdio + CLI + Skill + 安装器 + 项目绑定 + 时间线）。会话记录导入、跨会话消息、后台咨询、活动汇总在 P1 及之后（见[路线图](#路线图)）。

---

## 目录

- [核心概念](#核心概念)
- [安装](#安装)
- [接入各个 agent](#接入各个-agent)
- [验证安装](#验证安装)
- [使用指南](#使用指南)
  - [基本说法](#基本说法)
  - [日常使用流程](#日常使用流程)
  - [场景一：豆包对接飞书 → CLI 开发](#场景一豆包对接飞书--cli-开发)
  - [场景二：pi 调研 ⇄ Codex 开发](#场景二pi-调研--codex-开发)
  - [场景三：一开始无关，后来才相关](#场景三一开始无关后来才相关)
  - [场景四：当作项目的背景、历程、进度记录](#场景四当作项目的背景历程进度记录)
  - [写好交接包](#写好交接包)
  - [知识卡片怎么用](#知识卡片怎么用)
  - [使用习惯建议](#使用习惯建议)
- [MCP 工具参考](#mcp-工具参考)
- [CLI 参考](#cli-参考)
- [数据与隐私](#数据与隐私)
- [常见问题与排错](#常见问题与排错)
- [更新日志](CHANGELOG.md)
- [卸载](#卸载)
- [路线图](#路线图)
- [开发](#开发)

---

## 核心概念

| 概念 | 是什么 | 例子 |
|---|---|---|
| **Topic（工作线）** | 一条工作线，把相关的交接包、卡片、会话、文件、链接归到一起，可以跨 agent；**可以绑定到项目目录**，当作项目的背景、决策和进度记录 | `导出需求`、`XX调研`、`灵犀开发` |
| **Handoff（交接包）** | 某个时刻的工作状态快照，写成「零上下文的人也能接手」的样子 | 豆包整理的需求结论；pi 的阶段性调研结论 |
| **Card（知识卡片）** | 一条独立、长期有效的知识 | `[decision] 导出使用 Playwright 渲染 PDF` |

卡片类型：`decision`（决策）· `fact`（事实）· `finding`（发现）· `constraint`（约束）· `todo`（待办）· `dead_end`（试过但失败的路线）· `note`（备注）。

所有 agent 读写的是**同一个本地数据库**（`~/.lingxi/`），所以在 A 里存的东西，在 B 里马上就能读到。

---

## 安装

要求：**Node.js ≥ 22.13**（使用 Node 内置的 `node:sqlite`，没有需要编译的依赖，Windows 上直接能装）。

```bash
git clone <repo> lingxi        # 或直接进入项目目录
cd lingxi
npm install
npm run build
npm link                       # 可选：全局提供 `lingxi` / `lx` 命令（推荐）
```

然后把灵犀接入各个 agent：

```bash
lingxi install --dry-run       # 先看会改哪些文件，不实际写入
lingxi install                 # 接入全部 agent（会先备份原配置）
lingxi install codex pi        # 也可以只接入指定的 agent
```

> 没有执行 `npm link` 的话，把 `lingxi` 换成 `node dist/cli/index.js`。

安装器为每个 agent 写入的启动命令都是**绝对路径**（当前 `node.exe` 加 `dist/cli/index.js mcp`），不依赖 PATH，
并通过环境变量 `LINGXI_AGENT` 标记来源，所以每条记录都能看出是哪个 agent 写的。

> ⚠️ 安装器写入的是 `dist/` 的绝对路径。**项目目录移动后**，需要重新执行 `npm run build && lingxi install`。

---

## 接入各个 agent

| Agent | MCP 注册位置 | Skill 位置 | 安装方式 |
|---|---|---|---|
| Claude Code | `claude mcp add-json --scope user`（写入 `~/.claude.json`） | `~/.claude/skills/lingxi` | 自动 |
| Codex | `~/.codex/config.toml` → `[mcp_servers.lingxi]` | `~/.agents/skills/lingxi` | 自动 |
| pi | `~/.pi/agent/mcp.json`（`exposure: direct`） | `~/.agents/skills/lingxi` | 自动 |
| Cursor | `~/.cursor/mcp.json` | `~/.agents/skills/lingxi` | 自动 |
| WorkBuddy | `~/.workbuddy/mcp.json` | `~/.workbuddy/skills/lingxi` | 自动（首次使用可能需要在应用内批准） |
| 豆包工作 | 应用内「自定义连接器」 | `~/DoubaoWork/skills/lingxi` | **MCP 需手动添加**，Skill 自动 |

`~/.agents/skills` 是 Codex、pi、Cursor 共用的 Skill 目录，只装一份。

### 豆包工作：手动添加连接器

`lingxi install doubao` 会打印出本机的具体配置值，按下表在 **豆包工作 → 自定义连接器（MCP）** 里添加：

| 项 | 值（示例，以安装器输出为准） |
|---|---|
| 类型 | stdio |
| 名称 | `lingxi` |
| 命令 | `D:\Software\nodejs\node.exe` |
| 参数 | `D:\...\lingxi\dist\cli\index.js` 和 `mcp`（两个参数） |
| 环境变量 | `LINGXI_AGENT=doubao` |

### 让配置生效

| Agent | 操作 |
|---|---|
| pi | 在会话里输入 `/reload`，或新开会话 |
| Claude Code / Codex / Cursor | 新开会话 |
| WorkBuddy / 豆包 | 新开对话；如果没有生效就重启应用 |

---

## 验证安装

```bash
lingxi status            # 看数据目录和数量
claude mcp get lingxi    # Claude Code：Status 应为 ✓ Connected
codex mcp list           # Codex：lingxi 显示 enabled
pi mcp list              # pi：lingxi: connected, 11 tools
```

**跨 agent 验收**（推荐跑一次）：

1. 在 agent A（比如 Codex）里说：
   > 用灵犀保存一个交接包，topic 叫「灵犀验收」，标题「A 写入测试」，下一步写「由 B 读取」。
2. 在 agent B（比如 pi 或豆包）里说：
   > 加载灵犀里的「灵犀验收」，告诉我最新交接包的标题、作者和下一步。
3. B 能说出「A 写入测试」，作者显示为 A，就说明打通了。验收完可以用 `lingxi topic archive 灵犀验收` 收起来。

---

## 使用指南

### 基本说法

用自然语言就可以，agent 会通过 Skill 和 MCP 工具说明自动选择合适的工具。说「灵犀」能让 agent 更准确地知道你要用它。

| 你想做的 | 可以这样说 | agent 会调用 |
|---|---|---|
| 看有哪些工作线 | 「灵犀里有哪些 topic？」 | `topic_list` |
| 接着做某件事 | 「加载灵犀里的 导出需求」「继续 XX调研 的工作」 | `topic_get` |
| 保存当前进度 | 「保存交接到灵犀，topic 叫 XX」「存到灵犀」 | `save_handoff` |
| 更新之前的交接 | 「更新 XX 的交接包，替换掉旧的」 | `save_handoff`（带 `supersedes`） |
| 记下一个决定 | 「把这个决定记到灵犀」「记一条约束：……」 | `remember` |
| 查之前的结论 | 「灵犀里关于 Playwright 的结论是什么？」 | `search` / `recall` |
| 把东西归到工作线 | 「把这个文件 / 这个链接 / 这个会话关联到 XX」 | `topic_link` |
| 把工作线绑定到当前项目 | 「把 XX 绑定到当前项目」 | `topic_link`（`target_type=project`） |
| 加载当前项目的背景 | 「加载这个项目在灵犀里的背景」「这个项目之前做到哪了？」 | `topic_list`（带 `project`）→ `topic_get` |
| 看开发历程、进度 | 「这个项目的开发历程」「XX 最近一周做了什么？」 | `topic_timeline` |
| 删掉错误的卡片 | 「这条卡片过时了，从灵犀里删掉」 | `forget` |

### 日常使用流程

只要养成三个习惯：

| 时机 | 说什么 |
|---|---|
| **开新会话、接着做某件事** | 「加载灵犀里的 XX」 / 「加载这个项目在灵犀里的背景」 |
| **切换工具前，或到一个阶段** | 「保存交接到灵犀，topic 叫 XX」 |
| **定了一件事、踩了一个坑** | 「把这个记到灵犀」 |

一天的典型用法：

| 时段 | 在哪 | 做什么 |
|---|---|---|
| 开工 | 任意 agent / 终端 | 「灵犀里有哪些 topic？」→「加载 XX」；或 `lingxi topic ls`、`lingxi topic ls -p` |
| 处理飞书相关的事 | 豆包 | 对齐完需求：「把对接结论存到灵犀，topic 叫 XX需求，包括要点、飞书链接、相关人和截止时间」 |
| 开发 | Codex / Claude Code / Cursor | 开始：「加载 XX」；定下方案：「记到灵犀」；收工或换工具：「保存交接」，记得写上**未提交的改动和做到一半的地方** |
| 调研 | pi | 告一段落：「保存调研结论到灵犀」；开发那边需要时说「加载 XX调研，结合项目现状给方案」 |
| 写日报 | 豆包 / WorkBuddy | 「看一下灵犀里今天的时间线，帮我写日报」，或 `lingxi timeline --since 1d` |

什么值得存：

| 值得存 | 不用存 |
|---|---|
| 要换工具、换会话继续的工作 | 一次性的小问题、简单问答 |
| 花了较长时间得出的结论 | 当前会话里马上用完的中间结果 |
| 做出的决定、确认的约束、试过但失败的方案 | 还没确认、随时会变的猜测 |
| — | 密钥、token、密码（**绝对不要存**） |

每周花一分钟维护：

```bash
lingxi topic ls                   # 看一眼有哪些工作线
lingxi topic archive <已完成的>    # 做完的收起来
lingxi recall --kind todo         # 还有哪些跨会话的待办
```

### 场景一：豆包对接飞书 → CLI 开发

豆包能直接访问飞书，但模型能力不一定够写代码；CLI 擅长开发，却看不到豆包里的对接内容。

**在豆包里**（读完飞书文档、群聊之后）：

> 把刚才对接的需求结论存到灵犀，topic 叫「导出需求」。包括需求要点、飞书文档链接、相关人、截止时间，以及原文里的关键约束。

**在 Codex / Claude Code / pi 里**：

> 加载灵犀里的「导出需求」，按里面的结论开始实现。有疑问先列出来。

开发中形成的决策，可以顺手记下来：

> 把「导出使用 Playwright 渲染 PDF，只支持 A4 竖版」记成灵犀里「导出需求」的决策。

> 💡 如果想让 CLI 自己直接读写飞书、少切几次工具，可以另外装飞书官方的 `lark-cli`（`npx @larksuite/cli@latest install`），详见设计文档 §12.7。

### 场景二：pi 调研 ⇄ Codex 开发

**pi（调研会话）**，告一段落时：

> 把目前的调研结论保存到灵犀，topic 叫「XX调研」。写清楚已确认的结论、各方案的对比、还没解决的问题和资料来源。

**Codex（开发会话）**，需要用到调研结果时：

> 加载灵犀里的「XX调研」，结合当前项目的实际情况（技术栈、已有代码）分析哪个方案最合适，给出开发方案。确定的决策记到灵犀。

**开发发现情况有变、需要调整调研方向时**，在 Codex 里：

> 在灵犀「XX调研」里记一条约束：项目实际使用 FastAPI，不能引入 Django。再记一条待办：评估方案 B 在 FastAPI 下的可行性。

然后回到 pi：

> 看一下灵犀「XX调研」最近新增的约束和待办，调整调研方向。

> ⏳ P0 里两边需要你**说一句**才会去读灵犀。P1 会加入跨会话消息：Codex 可以直接给 pi 的调研会话发消息，pi 会实时收到。

### 场景三：一开始无关，后来才相关

两件原本无关的事情后来有了关联，可以随时把它们归到同一条工作线：

> 把交接包 ho_20261023_xxxx 关联到「导出需求」。
> 把 `D:\proj\docs\export-spec.md` 和这个飞书链接关联到「导出需求」。

`topic_link` 支持的类型：`project`（项目目录）· `session`（会话，如 `codex:<会话ID>`）· `handoff` · `card` · `path`（文件路径）· `url` · `topic`。

> ⏳ P1 会自动导入 Claude Code、Codex、pi 的会话记录。到时候不用提前保存，也能搜到以前会话里的原文。

### 场景四：当作项目的背景、历程、进度记录

给项目建一个 topic 并绑定项目目录，它就成了这个项目的「动态记忆」：让 agent 不必每次重新翻代码熟悉背景，也能看到项目是怎么一步步走过来的。

**建立（一次）**

```bash
cd D:\proj\my-app
lingxi topic new my-app -d "my-app 的背景、决策与进度" -p     # -p 不带值 = 绑定当前目录
# 已有的 topic：lingxi topic bind <topic> [路径]
```

也可以在 agent 里说：「在灵犀建一个 topic 叫 my-app，绑定到当前项目。」

**日常**

| 时机 | 说法 |
|---|---|
| 开新会话 | 「加载这个项目在灵犀里的背景」：agent 用当前目录找到绑定的 topic，再读取最新现状 |
| 有阶段性进展 | 「更新项目现状的交接包，替换掉旧的」 |
| 做出决定 / 踩坑 | 「把这个决定记到灵犀」「记一条 dead_end：……」 |
| 回顾 | 「这个项目的开发历程」「最近一周做了什么」，或 `lingxi timeline --since 7d` |

**和 CLAUDE.md / AGENTS.md 的分工**

| | CLAUDE.md / AGENTS.md | 灵犀 topic |
|---|---|---|
| 适合放 | 稳定的事实：架构、目录、命令、规范 | 会变化的：现状、决策及原因、踩过的坑、待办、历程 |
| 加载 | 每次会话自动加载 | 说一句「加载项目背景」 |
| 历史 | 只有当前版本 | 有时间线，能看到演进过程 |
| 跨 agent | 各家读取的文件不同 | 所有 agent 共用一份 |

> 💡 记「**为什么**」和「**做到哪了**」，不要记「代码长什么样」：代码才是最准确的，而且变得比笔记快。
> 目前**不会**自动往 CLAUDE.md / AGENTS.md 写任何内容，也不会自动注入；如需要，可以自己在里面加一句「本项目在灵犀的 topic 是 my-app」。

**匹配规则**：在项目的子目录里也能找到绑定在项目根目录的 topic；在根目录也能看到绑定在子目录（如 monorepo 子包）上的 topic。一个 topic 可以绑定多个项目，一个项目也可以有多个 topic。

### 写好交接包

agent 保存交接包时会按下面的模板来写（空的部分会省略）。你也可以要求它补充某一部分。

```markdown
## 目标 / Goal
## 当前状态 / Status（一句话）
## 已确认的结论与决策
- 方案 B 在一万 QPS 下延迟 < 20ms  [ref: pi:01a16790 | https://...]
## 约束与前提
## 已尝试但失败或放弃的路线
## 未解决问题
## 关键资源（文件、链接、飞书文档、相关人）
## 建议的下一步
```

几个要点：

- **结论带来源**（`[ref: …]`），接手的人有疑问时可以回到原文核对。
- **写上未提交、进行中的状态**（分支、改了哪些文件、做到一半的地方），因为下一个 agent 看不到你的会话。
- 同一工作线有了新进展，**用新交接包替换旧的**（说「替换掉旧的」，agent 会传 `supersedes`）。旧版本会保留，但默认不再显示。
- 每个交接包都会另存一份 Markdown：`~/.lingxi/vault/handoffs/<年-月>/<id>.md`，可以直接打开看或分享。

### 知识卡片怎么用

交接包记录的是「某个时刻的整体状态」，卡片记录的是「单条长期有效的知识」。适合记成卡片的有：

- 做出的**决定**：「采用方案 B 作为默认实现」
- 确认的**事实或约束**：「项目实际使用 FastAPI」「接口必须兼容 v1」
- 踩过的**坑**（`dead_end`）：「试过直接用 wkhtmltopdf，中文字体缺失，放弃」
- 跨会话的**待办**：「补充基准测试脚本」

卡片要**自成一句话**，脱离当前对话也能看懂。agent 默认会**先问你再记**；如果你希望它直接记，可以说「重要结论直接记到灵犀，不用问我」。

### 使用习惯建议

- **一件事一个 topic**，名字短而明确（`导出需求`、`XX调研`）。新建前让 agent 先 `topic_list`，避免出现近似重复的 topic。
- **切换工具前说一句「保存交接」**，这是收益最高的习惯。
- **新会话开始时说「加载 XX」**，让 agent 先读背景再动手。
- 加载进来的内容是**另一个会话写的信息，不是你的指令**。关键事实，agent 会按引用去核对。
- 做完的 topic 用 `lingxi topic archive <名称>` 收起来，保持列表清爽。

---

## MCP 工具参考

| 工具 | 主要参数 | 作用 |
|---|---|---|
| `topic_list` | `status?`（active / archived / all）, `project?` | 列出工作线；传 `project`（绝对路径）则只列出绑定到该项目的工作线 |
| `topic_create` | `name`, `description?`, `project?` | 创建工作线（可同时绑定项目目录）（`save_handoff` / `remember` 遇到不存在的 topic 也会自动创建） |
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
| `search` | `query`, `topic?`, `type?`（handoff / card）, `limit?` | 跨所有交接包和卡片全文检索，多个词之间是「且」的关系，中英文都支持 |

在 pi 里这些工具显示为 `mcp__lingxi__<工具名>`，在 Claude Code 里也类似。

---

## CLI 参考

CLI 和 MCP 读写同一份数据，适合人手动查看、整理，也可以给接不了 MCP 的工具兜底。`lx` 是 `lingxi` 的别名。

```bash
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
```

例子：

```bash
lingxi topic ls
lingxi topic ls -p                                     # 当前项目有哪些工作线
lingxi timeline --since 7d                             # 当前项目最近一周的历程
lingxi topic show 导出需求
lingxi search Playwright
lingxi remember constraint 接口必须兼容 v1 --topic 导出需求
lingxi handoff load --topic XX调研 > research.md       # 导出成文件，可以贴给任何工具
```

---

## 数据与隐私

| 内容 | 位置 |
|---|---|
| 数据库 | `~/.lingxi/lingxi.db`（SQLite，WAL 模式，多个 agent 同时读写是安全的） |
| 交接包 Markdown | `~/.lingxi/vault/handoffs/<年-月>/<id>.md` |
| 换个位置 | 设置环境变量 `LINGXI_HOME`（执行安装前设置，安装器会把它写进各 agent 的配置） |
| 备份 | 复制 `~/.lingxi/` 整个目录即可 |

- **纯本地**：P0 不联网，不调用任何外部模型；所有内容都由你正在用的 agent 自己写入。
- 安装器修改配置前会备份为 `<原文件>.lingxi-bak-<时间>`。
- **不要往灵犀里存密钥、token、密码**（Skill 也会提醒 agent 不要这样做）。

---

## 常见问题与排错

**agent 里看不到灵犀的工具**
- 先确认已新开会话（pi 可以用 `/reload`）。
- 用 `claude mcp get lingxi`、`codex mcp list`、`pi mcp list` 检查连接状态。
- 项目目录移动过或重新 build 过路径的话，重新执行 `lingxi install`。

**agent 没有主动用灵犀**
- 在话里带上「灵犀」两个字，例如「加载灵犀里的 XX」。
- pi 可以用 `/skill:lingxi` 强制加载使用说明。

**WorkBuddy 里没有 lingxi**
- 检查 `~/.workbuddy/mcp.json` 里有没有 `lingxi`。在应用的 MCP 列表里批准它，或重启 WorkBuddy。

**豆包里调用失败**
- 检查命令和参数是否和 `lingxi install doubao` 的输出**完全一致**：参数要分成两项，路径不要加引号。

**Codex 每次提问都出现 `Hook failed / hook exited with code 1`**
- 这和灵犀无关，原因是 `~/.codex/hooks.json` 里放了给 Cursor 用的钩子（`cursor-hook.js` 加 `cmd /d /s /c` 写法），而 Codex 在 Windows 上用 PowerShell 运行钩子命令，引号被解析乱了。
- 不用 Clawd 桌宠的话，删掉 `~/.codex/hooks.json`。
- 要用的话，执行 `node "<Clawd 安装目录>/resources/app.asar.unpacked/hooks/codex-install.js"` 重新生成，再在 Codex 里运行 `/hooks` 批准。

**Codex 报 `Error loading config.toml: url is not supported for stdio in mcp_servers.exa`**
- 这和灵犀无关：项目级 `.codex/config.toml` 和用户级配置里的同名 MCP（例如 exa）一个是命令方式、一个是 URL 方式，冲突了。删掉其中一份即可。

**这和「让 agent 总结一下、再贴给另一个 agent」有什么区别？**
- 核心动作确实类似，总结写得好不好仍然取决于写的那个 agent。
- 区别在于：不用你来回复制粘贴；内容**持久保存**、可以搜索；多个会话往同一个 topic 里**累积**、多个 agent 都能读；有统一模板、来源引用、作者和时间；新版本替换旧版本，历史保留；桌面端也能直接读写。
- 手动方式做不到的能力在 P1：自动导入会话原文、向原会话后台提问、跨会话实时消息、活动汇总（见[路线图](#路线图)）。

**搜索搜不到**
- 多个关键词之间是「且」的关系，减少关键词试试。
- P0 只搜交接包和卡片，**还不搜会话原文**（P1 支持）。

---

## 卸载

```bash
lingxi uninstall --dry-run     # 先看会删掉什么
lingxi uninstall               # 从全部 agent 移除 MCP 配置和 Skill
lingxi uninstall cursor        # 只移除某一个
```

豆包的连接器需要在应用里手动删除。数据目录 `~/.lingxi/` 不会被删除，需要的话手动删除。
不再需要全局命令的话，在项目目录执行 `npm unlink -g lingxi-hub`。

---

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 中枢 | 交接包、工作线、知识卡片、全文检索、MCP stdio、CLI、Skill、安装器 | ✅ |
| P0.5 项目记忆 | 工作线绑定项目目录、时间线（不自动写入或注入 CLAUDE.md / AGENTS.md） | ✅ |
| P1 CLI 之间互通 | 导入 Claude Code、Codex、pi 的会话记录并支持跨会话搜索原文；pi 扩展（在线登记、实时消息）；Claude Code 和 Codex 的钩子；后台咨询（复制一份会话在后台回答问题）；活动汇总 `get_activity`（写日报时能看到各 agent 的进行中工作和未提交改动） | 计划中 |
| P1.5 办公端写入 | 豆包、WorkBuddy 深度接入；对接飞书 `lark-cli` | 部分完成（MCP 已可用） |
| P2 办公端之间互通 | WorkBuddy、Cursor 会话导入；在线检测；中文检索增强 | 计划中 |
| P3 全面互通 | 后台服务（HTTP MCP、消息投递）；本地网页界面 | 计划中 |
| P4 扩展 | Meta Muse 等远程 agent、多设备同步、团队共享 | 计划中 |

---

## 开发

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest：存储、安装器、MCP 端到端测试
```

| 目录 | 内容 |
|---|---|
| `src/core` | 存储（node:sqlite + FTS5 trigram）、迁移、检索、格式化 |
| `src/mcp` | MCP 服务（stdio） |
| `src/cli` | `lingxi` 命令 |
| `src/install` | 各 agent 的 MCP 和 Skill 安装器 |
| `skills/lingxi` | 通用 Skill（教 agent 何时、如何使用灵犀） |
| `test` | 单元测试与端到端测试 |
| `docs/DESIGN.md` | 设计文档 |
