# 任务管理器（ADHD Planner for Windows）

一款简洁美观的 Windows 桌面任务管理应用，专为需要随时保持专注的用户设计。

![应用截图](resources/icon.svg)

---

## ✨ 功能特色

| 功能 | 说明 |
|------|------|
| ✅ 任务增删改查 | 添加、编辑、删除任务，支持标题、备注、优先级 |
| 🎯 优先级标签 | 高 / 中 / 低三级优先级，彩色标识一目了然 |
| ↕️ 拖拽排序 | 左侧把手可拖动任务，自由调整顺序 |
| 🎆 完成特效 | 勾选任务时随机触发8种庆祝动画（烟花/彩带/爱心等） |
| 🔲 小组件置顶 | 一键缩小为细长条，始终浮在所有窗口最上方 |
| 📍 位置稳定 | 每次进入小组件统一回到屏幕顶部中间，位置可预期 |
| 🖥️ 系统托盘 | 关闭窗口后隐藏到托盘，不退出程序 |
| 🚀 开机自启 | 托盘菜单可一键开启/关闭开机自动启动 |
| 💾 本地持久化 | 数据保存在本地 JSON 文件，重启不丢失 |

---

## 🚀 快速开始

### 环境要求

- **Node.js** 18 或以上版本
- **Windows 10 / 11**（64位）

### 安装依赖

```bash
npm install
```

### 开发模式运行

```bash
npm run dev
```

### 打包为 exe

```bash
# 需要先在 Windows 设置中开启"开发者模式"
npm run build:win

# 或只生成免安装版（portable）
npm run build:portable
```

打包完成后，安装包在 `release/` 目录：
- `任务管理器 Setup 1.0.0.exe` — 正式安装包
- `release/win-unpacked/任务管理器.exe` — 免安装版，可直接运行

---

## 📚 研究与设计文档

如果你当前更关心“为什么这样设计”，建议优先看这些文档：

- `docs/flowchart.md`：核心交互流程，理解计划、执行、反思三阶段如何串起来
- `docs/pilot-interview-outline.md`：3 天预实验后的访谈提纲
- `docs/pretest-p1-behavior-analysis.md`：P1（studentpretest01）预实验行为数据分析总结
- `docs/pretest-p2-behavior-analysis.md`：P2（user2）预实验行为数据分析总结
- `docs/chi-user-study-plan.md`：正式 user study 的研究结构与数据收集建议
- `docs/rq-data-analysis-mapping.md`：研究问题、数据和分析方向的对应关系
- `docs/entry-trigger-strategy.md`：针对 ADHD 用户“忘记或懒得打开主界面”的入口触发策略
- `docs/memory-plan.md`：三阶段原型中的 Memory 目标、类型与反思阶段设计思路
- `paper-writing/introduction-chi-draft.md`：论文写作用中文引言草稿

这次新增 `docs/entry-trigger-strategy.md` 的目的，是把一个重要风险说清楚：

- 当前原型已经较强地支持“打开后持续陪伴”
- 但还需要继续优化“用户没打开时，怎样把开始入口送到他面前”

---

## 📁 项目结构

