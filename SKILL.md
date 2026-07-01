---
name: "reddit-market-monitor"
description: "Use when the user asks for Reddit market monitoring, subreddit monitoring, Reddit VOC or user voice mining, competitor watch, daily/weekly Reddit reports, or translating Reddit discussions into product-development and operations actions. Supports Chinese-first, multi-group monitoring with configurable `config.yaml`, structured reports, preference learning, and long-term user-voice archive."
---

# Reddit 市场监控 Skill

这是一个面向产品开发与运营决策的 Reddit 市场监控技能，不是热帖搬运器。

## 何时使用

当用户提到以下任一需求时，使用本技能：

- Reddit 市场监控
- subreddit 监控
- Reddit 用户原声 / VOC 沉淀
- Reddit 日报 / 周报
- 竞品监控
- 用户痛点、功能诉求、购买顾虑挖掘
- 把 Reddit 讨论转成产品开发、运营、FAQ、内容、客服动作

## 必需资源

执行时先读取同目录文件：

- `config.yaml`
- `skills.md`
- `skills/reddit-readonly/`

其中：

- `config.yaml` 只放可配置项、schema、标签字典、报告字段与默认测试值
- `skills.md` 放完整流程、判断规则、模板、原声存档机制与偏好学习逻辑
- `skills/reddit-readonly/` 是内置的 Reddit 只读子技能，已经随本 Skill 打包，不要求用户额外安装第二个 skill

## 工具与边界

内置子技能：

- `skills/reddit-readonly`

调用时优先使用内置脚本路径：

- `node {baseDir}/skills/reddit-readonly/scripts/reddit-readonly.mjs ...`

数据后端（v1.1.0 起）：

- 子技能通过 **PullPush.io** 读取（免费、无需 OAuth / API Key / 登录 / 机器人账号）。Reddit 匿名 `.json` 端点已于 2026-05 停用，数据中心 IP 直连返回 403。
- 因此抓取模式中 `hot` / `rising` 无法实时获取，会退化为按时间（recency）近似；`top` / `controversial` 按分数近似；评论为**扁平列表**（无嵌套树）。这些不影响监控与 VOC 挖掘。
- 每条结果仍带真实 `permalink`。

能力边界：

- 可以按 `new`（最新）/ `top`（高赞）浏览 subreddit（`hot` 退化为最新）
- 可以按关键词搜索帖子（支持跨版块与单版块）
- 可以拉取某帖的评论（扁平列表）
- 可以生成监控报告、shortlist、digest、VOC archive
- 不可以发帖、评论、点赞、点踩或做任何 Reddit 交互

如果用户要求自动去 Reddit 互动，要明确拒绝，并说明本技能只读。

## 执行入口

### 0. 先判断是否需要配置引导

如果用户：

- 还没有现成 `config`
- 只给了一个模糊目标，例如“帮我做 Reddit 监控”
- 不清楚该监控哪些 subreddit、关键词、用户或竞品

则不要直接开始抓取。

先进入配置引导模式，并遵守这条原则：

- 一个监控任务对应一个 `config`

引导时优先使用：

- `templates/monitor_task_config.template.yaml`

至少帮用户补齐：

- 监控目标
- 目标用户
- 目标 subreddit
- 关键词桶
- 报告重点
- 存档重点

如果用户一次提出多个彼此独立的目标，不要全部塞进同一个大配置，应拆成多个 task config。

### 1. 先读配置

至少读取：

- `schedule`
- `memory`
- `monitoring_defaults`
- `curation_defaults`
- `reporting`
- `archive`
- `monitor_groups`

### 2. 先按组执行，再做总览

对于 `monitor_groups`：

- 只处理 `enabled = true` 的组
- 按 `priority` 从高到低执行
- 每组独立分析，不要因为同一帖子跨组命中就粗暴去重
- 若开启总览，再在所有组完成后生成 master summary

### 3. 采集规则

每组都应结合：

- `new`（最新）
- `top`（高赞，可配合时间窗）
- `search`（关键词，支持跨版/单版）
- （`hot` / `rising` 经 PullPush 无实时排序，会退化为 `new`，无需单独跑）

同时：

- 优先补拉高价值帖子的评论
- 评论优先于标题，因为评论更适合沉淀用户原声
- 但若主帖正文更完整，也可以从主帖抽原声

### 4. 核心输出任务

执行中必须完成四件事：

1. 识别高价值业务信号
2. 将信号翻译为产品开发 / 运营 / 竞品动作
3. 抽取并归并高价值用户原声
4. 输出中文为主的结构化日报 / 周报

### 5. 原声存档原则

原声存档不是摘抄，而是长期资产建设。

处理时必须：

- 尽量保留 `exact_quote`
- 生成 `normalized_quote` 用于查重
- 更新 `matched_groups`
- 命中重复时提升 `repeat_count`
- 同时更新 `reddit_theme_memory`

如果同一条原声被多个组命中：

- 不要重复建档
- 以一个 `archive_id` 作为主记录
- 在 `matched_groups` 中记录所有命中组

### 6. 偏好学习闭环

如果 `memory.ask_feedback_after_daily = true`：

- 日报最后必须附带轻量反馈问题
- 将用户反馈更新到 `reddit_monitor_preferences`
- 把模糊反馈转成明确规则
- 首次反馈先记为软偏好，重复达到阈值后再升级为稳定规则

## 输出要求

- 中文为主
- 保留高价值英文原声
- 结构化
- 表格优先，尤其是摘要、信号列表、动作列表、原声存档、shortlist、决策板
- 面向执行
- 不要只给概念，不要只搬运热帖
- 对证据不足的判断明确写“不足以确认”

## 触发后的工作方式

当任务较简单时，可直接依照本文件执行。

当任务涉及以下任一情况时，必须继续打开 `skills.md` 获取完整规则：

- 配置引导或新建 task config
- 多组监控
- 原声存档 / 查重 / 合并
- 主题记忆与趋势升级
- 日报 / 周报 / 总览模板
- 偏好学习机制
- schema 对齐或字段扩展

同样，当需要确认字段或标签含义时，回到 `config.yaml` 查 glossary 与 reporting schema，不要自行发明新字段。
