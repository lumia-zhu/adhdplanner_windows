# Findings 主题方向指南

本文档记录对论文 Findings 主题的思考，帮助在访谈分析时辨别"有意思"和"没意思"的主题。

---

## 什么样的主题是好的？

好的 CHI 质性研究主题应该具备：

1. **揭示了一个张力/矛盾**（不是简单的"有用/没用"）
2. **和 ADHD 的独特体验相关**（不是所有人都会有的感受）
3. **对设计有具体启示**（不是泛泛而谈的"AI 要做得更好"）

标准：好的主题让读者觉得"原来是这样"，而不是"嗯，意料之中"。

---

## 不够好的主题示例

### ❌ "AI 帮助降低了启动阻力"

**问题**：等于在说"AI 有用"——这是 expected finding。做了一个 AI 工具然后发现 AI 有用，没有信息量。没有回答关于 ADHD 体验或元认知过程的深层问题。

### ❌ "卡住功能的双刃剑效应"

**问题**："双刃剑"太笼统，几乎什么功能都可以这么说。包装成"双刃剑"会把本来有趣的发现变平。

---

## 更有意思的方向（待访谈验证）

### 方向 1：外部确认 vs 能力信号

AI 给的"小到不可能失败"的第一步，有些参与者觉得被低估了。但另一些参与者依赖 AI 建议不是因为不知道做什么，而是需要一个"外部确认"来消除犹豫。这触及了 ADHD 特有的"决策瘫痪"与"外部锚定"的关系。

**Design implication**：scaffolding 的"粒度"和用户自主感之间需要协商。

### 方向 2："卡住"按钮合法化了暂停

卡住按钮的真正价值可能不是 AI 的建议内容，而是它**合法化了"我可以暂停"**。对 ADHD 用户来说，承认自己卡住本身就是一个元认知突破，因为很多人的模式是"卡住 → 自责 → 逃避"。

相关现象：
- 有些参与者不愿意点"卡住"，因为等于承认失败 → 情绪与元认知监控之间的冲突
- AI 建议被 👎 的原因可能不是质量差，而是参与者其实知道该怎么做，卡住的根本原因是"不想做"而非"不知道做什么" → 触及执行功能缺陷与元认知工具能力边界的问题

### 方向 3：元认知脚手架被用作情绪调节工具

ADHD 用户可能把反思对话当作倾诉对象，而非分析工具——偏离了设计意图但可能同样有价值。

**Design implication**：是否应该拥抱这种"偏离"？情绪调节本身是否也是元认知的一部分？

### 方向 4：数据可视化引发自我认知冲突

"我以为我什么都没做" vs 数据说你做了 2 小时——这种冲突如何被 ADHD 用户处理？是感到安慰（"原来我没那么糟"）还是困惑（"为什么我的感受和数据不一样"）？

**Design implication**：数据呈现方式如何影响 ADHD 用户的自我效能感？

### 方向 5：外部结构化 vs 自主感的协商

AI 规划了步骤但用户想按自己的方式来。scaffolding 什么时候从"支持"变成了"束缚"？

### 方向 6：工具使用本身成为拖延方式

有人可能花大量时间规划任务和拆分步骤，反而没有执行——scaffolding 如何无意间助长了回避行为？

### 方向 7：启动 vs 维持的不对称

启动变容易了（计划阶段的 scaffolding 有效），但中途的注意力维持并没有改善（监控阶段的缺口）。说明 metacognitive scaffolding 的效果边界。

---

## 行为数据如何配合这些主题

行为数据的角色是**佐证**，不是主角：

```
1. 先从访谈中分析出主题（thematic analysis）
2. 确定主题后，回到行为数据找对应的量化支撑
3. 在 Findings 中：访谈引用为主 + 行为数据为辅
```

### 佐证示例

假设主题是"卡住按钮合法化了暂停"：

> Nine participants described the stuck button as "permission to stop," rather than a help-seeking mechanism. Behavioral logs corroborated this: 78% of stuck episodes ended with the participant continuing the task rather than abandoning it, regardless of whether they rated the AI suggestions positively (52%) or negatively (48%), suggesting that the reflective pause—rather than the specific advice—served as the primary regulatory mechanism.

假设主题是"数据引发自我认知冲突"：

> Participants who discussed time perception correction in interviews (n=9) engaged in notably longer reflection conversations (M=8.3 user messages per session) compared to those who did not (M=3.7), suggesting that confronting the gap between perceived and actual productivity prompted deeper reflective engagement.

---

## 提醒

- 以上方向都是**假设**，真正的主题必须从访谈数据中涌现
- 不要带着预设的主题去做访谈分析，但可以在分析时用这些方向检验自己的发现是否足够深入
- 如果访谈中发现了完全意料之外的主题，那往往是最好的发现
