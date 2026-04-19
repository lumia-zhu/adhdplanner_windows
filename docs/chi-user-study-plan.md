# CHI User Study Plan

## 研究定位

本研究采用 `Research through Design (RtD)` 视角，将原型作为研究载体，而非最终贡献本身。核心关注点是：

- `GenAI metacognitive scaffolding` 如何进入 ADHD 人群的日常任务管理实践
- 用户如何体验、调用、理解并协商这种支架
- 这些日常使用经验会为未来设计揭示哪些关键原则与边界

本研究更适合做 `qualitative-dominant mixed-methods field study`，而不是一次性的实验室 A/B 测试。

## 当前研究问题

### RQ1

**How do individuals with ADHD experience GenAI metacognitive scaffolding across planning, executing, and reflecting on everyday tasks?**

### RQ2

**What design principles and boundaries for GenAI metacognitive scaffolding emerge from its everyday use by individuals with ADHD?**

### Framing 说明

本研究沿用前作（CHI 2026 _Scaffolding Metacognition with GenAI_）建立的**漏斗式 framing**：

- RQ 层用 `individuals with ADHD`，保持研究议程的连贯性
- Sample 层仍为 `university students with ADHD`（12-16 人），在 intro 通过 bridging sentence 收窄
- Findings 的 claim 主语是 `our participants` 或 `university students with ADHD`
- Discussion 可以在明确标注下把设计启示扩回 `individuals with ADHD` 或 `neurodivergent populations`

RQ1 聚焦"**体验**"——在 `planning / execution / reflection` 三阶段中用户如何感受、调用、协商 GenAI 元认知支架。RQ2 聚焦"**提炼**"——从真实日常使用里涌现出的设计原则与边界（`principles` 指向"什么值得做"，`boundaries` 指向"什么必须克制"）。

## 推荐研究结构

建议采用：

- `Pilot + Longitudinal Field Deployment + Mixed Methods`

推荐周期：

- `Pilot`: 3-5 天
- `Main Study`: 2 周

推荐样本：

- `12-16` 位 university students with ADHD（sample 层收窄，与前作 CHI 2026 口径一致）

## User Study 流程概览

1. `Pilot`
2. `Recruitment & Screening`
3. `Pre-study Session`
4. `Short Baseline Period`
5. `2-week In-the-wild Deployment`
6. `Daily / Event-based Micro Check-ins`
7. `Post-study Interview with Trace Elicitation`
8. `Cross-case Analysis and Design Implications`

## 各阶段细节与原因

### 1. Pilot

目标：

- 检查原型稳定性
- 检查日志是否完整
- 检查 `focus / stuck / reflection` 三类关键模块是否都能被自然触发
- 检查 check-in 负担是否过高

为什么这样做：

- ADHD 参与者对系统复杂度和研究负担更敏感
- 预试验可以提前暴露技术问题、流程问题和提示频率问题

### 2. Recruitment & Screening

建议招募对象：

- 正式 ADHD 诊断者（university students）
- 或经过 ASRS / 其他筛查工具筛选的自我认同 ADHD university students

建议记录背景：

- 年龄、年级、专业
- ADHD 诊断或筛查情况
- 当前任务管理方式
- 常见困难情境：启动难、做到一半卡住、难以回顾、频繁切换等

为什么这样做：

- 为后续解释不同使用模式提供背景
- 提高样本与研究问题的匹配度
- 与前作 CHI 2026 的招募标准保持一致，便于研究线索延续

### 3. Pre-study Session

内容包括：

- 知情同意
- 前访谈：了解原有任务管理实践
- 安装与 onboarding
- 介绍 `focus / stuck / reflection` 的基本用法

为什么这样做：

- 避免后续数据被“不会用系统”干扰
- 同时避免过度引导，保留真实使用空间

### 4. Short Baseline Period

建议时长：

- `1-3` 天

可选方式：

- 按原有习惯管理任务
- 或只开放基础任务管理功能，不开放 AI 支架功能

为什么这样做：

- 获取“原本任务实践”的简短参照
- 帮助后续理解引入支架后发生了什么变化

### 5. 2-week In-the-wild Deployment

部署要求：

- 参与者在真实学习/工作场景中自然使用原型
- 不要求每天固定完成多少任务
- 可自由使用 `quick focus`、`stuck`、`reflection`

为什么这样做：

- 任务启动、卡住、回看都高度依赖真实情境
- 一次性的实验室任务很难真实体现 ADHD 场景中的任务实践

### 6. Daily / Event-based Micro Check-ins

形式建议：

- 每天一次超短 check-in
- 或在关键事件后触发超短反馈

建议控制：

- 每次 `1-3` 个问题
- 总时长尽量控制在 `1 分钟` 左右

为什么这样做：

- 日志能告诉我们“发生了什么”
- 短反馈补充“用户当时怎么理解、为什么这么做”

建议补充一类与入口触发相关的超短问题：

- 当天如果一次都没打开原型，可以问：`你今天有没有某个本来适合开始任务，但没有打开工具的时刻？当时为什么没有打开？`
- 如果未来加入托盘、通知或小组件待命入口，可以在事件后问：`你刚才为什么会从这个入口开始？它是更省事，还是只是刚好出现？`
- 如果未来加入开始提醒，可以在提醒后问：`这次提醒更像帮助你开始，还是更像打断你？`

这样做的原因：

- 当前原型的关键风险之一，是帮助出现得太晚，用户在最需要的时候根本没打开系统
- 入口触发是否自然，本身就是 ADHD 场景里非常重要的设计问题
- 这类问题很适合用超短 self-report 补日志看不到的主观感受

