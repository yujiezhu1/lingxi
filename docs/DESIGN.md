# 灵犀 Lingxi 设计文档（v0.1 草案）

> 项目名 **灵犀 Lingxi**（暂定，取「心有灵犀一点通」：让不同 agent、不同会话之间心意相通）。本文中的 `lingxi` 同时用作代码里的标识；对外发布的 npm 包名、命令名待定，见 §19。本文档是开发参考，开发过程中按实际情况迭代。
> 最后更新：2026-10-23（项目名改为灵犀 Lingxi；豆包支持 stdio 和 HTTP 两种接入）

---

## 0. 一句话

**一个本地优先、与厂商无关的「上下文中枢」**：自动收录各个 agent 的会话，按需提炼成可溯源的交接包，并让不同厂商、不同会话之间可以互相检索、交接和对话。

---

## 1. 背景与问题

日常同时使用多个 agent：

- **开发类（CLI / IDE）**：Claude Code、Codex、pi、Cursor
- **办公类（桌面端）**：豆包工作、WorkBuddy（飞书文档、聊天记录、工作记录）

痛点：

1. **会话孤岛**：同一工具的不同会话之间、不同厂商之间都无法共享上下文。
2. **迁移成本高**：花很长时间积累的上下文，只能靠人工转述，容易对不齐、有偏差、有遗漏。
3. **相关性是后来才出现的**：任务一开始互不相关，推进中才产生关联，没法提前规划共享。
4. **能力和入口错位**：豆包能访问飞书，但模型能力不够；CLI 模型能力强，但访问不了飞书。结果是频繁切换工具。
5. **工作记录不完整**：没提交 git 的进行中工作，在办公端写日报时看不到。

## 2. 目标与非目标

### 目标

| # | 目标 | 对应痛点 |
|---|---|---|
| G1 | **检索**：跨 agent、跨会话搜索并引用历史内容 | 1、3 |
| G2 | **交接**：把会话状态提炼成可溯源的交接包，在任意 agent 中加载 | 2 |
| G3 | **互动**：在线会话之间互发消息；向历史会话后台提问（Consult） | 1、2 |
| G4 | **关联**：事后把多个会话归入同一条工作线（Topic） | 3 |
| G5 | **活动汇总**：按日期、项目汇总所有 agent 的活动和未提交改动 | 5 |
| G6 | 可移植、可复用、易扩展（适配器插件化），可以开源或产品化 | — |

### 非目标（v1 不做）

- 不替代各 agent 自身的记忆功能，不修改各 agent 的原始会话文件（只读）。
- 不做多设备同步、团队共享（留到 P4）。
- 不追求把完整会话原样搬到另一个 agent（既做不到也不划算），只迁移**提炼后的状态加原文引用**。

## 3. 用户场景

### 场景 1：豆包工作（飞书）→ CLI（开发）

在豆包里读飞书文档和群聊、对齐需求，然后到 Codex 或 Claude Code 里开发。

- **期望**：在 CLI 里一句「加载豆包里刚对接的 XX 需求」，就能拿到需求要点、文档链接、相关人、截止时间和原文摘录。
- **补充路线**：给 CLI 直接接入飞书官方的 `lark-cli`（见 §12.7），减少切换。

### 场景 2：pi 调研会话 ⇄ Codex 开发会话（双向）

| 子场景 | 例子 | lingxi 能力 |
|---|---|---|
| 2a 调研结果流向开发 | Codex 需要 pi 的调研结论 | Topic + 交接包 |
| 2b 开发反向影响调研 | Codex 发现项目实际用的是 X，调研要换方向 | 消息（pi 侧实时插入） |
| 2c 针对性提问 | Codex 想问「调研里方案 B 的性能结论」 | 后台咨询（复制 pi 会话来回答） |
| 2d 综合决策 | 结合项目实际和调研结果定开发方案 | 加载 Topic → 生成方案 → 存成决策卡片 |

### 场景 3：办公端写日报，需要 CLI 进行中的工作

在豆包或 WorkBuddy 里写工作记录时，调用 lingxi 的 `get_activity(date)`，拿到当天所有 agent 的会话摘要和每个项目的未提交改动（`git status` / `diff --stat`），进行中的项目不再漏记。

### 场景 4：一开始无关、后来才相关

上周在 Claude Code 里排查过的某个问题，这周在 Cursor 里又遇到了。

- 由于原始会话一直在**全自动收录**，可以直接 `search` 找到原会话，再把它 `link` 到当前 Topic。

## 4. 本机环境调研结论（2026-10-23，Windows）