```
├── src/
│   ├── main/
│   │   └── index.ts          # Electron 主进程（窗口管理、托盘、IPC）
│   ├── preload/
│   │   └── index.ts          # 预加载脚本（前后端通信桥梁）
│   └── renderer/
│       └── src/
│           ├── App.tsx        # 主应用组件（状态管理、布局）
│           ├── components/
│           │   ├── TitleBar.tsx    # 自定义标题栏
│           │   ├── AddTask.tsx     # 添加任务表单
│           │   ├── TaskItem.tsx    # 单个任务卡片（支持拖拽）
│           │   └── WidgetView.tsx  # 小组件置顶视图
│           ├── effects/            # 8种完成庆祝特效
│           │   ├── index.ts        # 特效调度中心（随机触发）
│           │   ├── confetti.ts     # 彩带爆炸（Canvas粒子）
│           │   ├── fireworks.ts    # 烟花绽放（Canvas粒子+拖尾）
│           │   ├── cracker.ts      # 爆竹火花（Canvas粒子）
│           │   ├── stars.ts        # 星星迸射（CSS动画）
│           │   ├── bubbles.ts      # 彩色泡泡（CSS动画）
│           │   ├── hearts.ts       # 爱心飞散（CSS动画）
│           │   ├── lightning.ts    # 闪电光环（CSS动画）
│           │   └── ripple.ts       # 彩虹波纹（CSS动画）
│           └── types/
│               └── index.ts        # TypeScript 类型定义
├── resources/
│   ├── icon.svg              # 源图标（SVG格式）
│   ├── icon.png              # 应用图标（512×512）
│   ├── icon.ico              # Windows图标（多尺寸）
│   └── tray-icon.png         # 托盘图标（32×32）
├── scripts/
│   └── generate-icons.mjs    # 图标生成脚本
├── electron.vite.config.ts   # electron-vite 构建配置
├── tailwind.config.js        # TailwindCSS 样式配置
└── package.json              # 项目依赖与打包配置
```

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^31 | 桌面应用框架 |
| React | ^18 | 前端UI框架 |
| TypeScript | ^5 | 类型安全 |
| Vite + electron-vite | ^2 | 构建工具 |
| TailwindCSS | ^3 | 样式框架 |
| @dnd-kit | latest | 拖拽排序 |
| electron-builder | ^24 | 打包发布 |

---

## 📦 数据存储位置

任务数据保存在本地，路径为：
```
C:\Users\{用户名}\AppData\Roaming\task-manager\tasks.json
```

---

## 🔮 后续可扩展功能

- [ ] 音效：勾选完成时播放轻柔的"叮~"声
- [ ] 任务分类/标签系统
- [ ] 截止日期与提醒功能
- [ ] 入口触发优化：静默常驻 + 托盘直接继续上次任务
- [ ] 轻量开始提醒：在合适时机提醒用户“先做第一步”
- [ ] 深色模式
- [ ] 数据导出（CSV / Markdown）
- [ ] 连续完成彩蛋（5秒内完成3个触发超级特效）

---

## 🛠️ 最近修复

- **2026-05-04**：
  - 优化反思 AI 的三步循环：开场只轻量解读 1 个图表事实和 1 个行为模式，不再一次性展开太多分析；底部 Tag 改为 AI 基于当天/本周行为模式与历史记录发现的“值得聊的小发现”，用户点击后再按该方向解读并追问 1 个开放式上下文问题；用户补充后，AI 再共情承接、对照数据并给出 1 个温和可行的低压力建议。
  - 进一步把反思洞察从“复述图表数字”改为“证据锚点 + 隐藏行为现象”：AI 不再把“完成率 100%”“没有待办”这类用户已能看到的信息当作主要内容，而是分析背后的任务管理过程，例如长期没碰的任务、活跃时段到底在做什么、计划里列了但没开始的事。Tag 也改为更完整、好理解的任务管理问题入口，例如“一直没碰的任务”“和昨天的差别”“活动最密的时间在做什么”，避免“活动最密的那段”“今天和昨天”这类没说完整的半截表达。
  - 修正反思 AI 的数据边界：每日反思 prompt 现在会额外注入“任务真实发生时间段”（由 `session.ended` 的结束时间和用时反推）和“应用使用时长摘要”，并明确要求 AI 不能用电脑活跃高峰反推任务完成时间；电脑活动图只说明电脑在用，具体在做什么要结合应用使用数据判断。
  - 涉及文件：`src/renderer/src/services/ai.ts`、`src/renderer/src/components/ReflectionChat.tsx`、`src/renderer/src/components/ReflectionView.tsx`。

