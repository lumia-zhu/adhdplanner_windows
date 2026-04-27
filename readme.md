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