| Agent | 会话记录位置（已核实） | 格式 | MCP | Skill | 钩子 / 扩展 | 后台咨询（无交互运行并复制会话） |
|---|---|---|---|---|---|---|
| Claude Code 2.1.158 | `~/.claude/projects/<编码后的路径>/<id>.jsonl` | JSONL | ✅ | ✅ | ✅ hooks | ✅ `claude -p --resume <id> --fork-session` |
| Codex 0.153（含 Codex Desktop） | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，首行 `session_meta` 含 `cwd` | JSONL | ✅ | ✅ | ✅ hooks（`~/.codex/hooks.json`：session_start、user_prompt_submit、pre_compact、post_tool_use、stop 等，本机已在用） | ✅ `codex exec fork <id> "<prompt>"` |
| pi | `~/.pi/agent/sessions/--<路径>--/<时间>_<id>.jsonl`，首行 `type:session` 含 `cwd`，有 `session_info.name` | JSONL（树结构，带 parentId） | ✅（扩展） | ✅ | ✅ 扩展（TypeScript） | ✅ `pi -p --fork <id> [--no-session]` |
| Cursor | `~/.cursor/projects/<路径>/agent-transcripts/`；另有 `Cursor/User/globalStorage/state.vscdb`（SQLite） | 文本 / SQLite | ✅ | ✅ | ✅ `~/.cursor/hooks.json` | ⚠️ 需要安装 Cursor CLI（本机未装） |
| WorkBuddy | `~/.workbuddy/projects/<路径>/<id>.jsonl`（类似 Claude Code 的格式）；`workbuddy.db` 的 `sessions` 表（标题、cwd、时间）；`~/.workbuddy/sessions/<pid>.json`（**在线心跳**） | JSONL + SQLite | ✅ `connectors/default/mcp.json` | ✅ | ❓ | ❌ |
| 豆包工作 | **智能体模式的对话是明文 JSONL**：`AppData/Local/DoubaoWork/User Data/Profile 1/.doubaowork/agent_mode/workspace/.sessions/<会话ID>/agents/<agentID>/system/trajectory.jsonl`（OpenAI 消息格式：role / content / tool_calls，无逐条时间戳）；同目录 `assignment.md` 按时间戳记录每轮用户需求；会话标题在 IndexedDB 的会话列表里（V8 序列化）。IndexedDB 里加密的（CryptoJS AES）是部分配置，例如连接器配置。`~/DoubaoWork/chats/<日期>/<会话>/` 只是工作目录 | JSONL | ✅ 自定义连接器，支持 stdio 和 HTTP（已确认） | ✅ `~/DoubaoWork/skills/` | ❌ | ❌ |

**结论**

1. **6 个工具都支持 MCP 和 Skill**，可以作为统一的接入方式。
2. **会话记录能导入的有 5 个**。豆包没法导入，只能靠它通过 MCP **主动写入**。
3. **能后台咨询的有 3 个**（Claude Code、Codex、pi），Cursor 安装 CLI 后可能支持。
4. Claude Code 升级到 ≥ 2.1.234 后，有原生的跨会话消息功能（`ListAgents` / `SendMessage`），可以直接复用。

## 5. 同类工具与定位

| 类别 | 代表 | 不足 |
|---|---|---|
| 跨 agent 会话检索 | cass、sesh、harness-recall、Agent Sessions、CodeSesh、Wake、ah | 只读检索，没有提炼、交接和互动；不支持国内 agent |
| 共享记忆 / 交接 MCP | Handover、shared-agent-memory、Passoff、trevhud/handoff、Stitch、Anchor、StremAI | 依赖 agent 主动写入，没写的就没有；记忆和原始会话脱节，无法溯源 |
| 厂商内部互动 | Claude Code 跨会话消息、Agent teams | 只限单一厂商 |

**lingxi 的差异化**

1. 检索、交接、互动三件事合在一个工具里；
2. 交接内容**可追溯到原文**；
3. **后台咨询**：向历史会话的完整上下文提问，而不是只看摘要；
4. 支持**国内桌面 agent**（WorkBuddy、豆包、CodeBuddy 等），覆盖办公场景；
5. 用 **Topic** 事后关联会话；
6. 提供**活动汇总**，服务工作记录、日报。

## 6. 总体架构

```
 Claude Code   Codex   pi   Cursor   WorkBuddy   豆包工作   (未来: Meta Muse …)
      │          │      │      │         │          │
      ├─ MCP（stdio 或本地 HTTP）── Skill（教 agent 何时用）── 钩子/扩展（推送）
      │
┌─────────────────────────── lingxi 核心 ───────────────────────────┐
│  适配器层  每个 agent 一个插件，声明自己支持的能力：                  │
│            导入记录 / 推送消息 / 后台咨询 / 在线检测                  │
│  ① 采集    监听文件变化、增量解析 → 统一格式 → 写入存储               │
│  ② 提炼    交接包、知识卡片、会话摘要（带来源引用）                    │
│  ③ 关联    Topic、会话关系（引用、派生、咨询）                         │
│  ④ 消息    在线登记、收件箱、投递、后台咨询                           │
│  ⑤ 活动    按日期、项目汇总会话和 git 状态                            │
│  存储      SQLite（WAL + FTS5 全文索引，可选 sqlite-vec 向量检索）     │
│            + ~/.lingxi/vault/*.md（交接包、卡片的 Markdown 原文）       │
└──────────────────────────────────────────────────────────────────┘
      │
  lingxi CLI（给人和 agent 用）   本地网页界面（P3：浏览、关联、导出到剪贴板）
```

**进程模型**

- `lingxi daemon`：常驻后台，负责监听文件、导入记录、提供 HTTP 方式的 MCP 服务（`127.0.0.1:<port>`，带 token 认证）、投递消息。
- `lingxi mcp`：stdio 方式的 MCP 服务，由各 agent 启动，**直接以 WAL 模式读写同一个 SQLite**。daemon 不在运行时也能用（降级为不实时监听）。
- `lingxi <cmd>`：命令行工具，和 MCP 共用同一套核心库。
- **接入方式**：豆包工作的自定义连接器同时支持 HTTP 和 stdio（已确认），WorkBuddy 的 `mcp.json` 也是标准格式。所以 **P0 所有工具统一用 stdio 接入**（`lingxi mcp`），不依赖 daemon 常驻；HTTP 方式随 daemon 在 P3 提供，用于实时推送、网页界面和以后的远程 agent。

