# 灵犀 Lingxi

**中文** | [English](README.en.md)

> 让不同 agent、不同会话之间「心有灵犀」。
> Local-first context hub shared by all your AI agents — Claude Code, Codex, pi, Cursor, WorkBuddy, 豆包工作 …

## 你是否也遇到过

> 😩 **「刚才在另一个会话里聊清楚了，现在又要从头讲一遍」**
> 在 Claude Code 里花了一下午把问题理清，转到 Codex 开发时，背景、结论、约束又得重新敲一遍，还总会漏掉几条。

> 😩 **「擅长看飞书的 agent 不一定擅长写代码，擅长写代码的又看不到飞书」**
> 在豆包里读完需求文档、对齐完群聊，切到 CLI 写代码时，只能复制粘贴，原文链接和细节一路丢。

> 😩 **「调研和开发分在两个会话，结论来回搬运」**
> pi 里在做技术调研，Codex 里在写项目；开发发现前提变了要调整调研方向，调研有了结论要喂给开发——全靠你当人肉信使。

> 😩 **「一开始没觉得有关，后来才发现要用」**
> 上周某个会话里排查过同样的问题，可当时没保存，现在根本想不起是哪个工具、哪个会话。

> 😩 **「每次开新会话，agent 都要重新读一遍代码熟悉项目」**
> 项目做到哪了、为什么这么设计、哪些路试过走不通——这些不在代码里，也没人记得告诉它。

> 😩 **「写日报时，进行中、没提交的工作全漏了」**
> 白天在四五个 agent 里来回切，晚上写日报只能翻 git log，没提交的改动和在豆包里处理的事一样都想不起来。

**这些问题的根源是同一个：每个 agent、每个会话都是一座孤岛。** 各家的会话记录格式不同、存放位置不同，彼此看不见。

## 灵犀怎么解决

灵犀是一个**所有 agent 共用的本地上下文中枢**：一个 agent 里沉淀的**交接包**、**知识卡片**、**工作线**，任何其他 agent、任何会话都能加载；各家的会话原文也会被自动收录、可以检索。

| 以前 | 用灵犀 |
|---|---|
| 换个 agent，背景重讲一遍 | 换工具前说「保存交接」，新会话里说「加载 XX」 |
| 豆包里的需求靠复制粘贴带到 CLI | 豆包直接写入灵犀；就算忘了保存，CLI 里也能搜到豆包的原始对话 |
| 调研结论和开发约束靠你转述 | 同一个工作线里，调研会话存结论、开发会话记约束；有新情况直接 `send_message`，pi 实时收到 |
| 想不起哪个会话讨论过 | `search_sessions` 跨 5 家 agent 搜会话原文，带引用直接打开 |
| 有个细节只有当时那个会话知道 | `consult_session` 让那个会话的只读副本直接回答，原会话不受影响 |
| 新会话重新熟悉项目 | 工作线绑定项目目录，记录现状、决策、踩坑，「加载项目背景」即可 |
| 日报漏掉进行中的工作 | 「看看我今天做了什么」：按项目汇总各 agent 会话、git 提交和**未提交改动** |

### 一个典型的跨 agent 流程（示意）

```text
【豆包工作】读完飞书需求文档和群聊
  你：把对接结论存到灵犀，topic 叫「导出需求」
  豆包：已保存交接包 ho_…（需求要点 / 飞书链接 / 相关人 / 截止时间）

【Codex】
  你：加载灵犀里的「导出需求」，开始实现
  Codex：已加载（豆包 10 分钟前保存）…… 开始写代码
  你：把「导出用 Playwright 渲染、只做 A4 竖版」记成决策

【pi】
  你：之前哪个会话聊过 PDF 中文字体乱码？
  pi：在 claude-code:…#42 找到，当时的结论是缺少 NotoSansCJK 字体……

【晚上，WorkBuddy】
  你：用灵犀看看我今天做了什么，帮我写日报
  WorkBuddy：按项目汇总 —— 3 个会话、2 次提交、1 处未提交改动、1 条新决策……
```

### 核心能力

- 🔁 **跨 agent 交接**：在豆包里对接完需求，在 Codex 里一句「加载 XX」就能接着做。
- 🧠 **项目记忆**：工作线可以绑定项目目录，记录背景、决策、踩过的坑和进度，并能用时间线回顾开发历程。
- 🔎 **可检索、可累积**：所有内容持久保存，支持中英文全文搜索；新版本替换旧版本，历史保留。
- 🗂️ **会话原文可找回**：自动导入 Claude Code、Codex、pi、豆包工作、WorkBuddy 的会话记录，没保存过的内容也能搜到、读到。
- 📨 **会话之间发消息**：正在运行的会话可以互相发消息，pi 实时收到并处理，Claude Code / Codex 在下一轮自动带上，不用你当信使。
- 💬 **向历史会话提问**：让过去某个 Claude Code / Codex / pi 会话的只读副本带着完整上下文回答问题，不用切换工具，也不打扰原会话（会产生模型费用，默认每次确认）。
- 📝 **活动汇总**：一句话汇总今天 / 本周各 agent 做了什么、提交了什么、还有哪些未提交的改动，用来写日报周报。
- 🔒 **纯本地**：数据只存在 `~/.lingxi/`，不联网，不调用任何外部模型。
- 🧩 **不绑定厂商**：基于 MCP + Agent Skills，已支持 Claude Code、Codex、pi、Cursor、WorkBuddy、豆包工作，新 agent 写个适配器即可接入。