- **2026-05-02**：
  - 每日反思提醒到点后，主界面底部「开启反思」按钮会显示一个小红点；红点会保留到用户点开反思为止，并用当天日期写入本地 `localStorage`，避免重启后当天提醒丢失。
  - 修复线上 Supabase 尚未添加 `profiles.plan_time` 列时，个人资料同步会反复失败的问题；现在会自动降级为先同步专业、年级、困难、场景和反思提醒时间，计划提醒时间继续保留在本地，等数据库列补齐后自动恢复云同步。
  - 去掉主界面标题栏的最小化按钮，并把右上角 `X` 改为“关闭界面，后台继续记录”：点击后只隐藏到系统托盘，不退出应用，活动记录、提醒和同步仍会继续运行；真正退出仍通过托盘右键菜单完成。
  - 优化执行中悬浮窗：开始任务后每次动态调整尺寸都会重新按屏幕宽度居中，避免从待命小组件变宽后视觉偏右；同时把执行态横向条高度从 `64px` 逐步降到 `52px`，宽度从 `620px` 压缩到 `560px`，压缩按钮和间距，减少对正在做任务的打扰。卡住对话、接力面板等需要阅读和输入的状态仍保留 `620px`。
  - 优化待命小组件：未开始任务时的常驻入口也统一为 `560×52` 低干扰横向条，和「完成这一步 / 完成主任务」执行条保持同高；任务名、下拉、开始、快速添加和展开按钮压缩到单行，长任务名通过 hover 查看完整内容。快速专注条也同步改为单行 `52px` 高度。
  - 进一步降低横向悬浮条视觉打扰：待命条、执行第一步条、完成主任务条和快速专注条默认使用 `bg-white/75`、更轻的边框与阴影；鼠标 hover 时恢复到 `bg-white/95` 和更清晰阴影，保证准备点击时仍然可读可操作。主按钮保持实色，任务名、暂停、卡住了等文字加深，避免透明后读不清。
  - 修复“设置半透明后看起来仍是纯白”的问题：Electron 窗口本身改为支持透明背景，小组件模式进入时切到透明背景，退出小组件时恢复主窗口白底；同时移除 widget 外层 React 容器的 `bg-white`，让横向条的半透明背景能真正透出后面的桌面内容。
  - 修复悬浮窗在当前屏幕中没有严格居中的问题：根因是 Windows 上 `setSize` 是异步的，先 `setSize` 再读 `getBounds()` 拿到的还是旧尺寸，导致按旧宽度居中。现在改为新增 `centerWidgetWindow(win, width, height)`，统一用传入的目标宽高、当前显示器 `workArea` 和原子化 `setBounds` 一次性设置位置和尺寸；进入小组件、动态调整尺寸和越界校验都共用这一套逻辑。
  - Widget「卡住了」AI 对话改为两轮式反思支持：先根据卡住原因粗分为任务理解、任务负荷、注意力、情绪/动力、情境事务冲突五类，首轮结合当前任务/当天计划/近期行为中的一个线索问白话开放问题，用户回复后第二轮不再追问，只给一个结合当前任务和用户回复的低压力建议。
  - 优化卡住对话的可读性和人情味：首轮问题保持开放，但例子最多只给 1 句、1 个具体例子，并必须和问题分段；数据线索只在能帮助用户理解卡住、降低自责、发现模式或做选择时使用。卡住消息支持空行短段、少量加粗和 `> 可以先这样试试` 灰色引用提示块；首轮优先加粗“用户要回答的焦点”，第二轮优先加粗动作或时间，避免回复变成一整段纯文字，同时减少命令感。卡住对话面板标题从“卡住急救对话”改为“聊一聊吧”。
  - 反思 AI 开场调整为三步循环：第一句先只解读当前图表和行为模式，不立刻追问；用户点击底部 3 个动态分析角度后，AI 会按该角度结合图表/行为记录做元认知分析，并在需要时问 1 个开放小问题；用户回答后再给 1 个低压力建议，并继续生成新的 3 个角度。标签改为更生活化的反思入口，例如“打开文档这个入口”“晚上更容易动起来”“计划和实际差很多”，避免“启动方式效果”这类偏研究感表达。
  - 涉及文件：`src/main/window.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/env.d.ts`、`src/main/sync.ts`、`src/renderer/src/services/ai.ts`、`src/renderer/src/services/tracker/types.ts`、`src/renderer/src/components/TitleBar.tsx`、`src/renderer/src/components/WidgetView.tsx`、`src/renderer/src/components/StandbyWidget.tsx`。