## 7. 核心概念与数据模型

### 7.1 概念

| 概念 | 说明 |
|---|---|
| **Session** | 某个 agent 的一个会话，从原始记录导入，或在线登记 |
| **Turn** | 会话里的一条消息（用户、助手、工具调用），统一格式，带原文定位 |
| **Topic** | 工作线，可以包含多个跨 agent 的会话；可以事后关联 |
| **Handoff（交接包）** | 某个时刻对会话或 Topic 状态的结构化快照，每一条都带来源引用 |
| **Card（知识卡片）** | 原子化的知识：决策、事实、发现、约束、待办、失败尝试 |
| **Message** | 会话之间的消息，在线会话收件箱里的一条记录 |
| **Presence** | 在线会话登记：谁、在哪个目录、在做什么、最后活跃时间 |
| **Ref（引用）** | 统一的引用格式：`agent:sessionId#turnId[..turnId]`，例如 `pi:01a16790#m42..m48` |

### 7.2 SQLite 表结构草案

```sql
-- 会话
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- '<agent>:<nativeId>'
  agent TEXT NOT NULL,            -- claude-code | codex | pi | cursor | workbuddy | doubao | ...
  native_id TEXT NOT NULL,
  title TEXT, cwd TEXT, project_root TEXT,   -- project_root = cwd 对应的 git 根目录
  source_path TEXT,               -- 原始记录文件路径
  source_offset INTEGER,          -- 增量导入的进度
  started_at INTEGER, updated_at INTEGER,
  summary TEXT, summary_hash TEXT, -- 懒生成并缓存的会话摘要
  is_consult_fork INTEGER DEFAULT 0, -- 后台咨询产生的临时会话，默认不参与检索
  meta JSON
);

-- 消息
CREATE TABLE turns (
  id TEXT PRIMARY KEY,            -- '<sessionId>#<nativeTurnId>'
  session_id TEXT, seq INTEGER, parent_id TEXT,
  role TEXT,                      -- user | assistant | tool_call | tool_result | system
  ts INTEGER, text TEXT,          -- 规范化后的文本（工具输出截断）
  tool_name TEXT, files JSON      -- 涉及的文件
);
CREATE VIRTUAL TABLE turns_fts USING fts5(text, content='turns', content_rowid='rowid', tokenize='trigram');
-- 中文检索：trigram 分词，或者 P2 引入 jieba 预分词 / 向量检索

-- Topic
CREATE TABLE topics (id TEXT PRIMARY KEY, name TEXT UNIQUE, description TEXT, status TEXT, created_at INTEGER);
CREATE TABLE topic_links (topic_id TEXT, target_type TEXT, target_id TEXT, note TEXT, created_at INTEGER);
  -- target_type: project | session | handoff | card | path | url | topic
  -- project：项目目录（规范化的绝对路径），按「相同 / 祖先 / 子目录」匹配

-- 交接包与卡片（正文同时落盘为 vault/*.md）
CREATE TABLE handoffs (id TEXT PRIMARY KEY, topic_id TEXT, session_id TEXT, author_agent TEXT,
  title TEXT, body_md TEXT, created_at INTEGER, supersedes TEXT);
CREATE TABLE cards (id TEXT PRIMARY KEY, topic_id TEXT, kind TEXT, -- decision|fact|finding|constraint|todo|dead_end
  content TEXT, refs JSON, status TEXT, author_agent TEXT, created_at INTEGER);

-- 在线登记与消息
CREATE TABLE presence (session_id TEXT PRIMARY KEY, agent TEXT, cwd TEXT, label TEXT,
  activity TEXT, pid INTEGER, last_seen INTEGER, channel JSON);  -- channel: 消息投递方式
CREATE TABLE messages (id TEXT PRIMARY KEY, from_session TEXT, to_session TEXT, topic_id TEXT,
  kind TEXT,  -- note | question | answer | request | notify
  body TEXT, refs JSON, status TEXT,  -- queued | delivered | read | expired
  created_at INTEGER, delivered_at INTEGER, reply_to TEXT);
```

### 7.3 交接包格式（Markdown + frontmatter）

```markdown
---
id: ho_20261023_xxxx
topic: XX课题
source: pi:01a16790          # 来源会话
author_agent: pi
created_at: 2026-10-23T15:30:00+08:00
supersedes: ho_20261020_yyyy # 可选，替代旧的交接包
---
## 目标
## 当前状态（一句话）
## 已确认的结论与决策
- 方案 B 在 10k QPS 下延迟 < 20ms  [ref: pi:01a16790#m42..m48]
## 约束与前提
## 已尝试但失败 / 放弃的路线
## 未解决问题
## 关键资源（文件 / 链接 / 飞书文档 / 人）
## 建议的下一步
```

原则：**每条结论尽量带 `[ref:…]`**。接收方有疑问时，可以 `read_session(ref)` 回到原文核对。

## 8. 采集层：适配器

### 8.1 插件接口（TypeScript）

