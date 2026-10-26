# 演示录制脚本

用于录制 README 里的演示动图 / 截图。分两部分：

- **A. 终端演示**：全部用示例数据，可以完整复现，不会暴露你的真实数据；
- **B. 跨 agent 演示**：在真实 agent 里操作，最有说服力，但录制前要确认画面里没有敏感信息。

推荐工具：Windows 用 [ScreenToGif](https://www.screentogif.com/)，macOS / Linux 用 [asciinema](https://asciinema.org/) + [agg](https://github.com/asciinema/agg) 或 [vhs](https://github.com/charmbracelet/vhs)。
终端建议 100×30、字号 16 以上，深色主题；每段动图控制在 30 秒以内。

---

## A. 终端演示（示例数据）

### 准备

```bash
npm run build
node scripts/demo-seed.mjs /tmp/lingxi-demo   # 用一个中性的目录，画面里不会出现你的用户名
export LINGXI_HOME=/tmp/lingxi-demo
export LINGXI_INGEST=none                  # 不导入你的真实会话
```

PowerShell：

```powershell
$env:LINGXI_HOME = (node scripts/demo-seed.mjs D:\lingxi-demo)
$env:LINGXI_INGEST = "none"
```

重新录制前删掉这个目录再生成一次，时间戳会更新。

### 分镜（约 25 秒）

| # | 输入 | 画面要点 | 停留 |
|---|---|---|---|
| 1 | `lingxi topic ls` | 两条工作线，`export-feature` 绑定了项目 | 3 秒 |
| 2 | `lingxi topic show export-feature` | 最新交接包（由 codex 写，替换了 doubao 那份），下面是决策 / 约束 / 踩坑 / 待办卡片，分别来自不同 agent | 8 秒，慢慢滚动 |
| 3 | `lingxi timeline export-feature` | 按时间排列：doubao 写需求 → pi 调研发现 → codex 决策与实现，旧交接包标 `[superseded]` | 5 秒 |
| 4 | `lingxi search Playwright` | 跨交接包和卡片命中 | 3 秒 |
| 5 | `lingxi guide` | 速查表 | 3 秒 |

想要的话再加一段：`lingxi recall --kind todo`（跨会话待办）。

---

## B. 跨 agent 演示（真实 agent）

目标：一张动图讲清「在 A 里保存，在 B 里接着做」。推荐左右分屏，左边豆包或 Claude Code，右边 Codex 或 pi。

### 分镜（约 30 秒）

| # | 位置 | 说的话 | 画面要点 |
|---|---|---|---|
| 1 | 左（豆包 / Claude Code） | 「把刚才的结论存到灵犀，topic 叫 export-feature」 | agent 调用 `save_handoff`，返回交接包 id |
| 2 | 右（Codex / pi） | 「加载灵犀里的 export-feature，告诉我要做什么」 | agent 调用 `topic_get`，复述需求和决策，并注明「由 doubao 保存」 |
| 3 | 右 | 「之前哪个会话聊过 PDF 中文字体？」 | `search_sessions` 命中其他 agent 的会话，带引用 |
| 4 | 任一 | 「用灵犀看看我今天做了什么」 | `get_activity` 按项目列出各 agent 会话、提交和未提交改动 |

### 录制前检查

- [ ] 用一个演示用的 topic（如 `export-feature`），不要用真实项目名；
- [ ] 画面里没有公司名、真实文档链接、人名、邮箱、内网地址；
- [ ] 第 3、4 步会展示真实会话内容：要么先确认搜到的内容可以公开，要么改用 A 部分的示例数据；
- [ ] 不要录到终端里的环境变量、token、配置文件内容；
- [ ] 录完逐帧过一遍，有问题就打码或重录。

---

## 放进 README

把动图放在仓库的 `docs/assets/` 下（例如 `docs/assets/demo-cross-agent.gif`），然后在 README 的「灵犀怎么解决」下面加：

```markdown
![跨 agent 交接演示](docs/assets/demo-cross-agent.gif)
```

英文版 README 同样位置加一份。GIF 尽量控制在 5 MB 以内（ScreenToGif 导出时降低帧率到 10–12 fps）。
