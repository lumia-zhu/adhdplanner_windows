# ADHD Planner 核心交互流程图

> 工具的完整使用流程分为三个阶段：**计划 → 执行 → 反思**

---

## 🔄 总览流程

```mermaid
flowchart TD
    START([用户打开应用]) --> MAIN[📝 主界面：记事本式任务编辑器]

    MAIN -->|"写下任务 + 按 Enter"| PLAN[🎯 计划阶段]
    PLAN --> EXEC[⚡ 执行阶段]
    EXEC --> REFLECT[💡 反思阶段]
    REFLECT -->|"下一天"| MAIN

    style PLAN fill:#E8F5E9,stroke:#4CAF50,stroke-width:2px
    style EXEC fill:#E3F2FD,stroke:#2196F3,stroke-width:2px
    style REFLECT fill:#FFF8E1,stroke:#FFC107,stroke-width:2px
```

---

## 📋 阶段一：计划（Planning）

> **核心思路**：用户像写笔记一样快速列出任务，按 Tab 缩进即可创建子任务

```mermaid
flowchart TD
    M[📝 主界面] --> INPUT["输入任务标题 + Enter"]
    INPUT --> TASK[创建新任务行]
    TASK -->|"按 Tab"| SUB[缩进为子任务]
    TASK -->|"继续 Enter"| INPUT

    TASK --> PRIORITY["点击圆点切换优先级<br/>低(灰) → 中(蓝) → 高(红)"]
    TASK --> DRAG["拖拽把手调整顺序"]
    TASK --> EDIT["双击文字直接编辑"]

    M --> START_BTN["点击底部「▶ 开启任务」"]
    TASK -->|"点击任务行的 ▶"| START_BTN

    START_BTN --> FOCUS_FLOW["🎯 FocusFlow 弹窗<br/>（元认知拦截层）"]

    FOCUS_FLOW --> QUESTION["提问：你现在的<br/>第一个极其具体的物理动作是？"]
    QUESTION --> AI_CHIPS["AI 自动生成 2 个微动作建议<br/>例如：打开空白文档…"]

    AI_CHIPS -->|"点击 AI 建议"| CONFIRM["确认微任务"]
    QUESTION -->|"自己输入 + Enter"| CONFIRM

    CONFIRM --> GO_EXEC["✅ 进入执行阶段"]

    style FOCUS_FLOW fill:#E8F5E9,stroke:#4CAF50,stroke-width:2px
    style GO_EXEC fill:#C8E6C9,stroke:#388E3C,stroke-width:2px
```

**关键点**：
- 「元认知拦截」= 强制用户把模糊的大任务拆成一个极小的第一步
- AI 提供建议降低启动门槛，用户也可以自己输入

---

## ⚡ 阶段二：执行（Execution）

> **核心思路**：窗口缩为置顶小条，一步步微任务接力推进，遇到卡壳有 AI 急救

```mermaid
flowchart TD
    ENTER["进入执行"] --> BAR["🎯 置顶小条（Dynamic Bar）<br/>显示：微任务名 + 计时器"]

    BAR -->|"点击 ✓ 完成"| RELAY["🔄 接力面板<br/>提问：紧接着的一个动作是？"]
    BAR -->|"点击 🆘 卡住了"| STUCK_A["🆘 急救面板A<br/>AI 分析卡点原因"]

    %% 接力循环
    RELAY --> AI_NEXT["AI 生成下一步建议"]
    AI_NEXT -->|"选择建议 / 自己输入"| BAR
    RELAY -->|"点击「🚀 我有感觉了，直接做」"| FLOW["🚀 心流模式<br/>只显示宏观任务名 + 计时"]

    %% 心流
    FLOW -->|"点击 ✓ 完成"| DONE["🎉 任务完成！<br/>自动标记 + 庆祝特效"]
    DONE --> EXIT_WIDGET["退出小组件<br/>回到主界面"]

    %% 急救流程
    STUCK_A --> STUCK_CHIPS["AI 预测卡点原因<br/>例如：不知道从哪开始 / 信息不够"]
    STUCK_CHIPS -->|"选择原因 / 自己输入"| STUCK_B["💙 急救面板B<br/>AI 表达同理心 + 提供绕路方案"]

    STUCK_B --> PIVOT_CHIPS["AI 建议替代微动作<br/>例如：先看个相关视频找感觉"]
    PIVOT_CHIPS -->|"选择新动作 / 自己输入"| BAR
    STUCK_B -->|"没事，我继续原来的"| BAR

    %% 退出
    BAR -->|"点击 ✕ 退出"| EXIT_WIDGET

    style BAR fill:#E3F2FD,stroke:#2196F3,stroke-width:2px
    style FLOW fill:#EDE7F6,stroke:#7C4DFF,stroke-width:2px
    style STUCK_A fill:#FFF3E0,stroke:#FF9800,stroke-width:2px
    style STUCK_B fill:#E3F2FD,stroke:#42A5F5,stroke-width:2px
    style DONE fill:#C8E6C9,stroke:#388E3C,stroke-width:2px
```