```ts
interface AgentAdapter {
  id: string;                                   // 'claude-code' | 'codex' | ...
  capabilities: { ingest?: boolean; push?: boolean; consult?: boolean; presence?: boolean };
  discover?(): Promise<SourceLocation[]>;       // 找到会话记录存放位置
  watchGlobs?(): string[];                      // 需要监听的文件
  parse?(file: string, fromOffset: number): AsyncIterable<SessionMeta | Turn>; // 增量解析
  detectPresence?(): Promise<PresenceInfo[]>;   // 心跳、pid 存活、文件修改时间
  push?(target: PresenceInfo, msg: Message): Promise<'delivered' | 'queued'>;
  consult?(sessionNativeId: string, question: string, opts: ConsultOpts): Promise<ConsultResult>;
  installHints?(): IntegrationGuide;            // 自动安装 MCP、Skill、钩子的方法
}
```

### 8.2 各家适配要点

| 适配器 | 解析要点 | 在线检测 |
|---|---|---|
| claude-code | 按行读 JSONL；`message.content` 里的 text、tool_use、tool_result；按 `cwd` 归属项目 | 记录文件修改时间 + 钩子登记；升级后可读 `CLAUDE_CODE_MESSAGING_SOCKET` |
| codex | 首行 `session_meta.payload` 取 id、cwd、来源；后续读 `response_item` 等事件 | 记录文件修改时间 |
| pi | 消息有 `id/parentId` 构成的树，**只取当前分支**（从叶子回溯到根）；`session_info.name` 作为标题 | 扩展主动登记（最准确） |
| cursor | 优先读 `~/.cursor/projects/*/agent-transcripts`；必要时读 `state.vscdb`，可参考 cass 的解析方式 | 记录文件修改时间 / hooks |
| workbuddy | `projects/*/<id>.jsonl`（类似 Claude Code）+ `workbuddy.db.sessions` 取标题 | `~/.workbuddy/sessions/<pid>.json` 的心跳和 pid |
| doubao | 读 `.doubaowork/agent_mode/workspace/.sessions/*/agents/*/system/trajectory.jsonl`（只取 Role: main 的 agent）；用户消息的时间从 `assignment.md` 对齐，其余消息沿用前一条用户消息的时间；过滤 `<system-reminder>` 等注入内容；标题取第一条需求 | `trajectory.jsonl` 修改时间 |

通用处理：

- 工具输出截断（例如 2KB），保留文件路径；
- **敏感信息脱敏**（key、token 等的正则匹配）；
- 后台咨询产生的临时会话打上 `is_consult_fork` 标记，默认不参与检索；
- 记录文件格式变化时只告警、跳过，不中断。

## 9. 提炼层

### 9.1 谁来提炼

| 场景 | 由谁提炼 | 理由 |
|---|---|---|
| **在线会话保存交接包** | **会话自己的 agent**（通过 MCP `save_handoff`，正文由它写） | 它掌握完整上下文，lingxi 不用另外配置模型，效果最好 |
| 已结束的历史会话，需要交接包 | lingxi 调用后台咨询：复制原会话，让它自己总结 | 同样是用完整上下文总结 |
| 无法后台运行的会话（豆包等） | 用 lingxi 配置的模型 API（OpenAI 兼容）读记录总结 | 兜底方案 |
| 会话摘要（检索列表、活动汇总用） | lingxi 用低成本模型**懒生成**，按内容哈希缓存 | 唯一默认开启的自动提炼，可以关闭 |

### 9.2 触发方式：分层的「半自动」

| 层 | 默认方式 |
|---|---|
| 原始记录导入、建索引 | 全自动 |
| 会话摘要 | 用到时懒生成（检索、活动汇总时） |
| 交接包 | 半自动：会话结束、或上下文压缩前，钩子**提示**一次；用户随时可以说「保存交接」 |
| 知识卡片 | agent 遇到重要结论时**提议**写入，用户确认（可以配置成自动） |

### 9.3 检索时的读取顺序（控制上下文长度）

`Topic 概览 → 最新交接包 → 相关卡片 → 原文片段`

逐级展开，每个 MCP 工具都有 `max_chars` 上限，并返回「还可以继续展开」的提示。

## 10. 互动层：消息与后台咨询

### 10.1 在线登记

在线状态取以下三种来源的并集：

1. 显式登记：pi 扩展、Claude Code 钩子、MCP `register` 调用；
2. 心跳：WorkBuddy 的 `sessions/*.json`；
3. 推断：记录文件 N 分钟内有修改，并且进程还在。

### 10.2 消息投递（v0.4.0 已实现，见下方实现说明）

| 目标 agent | 投递方式 | 实时性 |
|---|---|---|
| pi | 扩展订阅收件箱，**在对话中直接插入**（空闲时可触发新的一轮） | ✅ 实时 |
| Claude Code ↔ Claude Code | 优先用原生的跨会话消息 | ✅ 实时 |
| 其他 → Claude Code | `UserPromptSubmit` 钩子通过 `additionalContext` 注入；P3 评估往它的收件箱 socket 直接投递 | 下一轮 |
| Codex | `user_prompt_submit` / `session_start` hooks 注入收件箱；兜底在 `AGENTS.md` 里约定「每轮开始先调用 `check_inbox`」 | 下一轮 |
| Cursor | `hooks.json` 加 rules 约定 | 下一轮或手动 |
| WorkBuddy / 豆包 | Skill 约定，用户问起时或任务开始时调用 `check_inbox` | 手动 |