### 7. Post-study Interview with Trace Elicitation

建议内容：

- 结合日志、可视化、AI 对话痕迹回顾真实使用片段
- 讨论何时调用支架、何时忽略、何时拒绝
- 讨论哪些支持让用户感到被帮助，哪些时刻感到被打扰、被误解或无用

为什么这样做：

- 能避免纯回忆式访谈的模糊问题
- 非常适合回答“如何理解、采纳、协商 AI 支持”

### 8. Cross-case Analysis and Design Implications

分析目标：

- 归纳典型使用路径
- 提炼支架被调用的关键情境
- 总结用户与支架之间的协商方式
- 提炼设计原则、边界和负面案例

为什么这样做：

- 研究贡献不在原型本身，而在交互范式及其设计启示

## 需要收集的数据类型

### 1. 背景数据

- ADHD 诊断或筛查背景
- 基本人口信息（年龄、年级、专业）
- 原有任务管理习惯

用途：

- 描述样本
- 解释不同案例之间的差异

### 2. 系统行为日志

建议记录：

- 任务创建、开始、完成
- `quick focus` 进入/退出
- `stuck` 模块调用时间、频次、停留时长
- `reflection` 页面访问及相关交互
- 模块切换路径

用途：

- 说明用户如何在日常实践中实际使用原型
- 支撑 `RQ1`

### 3. AI 互动内容与交互痕迹

建议记录：

- 用户在 `stuck` 模块中输入的困难描述
- AI 返回内容
- 是否继续追问、是否退出、是否忽略
- 反思模块中可视化查看与 AI 反思对话痕迹

用途：

- 分析用户如何理解、采纳、调整或拒绝 AI 支持
- 重点支撑 `RQ2`

### 4. Daily / Event-based Self-report

建议记录：

- 当天是否使用原型
- 哪个时刻最有帮助
- 哪个时刻最没帮助
- 是否帮助开始、继续或回顾任务

用途：

- 补足日志无法直接体现的主观体验

### 5. Pre / Post Interviews

研究前访谈：

- 了解原有实践、困难情境和对 AI 的期待

研究后访谈：

- 结合真实痕迹做回顾式讨论
- 分析使用方式、意义建构、采纳/拒绝机制和设计边界

用途：

- 回答 `RQ1`（体验与互动）
- 并最终提炼 `RQ2`（设计原则与边界）

## 数据与研究问题对应关系

### RQ1

**How do individuals with ADHD experience GenAI metacognitive scaffolding across planning, executing, and reflecting on everyday tasks?**

重点数据：

- 系统行为日志（覆盖三阶段的调用、频次、路径）
- AI 互动内容与交互痕迹（包括采纳、修改、忽略、拒绝）
- daily / event-based self-report
- post-study interviews + trace elicitation

文章中可回答：

- 支架在 `planning / execution / reflection` 三阶段分别如何进入任务实践
- 用户何时主动调用、何时接受/修改/忽略/拒绝
- 用户如何理解和协商 AI 支架的角色
- 跨时间是否形成新的使用方式或节奏

### RQ2

**What design principles and boundaries for GenAI metacognitive scaffolding emerge from its everyday use by individuals with ADHD?**

重点数据：

- 跨案例主题分析
- 研究后访谈
- 负面案例与中断使用案例
- ADHD 专家反馈（可选但推荐，用于强化 boundaries 部分）

文章中可回答：

- 有效支架应出现在哪些时刻、什么形态（principles）
- 哪些交互方式更容易被接受、更贴合 ADHD 用户
- 哪些边界、风险与负担需要被控制（boundaries）
- 在真实日常部署里，哪些 AI 介入被用户理解为"帮助"，哪些被理解为"打扰"

## CHI 风格上的关键注意点

- 不把研究写成单纯的“AI 是否有效”
- 强调 `in-the-wild` 与 `ecological validity`
- 使用 `logs + self-report + interviews` 做三角互证
- 主动报告负面案例、拒绝使用、疲劳和边界
- 将原型定位为 `research artifact`
- 将最终贡献落在：
  - individuals with ADHD 在三阶段任务实践中的真实使用经验（RQ1）
  - GenAI metacognitive scaffolding 的设计原则与边界（RQ2）
  - 面向 neurodivergent populations 的更广研究议程

## 相关文档

- [行为数据在论文中的呈现框架](./behavioral-data-presentation.md)：行为日志的定位、用法和呈现建议
- [RQ 与数据分析方向对照](./rq-data-analysis-mapping.md)：RQ 对应的数据收集与分析方向详表
- [Related Work 结构框架](./related-work-structure.md)：三个小节的划分、内部逻辑和节奏设计

---

## 下一步可继续展开的部分

后续可以在这份文档基础上继续补充：

- `招募标准与样本量说明`
- `daily check-in 具体问题`
- `event-triggered prompt 具体问题`
- `日志字段表`
- `pre/post interview 提纲`
- `methods` 章节写法
- `design implications` 框架

---

## 参考文档索引

- [行为数据呈现框架](behavioral-data-presentation.md) — 行为数据在论文中的定位、用法和呈现建议
- [Related Work 结构](related-work-structure.md) — 三部分结构及内在逻辑
- [Findings 主题方向指南](findings-theme-guide.md) — **注意：仅为潜在的有意思的研究方向，不是已有数据得出的结论。** 实际主题需从访谈数据中涌现，此文档仅供分析时参考对照
- [预实验量表方案](pilot-study-measures.md) — 5 天预实验的量表设计（MAI-19 + SESRL + 每日微问卷），正式实验方案可能基于预实验结果调整
