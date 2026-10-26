# 常见问题与排错

- [安装与连接](#安装与连接)
- [使用中的问题](#使用中的问题)
- [其他工具自身的问题（与灵犀无关）](#其他工具自身的问题与灵犀无关)
- [常见疑问](#常见疑问)

---

## 安装与连接

### 怎么确认装好了

```bash
lingxi status            # 看数据目录和数量
claude mcp get lingxi    # Claude Code：Status 应为 ✓ Connected
codex mcp list           # Codex：lingxi 显示 enabled
pi mcp list              # pi：lingxi: connected, 17 tools
```

### agent 里看不到灵犀的工具

- 先确认已新开会话（pi 可以用 `/reload`）。
- 用上面的命令检查连接状态。
- 项目目录移动过的话，重新执行 `npm run build && lingxi install`（安装器写入的是绝对路径）。

### WorkBuddy 里没有 lingxi

- 检查 `~/.workbuddy/mcp.json` 里有没有 `lingxi`，没有就执行 `lingxi install workbuddy`。
- 在应用的 MCP 列表里批准它，或重启 WorkBuddy。

### 豆包里调用失败

- 检查命令和参数是否和 `lingxi install doubao` 的输出**完全一致**：参数要分成两项（脚本路径和 `mcp`），路径不要加引号。
- 环境变量填 `LINGXI_AGENT=doubao`。

---

## 使用中的问题

### agent 没有主动用灵犀

- 在话里带上「灵犀」两个字，例如「加载灵犀里的 XX」。
- pi 可以用 `/skill:lingxi` 强制加载使用说明。

### 搜索搜不到

- 多个关键词之间是「且」的关系，减少关键词试试。
- `search` 只搜交接包和卡片；搜会话原文用 `search_sessions`（终端 `lingxi search -s`）。
- 会话搜索默认不搜工具输出，需要时加 `include_tools`（终端 `--tools`）。
- Cursor 的会话暂不导入；豆包工作只导入智能体模式的会话。

### 会话没导入 / 不是最新

- 查询时会自动增量同步；也可以手动 `lingxi sync`，看各 agent 的文件数和错误。
- 数据不对时可以 `lingxi sync --full` 全部重建。
- 检查是否设置了 `LINGXI_INGEST=none`。

### 会话里有密码等敏感信息

- 内置规则会给 `sk-…`、`Bearer …`、`api_key=…`、`密码：…` 这类有标签或固定格式的内容打码，但识别不了没有标签的密码（比如浏览器自动化时直接输入的密码）。
- 把这些字符串写进 `~/.lingxi/redact.txt`（每行一个，`re:` 开头表示正则），再执行 `lingxi sync --full`。
- 注意：原始记录仍然在各 agent 自己的目录里，灵犀打码不影响原文件；必要时修改密码。

### 不想让某些会话被导入

- 设置 `LINGXI_INGEST`（例如只导入 `codex,pi`），或 `none` 全部关闭；然后 `lingxi sync --full` 清理已导入的数据。

### 在项目里找不到绑定的 topic

- 用 `lingxi topic show <topic>` 看绑定的项目路径对不对。
- 用 `lingxi topic ls -p` 在项目目录里检查；需要的话用 `lingxi topic bind <topic>` 重新绑定。

### 加载到的内容过时了

- 让 agent「更新 XX 的交接包，替换掉旧的」；错误的卡片说「从灵犀里删掉」（归档）。
- 想看演变过程：`lingxi timeline <topic>`。

---

## 其他工具自身的问题（与灵犀无关）

### Codex 每次提问都出现 `Hook failed / hook exited with code 1`

- 原因：`~/.codex/hooks.json` 里放了给 Cursor 用的钩子（`cursor-hook.js` 加 `cmd /d /s /c` 写法），而 Codex 在 Windows 上用 PowerShell 运行钩子命令，引号被解析乱了。
- 不用 Clawd 桌宠的话：删掉 `~/.codex/hooks.json`。
- 要用的话：执行 `node "<Clawd 安装目录>/resources/app.asar.unpacked/hooks/codex-install.js"` 重新生成，再在 Codex 里运行 `/hooks` 批准。
- 如果以后又出现，检查 `hooks.json` 里是不是又变回了 `cursor-hook.js`。

### Codex 报 `Error loading config.toml: url is not supported for stdio in mcp_servers.exa`

- 原因：项目级 `.codex/config.toml` 和用户级配置里的同名 MCP（例如 exa）一个是命令方式、一个是 URL 方式，冲突了。
- 删掉其中一份即可。

---

## 常见疑问

### 这和「让 agent 总结一下、再贴给另一个 agent」有什么区别？

- 核心动作确实类似，总结写得好不好仍然取决于写的那个 agent。
- 区别在于：不用你来回复制粘贴；内容**持久保存**、可以搜索；多个会话往同一个 topic 里**累积**、多个 agent 都能读；有统一模板、来源引用、作者和时间；新版本替换旧版本，历史保留；桌面端也能直接读写。
- 手动方式做不到的能力：自动导入会话原文并搜索、活动汇总（v0.2 已支持）；向原会话后台提问、跨会话实时消息（后续版本）。

### 和 CLAUDE.md / AGENTS.md 冲突吗？

不冲突，建议配合使用：CLAUDE.md / AGENTS.md 放稳定的事实（架构、命令、规范），灵犀放会变化的东西（现状、决策、踩坑、历程）。详见[使用指南·场景四](USAGE.md#场景四当作项目的背景历程进度记录)。

### 数据会上传吗？

不会。数据只存在本机 `~/.lingxi/`，灵犀本身不联网。导入的会话也只是复制到本机的灵犀数据库里，并对常见密钥格式打码。

### 怎么卸载？

```bash
lingxi uninstall --dry-run     # 先看会删掉什么
lingxi uninstall               # 从全部 agent 移除 MCP 配置和 Skill
lingxi uninstall cursor        # 只移除某一个
```

豆包的连接器需要在应用里手动删除。数据目录 `~/.lingxi/` 不会被删除，需要的话手动删除。
不再需要全局命令的话，在项目目录执行 `npm unlink -g lingxi-hub`。
