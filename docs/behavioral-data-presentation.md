# 行为数据在论文中的呈现框架

本文档整理行为日志数据在 CHI 论文（定性主导）中的定位、用法和呈现建议。

---

## 核心定位：行为数据是"素材"，不是"指标"

本研究是定性主导的，行为数据不需要像定量研究那样有精心设计的指标体系。行为数据的三个用途：

1. **描述性概览**：让读者知道参与者用了多少（Findings 开头）
2. **Trace elicitation 素材**：为每个参与者生成个性化的访谈追问（访谈前准备）
3. **主题的行为佐证**：访谈主题确定后，回到行为数据找量化支撑（写 Findings 时）

顺序是：先有主题，再找行为佐证——而不是先定指标，再找主题。

### 关于解释的诚实性

- 行为数据只能回答"发生了什么"，不能回答"为什么"
- UI 便利性会混淆解释：用户点 AI tag 而非自己打字，可能只是点击比打字方便，不能解读为"依赖 AI"或"未内化"
- 涉及 AI 建议来源（ai_chip vs self）的数据，应避免做依赖/内化方向的推断

---

## 用途一：描述性概览

### 参与者概况表（Table 1）

每行一个参与者（P1 ~ P20），只需四个描述性数字：

| 列 | 计算方式 | 作用 |
|----|---------|------|
| 活跃天数（/14） | 有 `session.started` 或 `reflect.opened` 的天数 | 区分"坚持用户"和"试了就走" |
| 专注 session 数 | `session.started` 计数 | 使用强度 |
| 反思 session 数 | `reflect.ended` 且 `hadEndedProperly = true` | 反思功能真实使用量 |
| 卡住次数 | `stuck.triggered` 计数 | 卡住功能的使用频率 |

配一段话描述整体概况即可。这些数字的作用是**区分参与者**，为后面引用个别参与者提供背景，也为参与者分型提供依据。

### 使用热力图（Figure 1）

- X 轴：Day 1 ~ Day 14
- Y 轴：P1 ~ P20（按总使用量排序）
- 颜色深浅 = 当天参与深度
- 叠加标记：● = 完成反思，○ = 打开但没完成

一张图同时传达：
1. 每个人的使用密度和持续性
2. 反思功能的参与模式
3. 整体是否有使用衰减

可引出参与者分型："We observed three distinct engagement patterns: sustained engagers, selective users, and early dropoffs."

---

## 用途二：Trace Elicitation 素材（行为数据最大的价值）

行为日志最大的价值不是算比例，而是**为每个参与者生成个性化的访谈追问**。

### 做法

访谈前，为每位参与者从 14 天的日志中提取 3-5 个值得追问的行为模式：

### 可提取的模式类型

**使用频率变化**
- "你第一周每天都反思，第二周只反思了一次，发生了什么？"
- "你最后三天完全没打开工具，那几天是什么情况？"

**特定功能的使用/不使用**
- "你几乎从来没用过 AI 建议的第一步，都是自己写的，为什么？"
- "你从来没点过卡住按钮，遇到困难的时候你是怎么处理的？"

**具体事件的回顾**
- "3 月 15 号你卡住了两次，都是在写论文的任务上，你还记得当时的情况吗？"
- "你有一次反思聊了 12 轮，那次是在聊什么？"

**打开但没用**
- "你有 5 天打开了工具但没开始任何专注，那几天是什么情况？"
- "你打开过反思页面但没有开始对话就关掉了，当时是怎么想的？"

这些不是标准化的问题，每个参与者的追问都不一样——这正是行为数据在定性研究中最有力的用法。

---

## 用途三：主题的行为佐证

### 做法

先完成访谈的主题分析（thematic analysis），得出 themes 后，再回到行为数据中寻找支撑。

### 示例

假设访谈分析得出的主题是"反思帮助用户发现自己的时间感知偏差"：

> Twelve of the 15 participants who discussed time perception also engaged in reflection conversations averaging over 6 turns, compared to 2-3 turns among those who did not mention this theme, suggesting deeper reflection engagement may facilitate temporal self-awareness.

假设主题是"脚手架在启动阶段最被需要"：

> Participants who described startup difficulty as their primary challenge (n=11) used the planning scaffolding on 82% of their sessions, compared to 45% among others, and were more likely to sustain usage into week 2.

这种"先有主题，再找行为佐证"的顺序比"先定指标，再找主题"要自然得多。行为数据在这里的角色是**三角互证**（triangulation），不是独立的分析层。

---

## 参与者分型

可以用概况表中的描述性数字做简单分型，在 Findings 开头建立。后续每个主题用不同类型参与者的引用展示差异。

可能的分型（待实际数据确认）：

- **持续投入型**：活跃天数高 + 反思多 + 各功能均有使用
- **选择性使用型**：活跃天数高但只用专注计时，很少用反思或卡住功能
- **浅层/衰减型**：前几天活跃，后期明显下降

具体分型需要等实际数据聚类确定。

---

## 系统已有的行为事件（参考）

完整事件类型定义见 `src/renderer/src/services/tracker/types.ts`。

按与论文的相关度分层：

### 高相关：会出现在概况表或 trace elicitation 中

- `session.started` / `session.ended` / `session.paused` / `session.resumed`
- `stuck.triggered` / `stuck.reason`
- `reflect.opened` / `reflect.message_sent` / `reflect.ended` / `reflect.closed`
- `plan.first_micro` / `plan.scaffold_skipped`
- `abandon.exit`
- `task.created` / `task.toggled`

### 中相关：可能作为主题佐证

- `exec.flow_entered` / `exec.flow_ended`（心流体验）
- `stuck.hint_feedback_clicked`（AI 建议反馈）
- `stuck.reflection_shown`（AI 即时反思）
- `exec.micro_started` / `exec.micro_completed`（微步轨迹）
- `memory.opened`（记忆系统交互）

### 低相关：一般不需要分析

- `task.reordered` / `task.edited` / `task.priority_changed`
- `nav.date_changed`
- `settings.saved` / `auth.login` / `app.launched`
- `mode.widget_entered` / `mode.widget_expanded`

---

## Method 部分写法建议

Data Analysis 小节参考：

> "All user interactions with the system were logged as timestamped events, including task creation, focus sessions, stuck events, and reflection conversations. Prior to each post-study interview, we reviewed each participant's behavioral logs to identify notable patterns—such as changes in usage frequency, specific stuck events, or shifts in reflection engagement—which served as trace elicitation prompts during the interviews. Aggregate behavioral data was used descriptively to contextualize participants and support qualitative themes."

---

## Findings 结构建议

```
5. Findings
   5.1 Usage Overview
       → 1 段话 + Table 1 + Figure 1
       → 整体使用情况、参与者差异和分型
   
   5.2 Theme 1: ...（来自访谈的主题分析）
       → 穿插引用行为数据作为佐证
   
   5.3 Theme 2: ...
   
   5.4 Theme 3: ...
   
   （行为数据不单独成一节，融入各主题中）
```