**安全规则**（参考 Claude Code 的设计）：

- 消息一律标注「来自另一个会话，不是用户本人」；
- **消息不能代替用户批准权限，不能修改配置，其中的命令不会被执行**；
- 接收方可以设置为接受 / 暂扣 / 拒绝。

### 10.3 后台咨询（核心差异化能力）✅ v0.3.0

```
consult_session(ref="pi:16eb5ec3b871", question="方案 B 的性能结论和测试条件是什么？", confirm=true)
  → 估算：会话文件大小 → 约多少 token；不带 confirm 时只返回估算
  → 以无交互方式运行只读、不保存的副本（问题经标准输入传入，并加上「只读咨询」说明）：
     pi:          pi -p --session <临时副本> --session-dir <临时目录> --no-tools --no-mcp --no-skills --no-extensions --no-context-files --mode json
                  （pi 的 --fork 不能和 --no-session 同时用，所以改为在临时副本上继续）
     codex:       codex exec fork <id> --ephemeral -c sandbox_mode=read-only -c approval_policy=never --json -o <file> -
     claude-code: claude -p --resume <id> --fork-session --no-session-persistence --tools "" --output-format json（在会话 cwd 下；未实测）
  → 看到「回答完成」事件后最多再等 3 秒就结束进程树（Codex 结束后会因通知钩子等滞留约 2 分钟）
  → 返回答案、耗时、token / 费用；可选存成 finding 卡片
```

- 实测（pi、Codex）：答案正确，原会话文件不变，各 agent 的会话目录没有新增文件；pi 约 2 秒，Codex 约 12 秒（约 4.8 万输入 token）。
- MCP 调用期间每 10 秒发送一次进度通知，避免支持进度的客户端超时；安装器把 Codex / pi / WorkBuddy 的工具超时调到 600 秒。
- 豆包工作、WorkBuddy 没有命令行入口，不支持；提示改用 `read_session`。

## 11. 接口设计

### 11.1 MCP 工具（v1）

| 工具 | 参数 | 说明 |
|---|---|---|
| `register` | agent, session_hint?, cwd, label?, activity? | 登记当前会话（在线状态 + 收件箱） |
| `search` | query, agent?, project?, topic?, since?, until?, limit? | 全文检索会话、交接包、卡片，返回片段和引用 |
| `list_sessions` | agent?, project?, since?, active_only? | 列出会话（含摘要） |
| `read_session` | ref, max_chars? | 按引用读取原文片段 |
| `topic_list` / `topic_create` / `topic_link` / `topic_unlink` / `topic_get` | … | 管理工作线；`topic_list` / `topic_create` 支持 `project`（项目绑定）；`topic_get` 返回绑定项目、概览、最新交接包、卡片 |
| `topic_timeline` | topic? 或 project?, since?, until?, order?, limit? | 时间线：工作线或项目下全部工作线的创建、交接包、卡片、关联（开发历程 / 进度记录） |
| `save_handoff` | topic?, title, body_md, refs? | 保存交接包（正文由调用方的 agent 撰写） |
| `load_handoff` | topic? 或 id? 或 session? | 加载交接包 |
| `remember` / `recall` | kind, content, topic?, refs? / query, topic? | 写入或检索知识卡片 |
| `send_message` | to (session / label / topic), body, kind?, refs? | 给另一个会话或 Topic 下所有会话发消息 |
| `check_inbox` | mark_read? | 读取收件箱 |
| `consult` | target, question, timeout?, budget? | 后台咨询（需要用户确认） |
| `get_activity` | date 或 range, project? | 活动汇总：按项目列出各 agent 的会话摘要 + git 提交、未提交改动 + 未完成待办 |

### 11.2 CLI 命令

**已实现（P0 / P0.5）**

```
lingxi guide [--full]                                               # 使用速查（读取 docs/USAGE.md 中的 guide 标记段）
lingxi status
lingxi topic ls [-a] [-p [path]] | new <name> [-d] [-p [path]] | show <topic>
lingxi topic bind|unbind <topic> [path] | link|unlink <topic> <type> <target> | archive|unarchive <topic>
lingxi handoff save -t <title> [--topic] [-f file | stdin] [--source] [--ref]... [--supersedes] [--agent]
lingxi handoff load [id] [--topic] | ls [--topic] [-a] [-n]
lingxi remember <kind> <content...> [--topic] [--ref]... ; lingxi recall [query...] [--topic] [--kind] ; lingxi forget <id>
lingxi search <query...> [--topic] [--type handoff|card] [-n]
lingxi timeline [topic] [-p [path]] [--since] [--until] [--desc] [-n]
lingxi install|uninstall [claude-code|codex|pi|cursor|workbuddy|doubao] [--dry-run] [--skill-only] [--mcp-only]
lingxi mcp                                                          # stdio MCP 服务（由各 agent 启动）
```

**规划中（P1+）**

```
lingxi daemon [start|stop|status]
lingxi sessions [--active] [--project .] ; lingxi show <ref>       # 会话记录导入后
lingxi search "<q>" [--agent codex] [--since 7d]                    # 扩展到会话原文
lingxi send <to> "<msg>" ; lingxi inbox
lingxi consult <ref> "<question>"
lingxi activity [today|2026-10-23|week] [--json]
lingxi export <topic|handoff> --clipboard                           # 兜底：给接不了 MCP 的工具用
```