**关键点**：
- 执行阶段窗口缩为**置顶薄条**，始终浮在其他窗口之上，不打扰又随时可见
- **微任务接力**：完成一步就让你趁热打铁输入下一步，形成正向循环
- **急救机制**：卡住时不是催你"快做"，而是帮你分析原因、换条路走
- **心流入口**：连续完成几步后，一键切换心流模式，不再打断

---

## 💡 阶段三：反思（Reflection）

> **核心思路**：一天结束后，左看数据、右跟 AI 聊天，轻松完成复盘

```mermaid
flowchart TD
    ENTRY["点击标题栏 💡 开启每日反思"] --> LOAD["加载今日行为数据<br/>（所有埋点事件）"]

    LOAD --> VIEW["📊 反思主界面（双列布局）"]

    VIEW --> LEFT["⬅ 左侧：数据可视化"]
    VIEW --> RIGHT["➡ 右侧：AI 反思对话"]

    LEFT --> DONUT["🍩 圆环图<br/>任务完成率百分比"]
    LEFT --> STATS["📈 快捷统计<br/>微步完成数 / 心流时长<br/>总专注分钟 / 卡顿次数"]
    LEFT --> TIMELINE["📅 一日时间轴<br/>按时间顺序展示：<br/>✅ 已完成微任务<br/>🔥 心流记录<br/>🆘 卡顿时刻<br/>❌ 放弃记录"]

    RIGHT --> STEP1["Step 1 寻亮点 ✨<br/>AI：今天哪里做得好？<br/>（结合完成率数据破冰）"]
    STEP1 -->|"用户回答"| STEP2["Step 2 找改进 🔍<br/>AI：哪里卡壳了？<br/>（结合时间轴中的卡顿/空白）"]
    STEP2 -->|"用户回答"| STEP3["Step 3 定策略 🎯<br/>AI：明天准备怎么改进？"]
    STEP3 -->|"用户回答"| SUMMARY["Step 4 生成总结卡片"]

    SUMMARY --> CARD["📋 今日结算卡片<br/>─────────────<br/>🏆 今日MVP操作<br/>👾 遭遇的拦路虎<br/>🎒 AI补充的新装备<br/>   （一个实用效率技巧）<br/>🔋 状态补给<br/>   （无条件鼓励 + 激励语）"]

    CARD --> DONE_R["✅ 反思完成！<br/>关闭回到主界面"]

    style VIEW fill:#FFF8E1,stroke:#FFC107,stroke-width:2px
    style CARD fill:#FFFDE7,stroke:#FFD54F,stroke-width:2px
    style SUMMARY fill:#FFF9C4,stroke:#FBC02D,stroke-width:2px
```

**关键点**：
- **3问 + 1总结**的固定流程，不多不少，刚好够用
- AI 不是泛泛而谈，而是**结合你今天的真实数据**来提问和总结
- 总结像"领奖励"而不是"写检讨"，**无条件鼓励** + **补充新效率技巧**

---

## 🧩 数据流：三个阶段如何串联

```mermaid
flowchart LR
    subgraph 计划阶段
        A1[用户写下任务]
        A2[选择焦点任务]
        A3[确认第一步微动作]
    end

    subgraph 执行阶段
        B1[微任务执行 + 计时]
        B2[完成/卡住/接力/心流]
        B3[所有行为被记录为事件]
    end

    subgraph 反思阶段
        C1[读取今日事件流]
        C2[生成数据摘要]
        C3[AI 基于数据引导对话]
        C4[输出今日结算卡片]
    end

    A1 --> A2 --> A3 --> B1
    B1 --> B2 --> B3
    B3 -->|"事件存储到本地"| C1
    C1 --> C2 --> C3 --> C4

    style A1 fill:#E8F5E9
    style A2 fill:#E8F5E9
    style A3 fill:#E8F5E9
    style B1 fill:#E3F2FD
    style B2 fill:#E3F2FD
    style B3 fill:#E3F2FD
    style C1 fill:#FFF8E1
    style C2 fill:#FFF8E1
    style C3 fill:#FFF8E1
    style C4 fill:#FFF8E1
```

---

## 📌 一句话总结

> **计划**时把大任务拆成第一个小动作 → **执行**时一步步接力推进（卡住有AI急救）→ **反思**时看数据、聊天、领奖励，形成每日闭环 🔁
