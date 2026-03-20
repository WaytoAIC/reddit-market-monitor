# reddit-market-monitor

中文 | [English](#english)

## Quick Install

```bash
# Codex
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target codex --ref v1.0.0
```

```bash
# OpenClaw
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target openclaw --ref v1.0.0
```

```bash
# OpenClaw workspace-local skills/
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --dest "$(pwd)/skills" --ref v1.0.0
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
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/main/install.sh | bash -s -- --target codex
```

OpenClaw 全局 skills 目录:

```bash
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/main/install.sh | bash -s -- --target openclaw
```

OpenClaw 工作区本地 `skills/` 目录:

```bash
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/main/install.sh | bash -s -- --dest "$(pwd)/skills"
```

固定到某个 tag 或版本:

```bash
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target codex --ref v1.0.0
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

### 说明

- 当前仓库里保留了 `reddit-readonly.zip` 占位文件，但主 Skill 实际已经改为使用 `skills/reddit-readonly/` 目录中的内置子技能。

---

## English

## Quick Install Card

```bash
# Codex
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target codex --ref v1.0.0
```

```bash
# OpenClaw
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target openclaw --ref v1.0.0
```

```bash
# OpenClaw workspace-local skills/
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --dest "$(pwd)/skills" --ref v1.0.0
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
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/main/install.sh | bash -s -- --target codex
```

OpenClaw global skills directory:

```bash
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/main/install.sh | bash -s -- --target openclaw
```

OpenClaw workspace-local `skills/` directory:

```bash
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/main/install.sh | bash -s -- --dest "$(pwd)/skills"
```

Pin to a tag or version:

```bash
curl -fsSL https://raw.githubusercontent.com/restart2000/reddit-market-monitor/v1.0.0/install.sh | bash -s -- --target codex --ref v1.0.0
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

### Note

- The repository still contains a placeholder `reddit-readonly.zip`, but the skill now actually uses the bundled subskill in `skills/reddit-readonly/`.