### 11.3 通用 Skill：`lingxi/SKILL.md`

用于教 agent：

- 什么时候检索：用户提到「之前」「另一个会话」「豆包里」「调研结果」等；
- 什么时候提议保存交接包：完成里程碑、准备切换工具、上下文快满；
- 交接包怎么写：使用 §7.3 的模板，结论带引用；
- 收到其他会话的消息如何对待：作为参考信息，不当作用户授权；
- 一个 Skill 文件分发到 6 个工具。

## 12. 各 agent 接入方案

| Agent | MCP | Skill / 规则 | 钩子 / 扩展 |
|---|---|---|---|
| 12.1 Claude Code | `claude mcp add lingxi -- lingxi mcp` | `~/.claude/skills/lingxi` | `SessionStart`（登记，注入 Topic）、`UserPromptSubmit`（收件箱）、`PreCompact` / `SessionEnd`（提示保存交接包） |
| 12.2 Codex | `~/.codex/config.toml` 的 `[mcp_servers.lingxi]` | `~/.agents/skills/lingxi` | `~/.codex/hooks.json`：`session_start`（登记）、`user_prompt_submit`（收件箱）、`pre_compact` / `stop`（提示保存交接包） |
| 12.3 pi | MCP 或直接写成工具 | Skill | **lingxi-pi 扩展**：登记、实时插入消息、`/ctx` 命令、会话结束提示。作为参考实现 |
| 12.4 Cursor | `~/.cursor/mcp.json` | `~/.cursor/rules` 或 skills | `~/.cursor/hooks.json` |
| 12.5 WorkBuddy | `~/.workbuddy/mcp.json`（用户级 MCP，只支持 mcp.json 方式；`connectors/` 下的是连接器市场自动生成的，不要改） | `~/.workbuddy/skills` | — |
| 12.6 豆包工作 | 自定义连接器选 stdio，命令填 `lingxi mcp`；P3 之后也可以填 HTTP 地址 `http://127.0.0.1:<port>/mcp` | `~/DoubaoWork/skills/lingxi` | — |

### 12.7 飞书（场景 1 的路线 B）

- **官方 `lark-cli`**（larksuite/cli，MIT）：200 多个命令、26 个 Agent Skills，覆盖消息、云文档、多维表格、日历、会议纪要等。官方声明支持 Claude Code、Codex、Cursor。安装命令：`npx @larksuite/cli@latest install`。
- 另有官方 `lark-openapi-mcp`（Beta）。
- **前提**：在飞书开放平台**创建企业自建应用**，获取 App ID 和 Secret，并开通所需权限。
  - 机器人只是自建应用的一种能力，不等于应用本身。
  - **读取你本人的文档和聊天记录，需要以用户身份登录授权（user_access_token）**，部分权限需要企业管理员审批。
- pi 可以通过 Skill 加 bash 调用 `lark-cli`。
- 定位：**lingxi 不重复实现飞书能力**，只在 Skill 里引导「需要飞书时用 lark-cli，得到的结论用 lingxi 保存」。

## 13. 场景走查

### 场景 1

1. 在**豆包**里：读飞书文档和群聊 → 「把对接结论存到 lingxi，Topic=XX需求」→ 豆包调用 `save_handoff`。
2. 在 **Codex** 里：「加载 XX需求」→ 调用 `topic_get` 和 `load_handoff` → 开始开发。
3. 开发中需要再看飞书原文 → Codex 直接用 `lark-cli`（路线 B），不用再切回豆包。

### 场景 2

1. 在 **pi** 里调研（登记 label=research-xx）→ 阶段性结论 `save_handoff(topic=XX)`。
2. 在 **Codex** 里开发 → `topic_link` 加入 XX → `load_handoff` 拿到调研结论。
3. Codex 发现项目约束 → `send_message(to=research-xx, kind=request, "项目实际用 X，请评估 Y 方向")` → pi 扩展实时插入消息，调研转向。
4. Codex 想问细节 → `consult(pi:…, "方案 B 的测试条件？")` → 得到答案，不打扰 pi 的原会话。
5. 综合分析 → Codex 生成开发方案 → `remember(kind=decision, refs=[…])`。

### 场景 3

1. 在**豆包或 WorkBuddy** 里：「记今天的日报」→ Skill 引导调用 `get_activity(today)`。
2. 返回结果：按项目列出各 agent 的会话摘要、git 提交、**未提交改动**、未完成待办。
3. 现有的 `work-log` Skill 也可以改为调用 `lingxi activity --json` 补充数据源。

## 14. 安全与隐私

- 默认**纯本地**：数据存在 `~/.lingxi/`；HTTP 服务只监听 `127.0.0.1`，并要求 token。
- 对原始会话**只读**，不修改任何 agent 的文件。
- 导入时脱敏（API key、token、密码等的正则匹配），可以配置排除目录或项目。
- 消息和后台咨询的安全规则见 §10.2、§10.3。
- 外部模型调用（摘要、兜底提炼）**默认关闭或需要明确配置**，并可以指定公司内部的模型服务。

