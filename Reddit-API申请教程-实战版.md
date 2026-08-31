# Reddit API 申请教程（2026 实战版 · 含中国网络踩坑）

> 目的：给 `reddit-readonly` / Reddit 市场监控 skill 拿到 OAuth 凭据，替代已废弃的匿名 `.json` 端点。
> 适用：只读浏览 subreddit / 帖子 / 评论，小批量、个人辅助判断用途。
> 最后更新：2026-07-01（2026-08-27 补充更正，见下）

> **2026-08-27 更新 — 本文的前提已经不成立，OAuth 不再是唯一出路。**
> 当时判定「匿名端点全废、只能走 OAuth」，其中「Reddit RSS 也被封」是误判：
> 真实原因是 **User-Agent**——用浏览器 UA 请求 `.rss` 会 403，用 feed reader
> UA（如 `feedparser/6.0`）正常返回 200。
> 所以 `reddit-readonly` 现在 **零配置即可全功能**：官方 RSS 提供真实
> hot/new/top 排序与全站搜索，Arctic Shift 提供 2019 至今的历史与批量翻页。
> OAuth 依然值得申请（免 RSS 限流、字段最全），但已经是**可选增强**而非前提。
> 本文作为申请流程与踩坑记录保留，请按上述口径阅读。

---

## 0. 为什么要做这个（背景）

- **匿名 `.json` 端点 2026 年 5 月已被官方废弃**，机房 IP 一律 403，连 reddit.com 首页都进不去。换代理节点无解（所有代理都是机房 IP，Reddit 整段封）。
- **唯一可行方案 = 官方 OAuth**：免费额度约 100 次/分钟（认证后基线 60/分、10 分钟滚动窗口），机房 IP 也能用。
- 拿到的三样东西：**client_id + client_secret**（认走哪个 App）、**Bot 账号 username+password**（认以哪个身份跑）。skill 用这四样走 OAuth 的 password 模式换 token。

---

## 1. 全景：其实是两条独立流水线

很多人卡住是因为把这两步当成一步，其实是分开的：

| 流水线 | 页面 | 产出 | 卡住不影响另一条 |
|---|---|---|---|
| **A. 建 App** | reddit.com/prefs/apps | **client_id + secret** | ✅ |
| **B. 注册/绑 Bot 号** | developers.reddit.com/app-registration | 给 App 挂一个机器人账号、拿 "App" 标签（Responsible Builder 新要求） | ✅ |

> 💡 **关键**：即使 B 还没走完，A 建好后 client_id/secret 就已经躺在 prefs/apps 页面里，可以先拿。

---

## 2. 前置准备：你需要两个 Reddit 账号

| 角色 | 是谁 | 说明 |
|---|---|---|
| **人类主号** | 你日常用的号 | App 的拥有者，全程保持浏览器登录 |
| **Bot 小号** | **新注册的专用小号** | 填进 App，以它身份跑。**不能用主号**（Reddit 明确禁止「用自己账号当 App」，也符合"账号不混用"政策） |

⚠️ **Bot 小号建议用手机热点（干净移动 IP）注册** —— 机房 IP 上注册新号会被 reCAPTCHA 循环卡死，且新号极易被秒封。

---

## 3. 分步操作

### Step 1 · 建 App（prefs/apps）

打开 https://www.reddit.com/prefs/apps → 拉到底 **create app / create another app**，按表填：

| 字段 | 填什么 | 坑 |
|---|---|---|
| **name** | `waytoaic`（描述性名字） | ❌ **不能含 "reddit" 字样**，否则报 `oauth2 client names cannot include "reddit"` |
| 类型 | 选 **script**（个人脚本用） | — |
| description | 随便，`market watch` | — |
| about url | 留空 | 可选 |
| **redirect uri** | `http://localhost:8080` | ❌ **必填**，否则报 `a url is required`；script 模式实际用不到，填占位即可 |
| I'm not a robot | ☑️ 勾选并过验证 | 见下方坑① |

点 **create app**。成功后页面出现 App 卡片：
- **client_id** = App 名字**正下方**那串字符（约 14 位，标 "personal use script"）
- **secret** = 标着 `secret` 那一行

### Step 2 · 注册/绑 Bot 号（app-registration）