- **2026-05-01**：
  - 修复反思页任务用时 hover 联动电脑活动分布时，未闭合 session 会被拉到当前时间、导致短任务高亮几乎覆盖全天的问题；现在高亮分布统一使用 `session.ended.totalDurationSeconds` 反推时间段，和上方任务用时保持一致。
  - Widget 执行态改为低干扰横向任务条：窗口更宽但高度更低，任务与当前步骤在左侧成组展示，右侧集中放置计时、`暂停`、主按钮和 `卡住了?`；长任务名或第一步会截断但可通过 hover 查看完整内容。`完成这一步` / `完成主任务` 保持主按钮权重，执行态背景透明度和阴影也进一步降低，减少做任务时的视觉打扰。

- **2026-04-29**：
  - 启动第一步新增本地记忆推荐：用户反复输入或采用过的第一步会被保存，之后遇到相似任务时优先混入原有建议按钮中。
  - UI 不拆成“记忆推荐 / AI 推荐”两个区域，仍保持原来的第一步建议列表；记忆建议只在内部排序上更靠前，避免增加用户理解负担。
  - 记忆采用“最近 30 条或最近两周短期记录 + 稳定记忆”结构，重复出现的相似任务第一步会长期保留，并按最近使用时间、使用次数和接受次数衰减排序。
  - Widget「卡住了」对话升级为生产力导向的情绪支持：用户选择/输入原因后，AI 会主动开场，结合当前任务、当天计划、当前会话进度和近 7 天完成/卡顿数据，用自然短段落给出安抚、数据定位、30 秒下一步和备选计划调整。
  - 卡住急救回复支持轻量 Markdown 加粗，prompt 要求围绕具体卡住原因分流建议，例如“不知道去哪找信息”优先给找入口动作，“太复杂”优先给降复杂度动作，减少泛泛安慰。
  - 反思 AI 不再只复述图表：新增可用洞察线索，会按需结合当天内部模式、任务延续、卡顿恢复、用户画像、记忆或历史对比；历史对比不是必选，数据不足时不会强行讲长期规律。
  - 反思对话改为“先讲当前图表事实，再问开放小问题，再按用户上下文给低压力建议”，避免过早替用户下判断；开场会用空行拆成“问候 / 图表事实 / 观察到的模式 / 轻问题”四段，减少文字挤在一起的压力。
  - 反思 AI 进一步改为“图表引导的情境化反思”：每轮只锚定一个主图表，指出一个同主线的行为模式，再问一个轻问题获取用户上下文；用户回答后，AI 才结合数据和解释给策略建议与鼓励。
  - 反思聊天底部探索卡片收敛为单个“换一个角度看看”，作为切换反思方向的低压力出口；点击后 AI 会换到另一个有图表证据支持的行为模式，而不是继续追问当前话题。
  - 反思聊天中的 `chart:rhythm` 和 `chart:week-rhythm` 图表引用显示名从“节奏曲线”调整为“电脑活动”，减少用户理解成本；内部图表 ID 保持不变。
  - 涉及文件：`src/renderer/src/services/startup-memory.ts`、`src/renderer/src/components/StandbyWidget.tsx`、`src/renderer/src/components/FocusFlow.tsx`、`src/renderer/src/hooks/useFocusSession.ts`、`src/renderer/src/components/WidgetView.tsx`、`src/renderer/src/components/ReflectionView.tsx`、`src/renderer/src/services/ai.ts`、`src/main/storage.ts`。

