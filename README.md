# 灵犀 Lingxi

> 让不同 agent、不同会话之间「心有灵犀」。
> Local-first context hub shared by all your AI agents — Claude Code, Codex, pi, Cursor, WorkBuddy, 豆包工作 …

同时用好几个 agent、开好几个会话时，一个会话里花时间得出的结论，很难带到另一个会话里：要么重新解释一遍，要么复制粘贴，还容易漏、容易走样。

灵犀是一个**所有 agent 共用的本地上下文中枢**。在一个 agent 里沉淀的**交接包**、**知识卡片**、**工作线**，在任何其他 agent、任何会话里都能加载。

- 🔁 **跨 agent 交接**：在豆包里对接完需求，在 Codex 里一句「加载 XX」就能接着做。
- 🧠 **项目记忆**：工作线可以绑定项目目录，记录背景、决策、踩过的坑和进度，并能用时间线回顾开发历程。
- 🔎 **可检索、可累积**：所有内容持久保存，支持中英文全文搜索；新版本替换旧版本，历史保留。
- 🗂️ **会话原文可找回**：自动导入 Claude Code、Codex、pi、豆包工作、WorkBuddy 的会话记录，没保存过的内容也能搜到、读到。
- 📝 **活动汇总**：一句话汇总今天 / 本周各 agent 做了什么、提交了什么、还有哪些未提交的改动，用来写日报周报。
- 🔒 **纯本地**：数据只存在 `~/.lingxi/`，不联网。

**当前版本：v0.2.1**。后台咨询、跨会话消息在后续版本（见[路线图](#路线图)）。

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

---

## 文档

| 文档 | 内容 |
|---|---|
| [使用指南](docs/USAGE.md) | 日常流程、四个典型场景、怎么写交接包、卡片用法、使用习惯 |
| [参考手册](docs/REFERENCE.md) | MCP 工具、CLI 命令、各 agent 的接入位置、数据与环境变量 |
| [常见问题与排错](docs/TROUBLESHOOTING.md) | 连接问题、使用问题、卸载、常见疑问 |
| [设计文档](docs/DESIGN.md) | 背景、架构、数据模型、路线图（开发者向） |
| [更新日志](CHANGELOG.md) | 版本变化 |
| [Skill](skills/lingxi/SKILL.md) | 给 agent 看的使用说明（自动安装到各 agent） |

---

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 中枢 | 交接包、工作线、知识卡片、全文检索、MCP stdio、CLI、Skill、安装器 | ✅ v0.1.0 |
| P0.5 项目记忆 | 工作线绑定项目目录、时间线、`lingxi guide` | ✅ v0.1.0 |
| P1-a 会话与活动 | 导入 Claude Code、Codex、pi 会话并搜索原文、读取会话；活动汇总（含未提交改动） | ✅ v0.2.0 |
| P1-a+ 桌面端会话 | 导入豆包工作（智能体模式）、WorkBuddy 会话；自定义打码规则 | ✅ v0.2.1 |
| P1-b 后台咨询 | 复制一份会话在后台回答问题（不打扰原会话） | 计划中 v0.3 |
| P1-c 跨会话消息 | 在线登记、收件箱、pi 扩展实时插入、Claude Code / Codex 钩子投递 | 计划中 v0.4 |
| P1.5 办公端写入 | 豆包、WorkBuddy 深度接入；对接飞书 `lark-cli` | 部分完成（MCP 已可用） |
| P2 办公端之间互通 | WorkBuddy、Cursor 会话导入；在线检测；中文检索增强 | 计划中 |
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