进 https://developers.reddit.com/app-registration → 「Register your app」：
- **保持用人类主号登录**当前浏览器
- **App account username** = Bot 小号的**纯用户名**（只含 字母/数字/_/-，不要邮箱、不要 `u/`、不要空格）→ 见坑②
- **App account password** = Bot 小号的**密码** → 见坑③（Google 登录的号没密码）
- Continue

---

## 4. 坑合集（我们实际踩到的）

### 坑① reCAPTCHA「I'm not a robot」反复循环 / 点了没反应
**原因**：当前出口是被 Reddit 封的机房 IP，Google reCAPTCHA 也判它可疑，验证无限循环。**不是操作错误。**
**解法**（成功率高→低）：
1. 换**无痕窗口**重开页面重填（排除 cookie 卡顿）
2. Clash 切一个**别的节点**（美/日），换 IP = 换 reCAPTCHA 评分
3. **兜底几乎必成**：手机 4G/5G 热点 + 手机浏览器操作，移动 IP 评分好

### 坑② username 报 `value does not match regex "^[\w-]+$"`
**原因**：username 栏填了**邮箱**（带 `@`、`.`）或带了 `u/` 前缀 / 空格 / 中文。
**解法**：只填**纯用户名**（字母/数字/下划线/连字符）。用户名在 reddit.com 右上角头像 `u/xxxxx` 里，`xxxxx` 就是。

### 坑③ Bot 号是 Google 登录的，没有密码
**原因**：Google/Apple 第三方登录的 Reddit 号默认没设密码，但 App 注册要 username+password。
**解法**：给它补一个密码 ——
1. 确认小号绑了邮箱（Google 登录一般自动带）
2. 打开 **reddit.com/password**（忘记密码）→ 输小号用户名/邮箱 → 发重置邮件
3. 邮箱点链接 → 设新密码
4. 之后小号「Google 登录 + 密码」两种都能用；App 里填这个密码
> 或干脆用 邮箱+密码 **重新注册一个全新小号**，一步到位。

### 坑④ 提示 rate limited（限流）
**原因**：机房 IP 上操作稍密即触发 Reddit 按 IP 的限流。**越猛点重试冷却越长。**
**解法**：
1. **停手等 10~15 分钟**（激进触发偶尔到 1 小时）
2. 换 IP（手机热点/换节点）可基本重置按 IP 的计数
3. 先去 prefs/apps 看 App 是否**已经建好**、client_id/secret 是否已可拿（限流常不影响读这个页面）

---

## 5. 拿到后给 AI 什么（收尾）

在 prefs/apps 拿到后，把这四样发我（都是**小号**凭据，不碰主号）：
```
client_id     = （App 名字下面那串）
client_secret = （secret 那行）
bot_username  = （Bot 小号用户名）
bot_password  = （Bot 小号密码）
```
我会：写进本地环境变量（不留档、不上传）→ 把 `reddit-readonly.mjs` 改成 OAuth 版（有凭据走 `oauth.reddit.com`，无凭据回退匿名模式）→ 当场跑通给你看。

---

## 6. ⚠️ 合规红线（务必记住）

- 免费 API 框定为**非商业**用途；**商业用途要 Reddit 书面批准**（enterprise）。
- 政策「No Unapproved Commercialization or AI Training」对所有人生效：**禁止**把 Reddit 数据用于商业化 / 批量 mining / scraping / 训练 AI 模型。
- 🟢 **绿灯**：人工低频只读、看帖攒短名单辅助自己判断。
- 🔴 **红线**：拿个人 script App 做**自动化批量抓取 → 灌 VOC 库 → 喂 AI 选品**。处罚 = 吊 token、封 App、连带封号封 subreddit。要规模化走 enterprise 授权或授权数据商；历史评论批量可用 **PullPush.io**（免费）。

---

## 参考

- 官方政策：Responsible Builder Policy（support.reddithelp.com/hc/en-us/articles/42728983564564）
- 标准流程教程：hackread「How to Get a Reddit API Key in 2026」
- 建 App：reddit.com/prefs/apps ｜ 绑号：developers.reddit.com/app-registration
- 历史数据备选：PullPush.io（Pushshift 继承者，免费）