- **2026-04-28**：
  - Widget「卡住了」第一阶段改造：用户输入卡住原因后，不再只看到一次性建议卡片，而是进入一个小型 AI 急救对话面板；AI 会先安抚情绪，再结合当前任务、当前步骤、当天任务列表和历史记忆给出更小的下一步，用户也可以继续追问“这个不适合”“换个更小的”等。
  - 该阶段保留「继续任务」出口，暂不做“用这个建议继续”、新增埋点、点赞点踩写入记忆等第二阶段能力，先用于验证对话式卡住支持是否真的能帮助用户重新动起来。
  - 涉及文件：`src/renderer/src/components/WidgetView.tsx`、`src/renderer/src/services/ai.ts`。
  - 修复线上 Supabase 尚未添加 `activity_records.app_usage` 列时，活动数据同步会反复失败的问题；现在会自动降级为只同步基础活跃度数据，等数据库列补齐后再恢复上传应用使用时长。
  - 优化 AI 流式请求的主进程日志：不再把中文 chunk 内容直接输出到终端，避免 Windows PowerShell 编码不一致时出现乱码刷屏。
  - 反思页切换日期或周时，右侧 AI 反思面板会保持当前展开/收起状态，只刷新对应日期/周的反思内容，减少布局跳动。
  - 修复历史日期没有任务完成率圆环图时，顶部三张指标卡片在右侧 AI 面板展开状态下会变成两列换行的问题；现在会继续保持一行三列。
  - 反思页「应用使用时长」默认从 Top 10 改为 Top 5，剩余应用仍可通过「展开剩余」查看，减少默认页面信息量。
  - 优化反思 AI 的日期和图表引用表达：历史日期开场会先显示具体日期（如 `4月27日`），编号洞察会把图表引用放在编号后；同时清理流式输出中的半截 `chart` / `SUGGESTIONS` 控制文本，避免乱码露出到聊天气泡或探索方向按钮。
  - 优化反思页切换日期的过渡体验：切换时左侧数据区会保留旧内容并显示轻量蒙层，新日期数据加载完成后再柔和淡入，避免页面白一下或图表突然跳动。
  - 修复第一步面板「跳过，直接开始」仍进入“开始做/完成这一步”确认阶段的问题；现在跳过会直接进入主任务执行视图，但仍保留 `source: skip` 的第一步行为记录。
  - 涉及文件：`src/main/sync.ts`、`src/main/index.ts`、`src/renderer/src/components/ReflectionView.tsx`、`src/renderer/src/components/ReflectionChat.tsx`、`src/renderer/src/services/ai.ts`、`src/renderer/src/hooks/useFocusSession.ts`。

- **2026-04-27（夜）**：
  - 优化反思 AI 回复的可读性：提示词要求回复按 `1️⃣ / 2️⃣ / 3️⃣` 短块分段，每块 1-2 句，避免把多个数据点挤在同一段里。
  - 关键时间、比例和时长会用 Markdown 加粗输出，例如 `**14点**`、`**73%**`、`**79分钟**`，聊天气泡已支持渲染这类加粗文本。
  - 进一步改为轻约束格式：只有多个信息点时才使用编号，不强制每次写满 3 点；AI 可用单行 `>` 引用块呈现“可以先记住一点”的轻总结，前端会渲染为左侧浅色细线旁注。
  - 涉及文件：`src/renderer/src/services/ai.ts`、`src/renderer/src/components/ReflectionChat.tsx`。

- **2026-04-27（晚）**：
  - 反思页「任务用时」标题右侧新增「显示全部分布」按钮，可一键在下方电脑活动热力图中显示当天所有任务的专注时间段。
  - 该模式沿用原本 hover 单个任务的时间比例高亮逻辑：例如某任务发生在 14:40–15:00，会显示在 14 点格子的后 1/3，不额外引入多色或分层轨道。
  - 鼠标悬停在全部分布里的蓝色时间段时，会显示对应任务名称和该段时间，方便用户把时间块和具体任务对上。
  - 涉及文件：`src/renderer/src/components/ReflectionView.tsx`、`src/renderer/src/components/InteractiveActivityHeatmap.tsx`。

- **2026-04-27**：
  - 反思页「补记任务」的开始/结束时间从 15 分钟下拉档位改为分钟级时间输入，可直接填写如 `09:07`、`10:42` 这类更精确的时间。
  - 修改开始时间时会自动保持原时长并平移结束时间，减少用户为了补准时间而重复调整两次的负担。
  - 涉及文件：`src/renderer/src/components/ManualTimeEntry.tsx`。

