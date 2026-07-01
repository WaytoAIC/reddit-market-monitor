# reddit-market-monitor

## 🚀 Way to AIC | 通往 AI 电商之路
---
### 🌐 官网 Website
- https://waytoaic.com  
- https://www.waytoaic.com  
---

### 👥 社群招募 Community
`Way to AIC 社群招募 | WaytoAIC.com`

<p align="center">
  <img src="https://github.com/user-attachments/assets/d9f8bbf4-2056-4780-975d-86c885b52bab" width="70%">
</p>

---

### 📣 公众号 WeChat Official Account
`维正 WaytoAIC`

<p align="center">
  <img src="https://github.com/user-attachments/assets/71c71a5c-e68a-4f30-9afb-f2b056619991" width="300">
</p>

---

### 🧠 知识星球 Xiaozhixing
`AI电商之路 WaytoAIC`

<p align="center">
  <img src="https://github.com/user-attachments/assets/9eccef07-0e84-45a7-a415-affcb18c928d" width="200">
  <img src="https://github.com/user-attachments/assets/4e99fbc3-1981-4fee-b113-c9821141102d" width="400">
</p>

---

### 🧩 About Way to AIC

**AIC = AI Commerce**

在 AI 重塑商业的时代，我们希望和每一个拥抱 AI 的卖家：

- 找到场景  
- 定义问题  
- 积累能力  
- 设计系统  

共同通往 AI 电商之路。

> Way to AIC 不是教学，不是工具，  
> 而是一条所有电商人共同走的进化之路。

### WaytoAIC 理念 | Principles

| 中文 | English |
|---|---|
| 场景先于方法 | Context before method |
| AI 的价值来自真实业务场景，而不是技术本身。 | AI creates value through real business contexts, not through technology alone. |
| 问题先于答案 | Problem before answer |
| 定义问题，比拥有工具更重要。 | Defining the problem matters more than collecting tools. |
| 系统胜过技巧 | System over tricks |
| 技巧是术，系统才是道，决定卖家的上限。 | Tricks are tactical; systems define long-term leverage and ceiling. |
| 共创优于独行 | Co-creation over solo progress |
| 我们相信，真正的进化发生在共同探索的过程中。 | Real evolution happens through shared exploration. |

---