**当前版本：v0.4.0**（见[路线图](#路线图)）。

---

## 快速上手

### 1. 安装

要求 **Node.js ≥ 22.13**（使用 Node 内置的 `node:sqlite`，没有需要编译的依赖）。

```bash
git clone https://github.com/yujiezhu1/lingxi.git
cd lingxi
npm install
npm run build
npm link                       # 全局提供 `lingxi` / `lx` 命令
```

### 2. 接入 agent

```bash
lingxi install --dry-run       # 先看会改哪些文件
lingxi install                 # 接入 Claude Code、Codex、pi、Cursor、WorkBuddy（会先备份原配置）
```

**豆包工作**需要手动添加：在 **豆包工作 → 自定义连接器（MCP）** 里选 stdio，命令和参数按 `lingxi install doubao` 的输出填写，环境变量填 `LINGXI_AGENT=doubao`。

装好后**新开会话**才会生效（pi 可以用 `/reload`）。各 agent 的配置位置见[参考手册](docs/REFERENCE.md#各-agent-的接入位置)。

### 3. 验证

在 agent A（比如 Codex）里说：

> 用灵犀保存一个交接包，topic 叫「灵犀验收」，下一步写「由 B 读取」。

在 agent B（比如 pi 或豆包）里说：

> 加载灵犀里的「灵犀验收」，告诉我最新交接包的标题、作者和下一步。

B 能答上来，就说明打通了。验收完用 `lingxi topic archive 灵犀验收` 收起来。

### 4. 开始用：记住三句话

| 时机 | 在 agent 里说 |
|---|---|
| 开新会话、接着做某件事 | 「加载灵犀里的 XX」 / 「加载这个项目在灵犀里的背景」 |
| 切换工具前，或到一个阶段 | 「保存交接到灵犀，topic 叫 XX」 |
| 定了一件事、踩了一个坑 | 「把这个记到灵犀」 |

忘了怎么用时，在终端输入 **`lingxi guide`** 查看速查。

### 常用命令

```bash
lingxi topic ls -p                  # 当前项目有哪些工作线
lingxi topic show <topic>           # 某个工作线的完整概览
lingxi timeline --since 7d          # 当前项目最近一周的历程
lingxi search -s PDF 中文字体         # 跨 agent 搜会话原文
lingxi show codex:da497af449db#42   # 打开某个会话第 42 条附近
lingxi activity                     # 今天做了什么（含未提交改动）
lingxi who                          # 有哪些会话在线
lingxi send research-pdf 项目用 FastAPI   # 给某个会话发消息
```

---

## 文档

| 文档 | 内容 |
|---|---|
| [使用指南](docs/USAGE.md) | 日常流程、六个典型场景、怎么写交接包、卡片用法、使用习惯 |
| [参考手册](docs/REFERENCE.md) | MCP 工具、CLI 命令、各 agent 的接入位置、数据与环境变量 |
| [常见问题与排错](docs/TROUBLESHOOTING.md) | 连接问题、使用问题、卸载、常见疑问 |
| [设计文档](docs/DESIGN.md) | 背景、架构、数据模型、路线图（开发者向） |
| [更新日志](CHANGELOG.md) | 版本变化 |
| [Skill](skills/lingxi/SKILL.md) | 给 agent 看的使用说明（自动安装到各 agent） |
| [演示录制脚本](docs/DEMO.md) | 录制演示动图的分镜和示例数据 |

---

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 中枢 | 交接包、工作线、知识卡片、全文检索、MCP stdio、CLI、Skill、安装器 | ✅ v0.1.0 |
| P0.5 项目记忆 | 工作线绑定项目目录、时间线、`lingxi guide` | ✅ v0.1.0 |
| P1-a 会话与活动 | 导入 Claude Code、Codex、pi 会话并搜索原文、读取会话；活动汇总（含未提交改动） | ✅ v0.2.0 |
| P1-a+ 桌面端会话 | 导入豆包工作（智能体模式）、WorkBuddy 会话；自定义打码规则 | ✅ v0.2.1 |
| P1-b 后台咨询 | 复制一份会话在后台回答问题（只读、不保存、不打扰原会话；费用估算 + 确认） | ✅ v0.3.0 |
| P1-c 跨会话消息 | 在线登记、收件箱、pi 扩展实时投递、Claude Code / Codex 钩子投递、未读提醒 | ✅ v0.4.0 |
| P1.5 办公端写入 | 豆包、WorkBuddy 深度接入；对接飞书 `lark-cli` | 部分完成（MCP 已可用） |
| P2 办公端之间互通 | Cursor 会话导入；在线检测；中文检索增强 | 计划中 |
| P3 全面互通 | 后台服务（HTTP MCP、消息投递）；本地网页界面 | 计划中 |
| P4 扩展 | Meta Muse 等远程 agent、多设备同步、团队共享 | 计划中 |

---

## 开发

```bash
npm install
npm run build        # tsc → dist/
npm test             # vitest：存储、项目绑定、会话导入与查询、安装器、MCP 端到端测试
```

| 目录 | 内容 |
|---|---|
| `src/core` | 存储（node:sqlite + FTS5 trigram）、迁移、检索、项目匹配、格式化 |
| `src/ingest` | 会话导入适配器（Claude Code、Codex、pi、豆包工作、WorkBuddy）、增量同步、密钥打码 |
| `src/mcp` | MCP 服务（stdio） |
| `src/cli` | `lingxi` 命令 |
| `src/install` | 各 agent 的 MCP 和 Skill 安装器 |
| `skills/lingxi` | 通用 Skill |
| `docs` | 使用指南、参考手册、排错、设计文档 |
| `test` | 单元测试与端到端测试 |

## 许可

尚未确定，目前保留所有权利（`UNLICENSED`）。正式发布前会补充开源许可。