## 15. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（Node ≥ 20） | MCP 官方 SDK 成熟；pi 扩展同语言；npm 分发；跨平台 |
| 存储 | SQLite（**Node 内置 `node:sqlite`**，WAL，FTS5 trigram 分词；已验证 Node 24 自带 FTS5）；P2 可选 sqlite-vec | 无原生依赖，Windows 安装零编译；单文件，多进程安全，中文检索可用 |
| MCP | `@modelcontextprotocol/sdk`（stdio + Streamable HTTP） | 兼容各家客户端 |
| 文件监听 | chokidar | Windows 兼容好 |
| 后台进程 | Node 常驻；Windows 开机自启（任务计划程序） | — |
| 网页界面（P3） | Vite + React，由 daemon 提供 | 后续可以封装成 Tauri 桌面应用 |
| 测试 | vitest + 各适配器的样例记录（脱敏后） | 格式变化可以回归测试 |

## 16. 目录结构

P0 先用**单包**（npm 包 `lingxi-hub`，命令 `lingxi` / `lx`），模块按目录划分；等适配器、扩展变多后再拆成多包。

```
lingxi/
├── docs/              # USAGE（使用指南）· REFERENCE（参考）· TROUBLESHOOTING（排错）· DESIGN（设计）
├── src/
│   ├── core/          # 存储（node:sqlite）、迁移、检索、格式化
│   ├── mcp/           # MCP 服务（P0: stdio；P3: HTTP）
│   ├── cli/           # lingxi 命令
│   ├── install/       # 各 agent 的 MCP + Skill 安装器
│   ├── adapters/      # (P1) claude-code / codex / pi / cursor / workbuddy
│   └── daemon/        # (P3) 文件监听、消息投递、HTTP
├── skills/lingxi/     # 通用 Skill
├── integrations/      # (P1) pi 扩展、Claude Code / Codex hooks
└── test/              # vitest：单元测试 + MCP 端到端测试
```

## 17. 路线图

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 中枢** ✅ 2026-10-23 | core + SQLite + MCP（stdio）+ CLI 骨架 + 交接包、Topic、卡片 + 通用 Skill + `lingxi install` | 任意 agent（包括豆包、WorkBuddy）能 `save_handoff` / `load_handoff`。已验证：Codex 写入 → pi 读取；Claude Code、Codex、pi 的 MCP 连接正常；豆包和 WorkBuddy 待在应用内手动添加连接器 |
| **P0.5 项目记忆** ✅ 2026-10-23 | 工作线绑定项目目录（多对多，按目录层级匹配）；时间线（MCP `topic_timeline` + `lingxi timeline`）；按用户要求**暂不**自动写入或注入 CLAUDE.md / AGENTS.md | 在项目子目录中能找到绑定的工作线；能按时间查看工作线 / 项目的历程 |
| **P1-a 会话与活动** ✅ v0.2.0 | 导入 Claude Code、Codex、pi 会话（schema v2：sessions / turns / turns_fts；按字节偏移增量同步；查询前自动同步；不导入思考过程；工具输出截断；密钥打码）；MCP `list_sessions` / `search_sessions` / `read_session` / `get_activity`；`topic_get` 显示绑定项目的最近会话；CLI `sync` / `sessions` / `show` / `search -s` / `activity`；会话短引用用 UUID 末段（UUIDv7 开头会撞） | 真实数据首次导入 97 个会话约 2.6 秒，增量约 15 毫秒；pi 实测通过 get_activity 汇总当天工作 |
| **P1-a+ 桌面端会话** ✅ v0.2.1 | 豆包工作适配器（智能体模式 trajectory.jsonl；只取 Role: main；用户消息时间按 assignment.md 对齐，其余沿用；整文件重新导入）；WorkBuddy 适配器（`<user_query>` 提取用户输入；每会话临时工作目录不当作项目）；无工作目录的会话在活动汇总里按 agent 分组；`~/.lingxi/redact.txt` 自定义打码 + 中文「密码：」规则 | 真实数据导入豆包 45 个会话、WorkBuddy 19 个；全部 5 家首次导入约 7.8 秒，增量约 50 毫秒 |
| **P1-b 后台咨询** ✅ v0.3.0 | `consult_session` / `lingxi consult`；费用估算 + 确认（`LINGXI_CONSULT_AUTOCONFIRM_TOKENS` 可设免确认阈值）；只读、不保存；进度通知；安装器调长工具超时 | pi、Codex 实测通过，pi 通过 MCP 真实调用 Codex 会话咨询成功；Claude Code 因本地 API 代理未开启尚未实测 |
| **P1-c 跨会话消息** ✅ v0.4.0 | schema v3（presence / messages / message_reads）；身份 = `<agent>:<会话ID>`（环境变量 → 扩展或钩子登记 → 会话记录推断 → 进程号）；收件人：标签 / 会话引用 / `topic:` / `project:` / `all`，读取时匹配、按读者记已读；投递：pi 扩展实时（空闲新开一轮、忙时 follow-up）、Claude Code / Codex 钩子（`--hooks`，SessionStart + UserPromptSubmit 注入 additionalContext）、所有灵犀工具结果附未读提醒、`check_inbox`；MCP `whoami` / `register` / `list_agents` / `send_message` / `check_inbox`；CLI `who` / `send` / `inbox` / `hook`；会话记录被删除时同步移除 | 真实验证：Codex 发消息 → pi 扩展实时收到并处理 → 用 reply_to 回复 → Codex 会话收件箱收到；56 个测试 |
| **P3-a 图形界面** ✅ v0.5.0 | `lingxi ui`：Node 自带 http 模块的本地服务（只听 127.0.0.1、随机访问令牌、Host 检查、修改类请求需请求头令牌和同源）、JSON API 复用核心函数、服务器推送实时刷新、界面打开期间每 30 秒同步会话；前端 React + Vite（构建到 dist/web，无 React 插件）；页面：今日、工作线（概览 / 时间线 / 交接包历史）、会话（筛选 + 原文）、统一搜索、消息（可发送）、日报（复制 Markdown）、状态 | 用 Edge 无头截图检查了今日、工作线、会话、搜索页面；63 个测试 |
| **P3-b 界面重设计** ✅ v0.6.0 | 参照 frontend-design 方法：先定主题（线与编织、青瓷水墨），再出设计系统（瓷底 / 素纸 / 墨 / 苔灰 / 青瓷 + 唯一强调色铜金；思源宋体做标题、思源黑体做正文、Cascadia Mono 做数据），用 image-gen 生成首页和工作线页的概念图后照着实现；标志性元素「今日织机」（新增 `/api/weave`：按 agent 泳道画会话活跃时段、交接包 / 卡片结点、消息箭头）；新增 `/api/projects`；工作线三栏阅读视图 + 批注式卡片；会话阅读页折叠工具调用；Ctrl K 命令面板；设计说明见 `design/README.md` | Edge 无头截图逐页检查并修正（时间标签重叠、短会话线段过细、版本号统计口径等） |
| **P1 CLI 之间互通** | Claude Code、Codex、pi 适配器（导入 + 检索）+ pi 扩展（登记、实时消息）+ Claude Code 钩子 + `consult`（三家）+ `get_activity` | **场景 2 端到端跑通**；场景 4 可以检索 |
| **P1.5 办公端只写入** | 豆包、WorkBuddy 的 MCP 和 Skill 接入；`get_activity` 开放给办公端；接入 lark-cli（路线 B） | **场景 1、场景 3 跑通** |
| **P2 办公端之间互通** | WorkBuddy、Cursor 适配器 + 在线检测 + 中文检索增强（分词、向量） | 办公端之间互相检索和交接 |
| **P3 CLI 与办公端全面互通** | daemon 的 HTTP MCP、消息投递全面打通、网页界面、剪贴板导出 | 全部组合可用 |
| **P4 扩展** | Meta Muse 等远程 agent（中继）、多设备同步、团队共享、插件市场 | 产品化 |