- **2026-04-25（晚）**：新增「应用使用时长采集」（研究项目，默认开启，无开关）
  - 反思页在「电脑活动分布」之后新增「📱 应用使用时长」模块，按使用时长降序展示当天 Top 10 应用，超过 10 个可展开。展示精度：≥ 60 秒按分钟整数显示（如「12 分钟」）；< 60 秒显示「< 1 分钟」。
  - 采集机制：复用现有 `[ActivitySampler]` 架构（每 2 秒采样、每 30 秒聚合、每 5 分钟刷盘）。每次采样调用 [`get-windows`](https://www.npmjs.com/package/get-windows) v9 拿到当前前台应用名，仅在「活跃」状态下记录（屏保/锁屏期间不记），按 30 秒聚合块累加。
  - 过滤规则：排除 MetaPlan/开发原型自身（如 `Electron`、`MetaPlan`）以及常见系统工具（如资源管理器、Windows Terminal、PowerShell、CMD），避免把启动/调试工具误算成正式应用使用。
  - 数据结构：`ActivityRecord` 新增 `appUsage?: Record<string, number>` 字段，值是该应用在 30 秒窗口内被采到的次数（次数 × 2 ≈ 秒数）。Supabase `activity_records` 表新增 `app_usage jsonb` 列（已写入 `supabase-schema.sql`，老库会自动 `ADD COLUMN IF NOT EXISTS`）。
  - 隐私与数据：仅记录应用名（如「Google Chrome」「微信」），**不记录窗口标题、不记录文件名/网址**。本地 JSON 与 Supabase 同步策略与现有 activity 数据一致，使用 RLS 行级安全策略。
  - 容错：`get-windows` 是原生模块，依赖 prebuilt binary。任何加载或调用失败都会被静默捕获并打一次警告（`[ActivitySampler] get-windows unavailable`），主功能（idle 采样）不受影响。
  - 涉及文件：`src/main/storage.ts`（核心）、`src/main/sync.ts`、`src/renderer/src/components/ActivityHeatmap.tsx`（接口扩展）、`src/renderer/src/components/AppUsageRanking.tsx`（新组件）、`src/renderer/src/components/ReflectionView.tsx`（集成）、`supabase-schema.sql`、`package.json`。

- **2026-04-25**：
  - 个人资料新增「每日计划提醒时间」（在反思提醒前面）。设置后每天到点会通过系统通知提醒用户为今天列计划，文案随机从 7 套不同 emoji + 文案中挑选，避免每天提醒长一样。点击通知会唤起主窗口。
  - 去掉「每日反思提醒时间」旁边的「(可选)」字样。
  - 涉及：`UserProfile` 类型新增 `planTime`、`ProfileSettings` UI、主进程 `startPlanTimer/checkPlanTime`、Supabase `profiles` 表新增 `plan_time` 列（已写入 `supabase-schema.sql`，老库会自动 `ADD COLUMN IF NOT EXISTS`，无需重建表）。

- **2026-04-19**：
  - 修复在底部输入框 + Tab 缩进模式下添加子任务时，子任务会错误挂到「已完成区最后一条任务」下的问题；
    改为挂到「最后一条未完成任务」，符合视觉直觉。涉及 `src/renderer/src/components/NoteEditor.tsx`。
  - 取消小组件「位置记忆」：每次进入小组件都强制位于屏幕顶部中间，避免之前拖动过导致下次开启位置不确定。
    涉及 `src/main/window.ts`。

## 📦 打包小贴士

- 默认输出目录是 `release/`，但如果之前装过 `MetaPlan` 且有正在运行的实例，可能会锁住 `release/win-unpacked/resources/app.asar` 导致打包失败。
- 解决办法二选一：
  1. 任务栏托盘右键退出 MetaPlan 后再 `npm run build:win`
  2. 或者用替代输出目录：
     ```bash
     npx electron-builder --win --config.directories.output=release2
     ```

---

## 📄 License

MIT