中文 | [English](#english)

## Quick Install

```bash
# Codex
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --target codex --ref v1.2.0
```

```bash
# OpenClaw
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --target openclaw --ref v1.2.0
```

```bash
# OpenClaw workspace-local skills/
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --dest "$(pwd)/skills" --ref v1.2.0
```

复制即用。安装后重启 Codex / OpenClaw。

---

一个面向产品开发与运营决策的 Reddit 市场监控 Skill。

它不是热帖搬运器，而是一个把 Reddit 讨论转成：

- 产品开发动作
- 运营动作
- 竞品观察
- 用户原声存档
- 日报 / 周报 / 多组总览

的结构化技能包。

## 中文

### 适用场景

- Reddit 市场监控
- subreddit 监控
- Reddit VOC / 用户原声沉淀
- 竞品监控
- 用户痛点、功能诉求、购买顾虑挖掘
- 把 Reddit 讨论转成产品开发、运营、FAQ、内容、客服动作

### 仓库内容

- 主 Skill 入口：[SKILL.md](./SKILL.md)
- 完整执行规则：[skills.md](./skills.md)
- 默认配置与 schema：[config.yaml](./config.yaml)
- 新手配置模板：[templates/monitor_task_config.template.yaml](./templates/monitor_task_config.template.yaml)
- 表格版日报示例：[reports/2026-03-20_reddit_daily_table_example.md](./reports/2026-03-20_reddit_daily_table_example.md)
- 内置 Reddit 只读子技能：[skills/reddit-readonly](./skills/reddit-readonly)

### 主要特点

- 内置 `reddit-readonly` 子技能，用户无需额外安装第二个 skill
- 支持多组监控，但推荐按“一个监控任务对应一个 config”来组织
- 输出默认表格优先，更适合日报、周报和决策面板阅读
- 报告产物支持 `md` 或 `md+html`（首次使用询问一次；HTML 为自包含单文件，permalink 自动可点、优先级自动着色）
- 支持长期 VOC 存档、主题记忆、偏好学习

### 安装

把整个目录复制到：

```text
~/.codex/skills/reddit-market-monitor
```

重启 Codex 后即可生效。

### 一键安装

适用于直接从 GitHub 安装最新版。

Codex:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/main/install.sh | bash -s -- --target codex
```

OpenClaw 全局 skills 目录:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/main/install.sh | bash -s -- --target openclaw
```

OpenClaw 工作区本地 `skills/` 目录:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/main/install.sh | bash -s -- --dest "$(pwd)/skills"
```

固定到某个 tag 或版本:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --target codex --ref v1.2.0
```

### 推荐使用方式

1. 如果你还没有明确监控策略，先从 [templates/monitor_task_config.template.yaml](./templates/monitor_task_config.template.yaml) 生成一个最小可跑的 task config。
2. 一个监控任务只服务一个明确业务目标。
3. 新任务先从 1 个 `monitor_group` 开始，跑通后再扩展。
4. 报告默认优先输出表格，而不是大段散文。

### 许可说明

本仓库采用“公开源码 / source-available”授权，而不是 OSI 定义下的 Open Source。

原因很简单：

- 本项目允许学习、使用、修改与分享
- 但不允许商业使用
- 如果你基于本 Skill 做修改、派生版本，或用它开发并分发更大的功能，也必须公开对应源代码

具体条款见：

- [LICENSE.md](./LICENSE.md)
- [ADDITIONAL_TERMS.md](./ADDITIONAL_TERMS.md)

如果你需要商业授权，请联系作者单独协商。

### 仓库结构

```text
.
├── SKILL.md
├── skills.md
├── config.yaml
├── templates/
├── reports/
├── archives/
└── skills/
    └── reddit-readonly/
```

### 数据后端说明（重要）

Reddit 已于 2026 年 5 月停用匿名 `.json` 端点，数据中心 IP 直连会返回 HTTP 403。因此内置 `reddit-readonly` 子技能自 v1.1.0 起改为通过 **[PullPush.io](https://pullpush.io)** 读取——一个免费、无需鉴权的 Pushshift 继任存档，数据结构与 Reddit 一致。

- **无需** Reddit API Key、OAuth、登录或机器人账号，开箱即用。
- 每条结果仍带 `permalink`，可点开真实 Reddit 原帖人工查看/回复。
- 取舍：PullPush 强在搜索与挖掘（按版块、关键词、作者、时间窗），但**没有 `hot`/`rising` 实时排序**（按时间或分数近似），评论为**扁平列表**（无嵌套回复树），且为近实时存档，新帖可能延迟数分钟。
- 如需切回官方端点，设环境变量 `REDDIT_RO_BACKEND=reddit`（仅在拥有 OAuth 或住宅 IP 时可用，否则 403）。
- 合规：仅用于低频、人工驱动的只读浏览。请勿用于大规模自动化挖取以喂商业管线或训练 AI 模型——无论数据源为何，均违反 Reddit Responsible Builder Policy。

### 说明

- `reddit-readonly.zip` 与 `skills/reddit-readonly/` 目录中的内置子技能保持同步，主 Skill 实际调用目录版本。
- 当前仓库 README 顶部已加入 `Way to AIC` 固定项目前缀，后续 Way to AIC 项目可复用同一前缀模板。

---

## English

## Quick Install Card

```bash
# Codex
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --target codex --ref v1.2.0
```

```bash
# OpenClaw
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --target openclaw --ref v1.2.0
```

```bash
# OpenClaw workspace-local skills/
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --dest "$(pwd)/skills" --ref v1.2.0
```

Copy, run, then restart Codex / OpenClaw.

---

`reddit-market-monitor` is a Reddit monitoring skill designed for product, growth, and operations decisions.

It is not a repost bot. It turns Reddit discussions into:

- product actions
- operations actions
- competitor watch
- user voice archive
- daily reports, weekly reports, and multi-group summaries

### Use Cases

- Reddit market monitoring
- subreddit monitoring
- VOC and user-language capture from Reddit
- competitor monitoring
- finding pain points, feature requests, and buying objections
- converting Reddit discussions into actions for product, FAQ, support, content, and operations

### What Is Included

- Main skill entry: [SKILL.md](./SKILL.md)
- Full execution rules: [skills.md](./skills.md)
- Default config and schema: [config.yaml](./config.yaml)
- Starter config template: [templates/monitor_task_config.template.yaml](./templates/monitor_task_config.template.yaml)
- Table-first daily report example: [reports/2026-03-20_reddit_daily_table_example.md](./reports/2026-03-20_reddit_daily_table_example.md)
- Bundled read-only Reddit subskill: [skills/reddit-readonly](./skills/reddit-readonly)

### Key Features

- Bundles `reddit-readonly`, so users do not need to install a second skill
- Supports multi-group monitoring, while recommending one config per monitoring task
- Uses table-first output for easier reading in daily and weekly decision workflows
- Reports export as `md` or `md+html` (asked once on first use; HTML is a self-contained single file with clickable permalinks and priority coloring)
- Supports long-term VOC archiving, theme memory, and preference learning

### Installation

Copy this directory to:

```text
~/.codex/skills/reddit-market-monitor
```

Then restart Codex.

### One-Command Install

Use these commands to install the latest version directly from GitHub.

Codex:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/main/install.sh | bash -s -- --target codex
```

OpenClaw global skills directory:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/main/install.sh | bash -s -- --target openclaw
```

OpenClaw workspace-local `skills/` directory:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/main/install.sh | bash -s -- --dest "$(pwd)/skills"
```

Pin to a tag or version:

```bash
curl -fsSL https://raw.githubusercontent.com/WaytoAIC/reddit-market-monitor/v1.2.0/install.sh | bash -s -- --target codex --ref v1.2.0
```

### Recommended Workflow

1. If you do not yet have a monitoring strategy, start from [templates/monitor_task_config.template.yaml](./templates/monitor_task_config.template.yaml).
2. Keep one config focused on one clear business goal.
3. Start new tasks with a single `monitor_group`, then expand later if needed.
4. Prefer table-first reporting instead of long narrative output.

### License

This repository is released as public source-available software, not OSI-defined Open Source.

That is because it is intended to be:

- usable for learning, internal use, modification, and sharing
- not permitted for commercial use
- required to publish source code for derivative or larger distributed functionality built from it

See:

- [LICENSE.md](./LICENSE.md)
- [ADDITIONAL_TERMS.md](./ADDITIONAL_TERMS.md)

If you need a commercial license, contact the author separately.

### Repository Layout

```text
.
├── SKILL.md
├── skills.md
├── config.yaml
├── templates/
├── reports/
├── archives/
└── skills/
    └── reddit-readonly/
```

### Data Backend (Important)

Reddit deprecated its anonymous `.json` endpoints in May 2026; datacenter IPs now get HTTP 403 on direct calls. As of v1.1.0 the bundled `reddit-readonly` subskill therefore reads through **[PullPush.io](https://pullpush.io)** — a free, no-auth Pushshift successor archive that mirrors Reddit's data model.

- **No** Reddit API key, OAuth, login, or bot account required — works out of the box.
- Every result still carries a `permalink` back to the real Reddit thread for manual review/reply.
- Trade-offs: PullPush is strong at search/mining (by subreddit, keyword, author, time window) but has **no `hot`/`rising` ranking** (approximated by recency or score), returns comments as a **flat list** (no nested reply tree), and is a near-real-time archive so brand-new posts may lag by minutes.
- To force the legacy official endpoints, set `REDDIT_RO_BACKEND=reddit` (only works with OAuth or a residential IP; otherwise 403).
- Compliance: use for low-volume, human-driven reading only. Do not use for large-scale automated mining that feeds a commercial pipeline or trains AI models — that violates Reddit's Responsible Builder Policy regardless of data source.

### Note

- `reddit-readonly.zip` is kept in sync with the bundled subskill under `skills/reddit-readonly/`; the main skill calls the directory version.
- This repository now includes the fixed `Way to AIC` README prefix at the top, intended for reuse across future Way to AIC GitHub projects.