## 18. 风险与待定问题

| # | 问题 | 处理方式 |
|---|---|---|
| R1 | 各 agent 记录格式没有公开文档，可能随版本变化 | 适配器版本检测 + 样例回归测试 + 解析失败时降级 |
| R2 | ~~豆包记录无法导入~~ **更正（2026-10-26）**：豆包智能体模式的对话是本地明文 JSONL，可以导入；普通聊天模式的对话是否只在云端尚未确认 | 增加豆包适配器；无逐条时间戳，用 assignment.md 近似 |
| R3 | 后台咨询的只读参数、费用、耗时 | P1 逐家核实参数；默认需要确认，并设置超时和费用上限 |
| R4 | Codex、Cursor、办公端缺少推送能力 | 退化为下一轮时轮询，或由用户手动触发 |
| R5 | 中文全文检索质量 | P0 用 trigram 分词，P2 加分词或向量检索 |
| R6 | **Meta Muse**：Meta 于 2026-09 推出的个人 AI agent（App、网页、WhatsApp），能连接邮件、日历等第三方应用；首发仅限美国。**是否支持 MCP 或自定义连接器、是否有开发者 API，暂未查到** | 放到 P4。若支持远程 MCP，就通过中继暴露 lingxi；否则通过邮件、笔记等中间介质桥接 |
| R7 | ~~豆包 MCP 是 stdio 还是 HTTP~~ **已确认：豆包自定义连接器两种都支持** | P0 统一用 stdio；HTTP 留到 P3（届时处理 daemon 开机自启、端口占用、token 认证） |
| R9 | 名称冲突：npm 上 `lingxi`、`lingxi-cli` 已被占用（不相关的项目）；**`lingxi-mcp` 是一个「灵犀 Lingxi 桌面猫」，同样面向 Codex、Cursor、WorkBuddy、Claude 等 agent**，用户群重叠；国内还有「讯飞灵犀」等同名 AI 产品 | 暂定名先用于开发；发布用的包名和命令名另取（见 §19），正式发布或商业化前再评估品牌和商标 |
| R8 | 飞书用户身份的权限审批 | 和企业管理员确认权限范围 |

## 19. 名称

- **项目名**：灵犀 Lingxi（暂定）
- **npm 包名**（待定）。2026-10-23 查过 npm 的情况：
  - 已被占用：`lingxi`、`lingxi-cli`、`lingxi-mcp`、`lx`
  - 未被占用：`lingxi-ai`、`lingxi-hub`、`lxctx`、`@lingxi/cli`（这个 scope 是否可注册待确认）
- **命令名**建议用 `lingxi`，再加一个短别名 `lx`（命令名和包名可以不同）
