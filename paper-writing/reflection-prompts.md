# AI 反思对话 Prompt 说明

本文档整理当前反思对话的 prompt 设计主轴。源码以 `src/renderer/src/services/ai.ts` 为准，主要对应：

- `buildReflectionSystemPrompt()`：每日反思 / 历史日期反思
- `buildWeeklyReflectionSystemPrompt()`：周反思
- `generateSuggestions()`：底部探索方向 Tag 的结构化生成

## 核心定位

当前反思对话采用**低负担元认知支架**作为主轴，而不是固定问卷、心理治疗或效率评判。

对 ADHD 用户来说，反思的困难常常不只是“不知道怎么总结”，还包括启动困难、开放问题负担高、容易自责、难以从一天的碎片中提取可复用经验。因此，AI 的角色被设定为“陪用户看数据的朋友”：帮助用户看见任务过程中的线索，并把线索整理成更容易继续尝试的小经验。

一句话概括：

> AI 反思的目标不是让用户回答更多问题，而是帮助用户从行为数据和自身叙述中看见任务过程、识别可复用策略，并形成低压力的小尝试。

## 设计原则

### 1. 自由但有调度

当前默认是自由反思模式。它不是让 AI 随便聊天，而是让 AI 每轮先判断用户当前更需要什么：

- 看懂一个数据现象
- 接住一种情绪或状态
- 澄清一个关键线索
- 提取一个已经有效的做法
- 给一个低压力小实验
- 温和收束

因此，反思没有固定三步。用户可以点 Tag，也可以直接输入问题、表达情绪、说“不知道聊什么”，或直接结束。

### 2. ADHD 友好的低负担表达

Prompt 明确要求：

- 回复短、容易扫读
- 每轮最多问一个问题
- 不连续追问
- 不用“是不是/好不好/对吗”这类确认式问题
- 不把“想不出来”变成新的任务
- 先看见努力证据，再讨论困难
- 建议只给一个小实验，不给一整套方法

这部分是为了降低开放式反思的认知负担，并减少用户因为“没完成”而产生的挫败感。

### 3. 数据作证据，不作评判

图表不是用来评价用户效率高低，而是作为帮助用户理解任务过程的证据。

例如：

- 任务没有完成，但开始过：说明启动已经发生了，不是完全没有动。
- 中断后又回来：说明用户曾尝试把任务重新接上。
- 某些任务一直停在计划里：提示任务入口可能太大或太模糊。
- 某些时间段更容易推进：提示可以寻找更容易开始的条件。

Prompt 要求 AI 不直接复述图表数字，而是把数字连接到任务理解、自我状态、策略使用或跨天规律。

## ADHD coaching-informed 策略

在低负担元认知支架之上，当前 prompt 进一步吸收了 ADHD coaching 中常见的对话策略。这里的 coaching 不是治疗，而是一种结构化支持：帮助用户设定当下议程、外部化执行功能、识别可行策略，并把反思转成低压力的小尝试。

| 策略 | 对话实现 |
|---|---|
| Agenda-setting | 不问“今天想聊什么”，而是给几个轻入口，让用户选择先看顺的地方、卡住的位置、值得保留的做法，或只收一个小发现。 |
| Strength-first | 先从数据里找具体努力证据，例如启动过、中断后回来过、拆小过、记录卡点、完成小任务。 |
| Externalizing executive function | 当用户混乱或没话说时，AI 先帮用户把材料分成 2-3 类，减少用户自己组织语言的负担。 |
| Curiosity before advice | 除非用户主动问怎么办，否则先理解过程，不急着给方法；避免追问“为什么拖延/为什么卡住”。 |
| Small experiment | 建议被写成一个可选小实验，而不是完整计划或作业。 |
| Accountability without pressure | 可以温和借用过去有效做法，但不检查用户是否履行旧承诺。 |

## Novelty prompts：自然的新鲜感

新鲜感的目标不是让 AI 变得搞笑或戏剧化，而是避免每天都用同一种入口，让用户在不知道聊什么时有不同的低压力选择。

当前采用的是**入口类型轮换**：

- 顺的地方：先看一个顺的地方？
- 可保留做法：今天有什么值得保留？
- 需要变小的地方：今天哪里需要变小？
- 轻量收束：只收一个小发现？
- 卡住位置：哪些任务还停在计划里？
- 对比变化：和前几天哪里不一样？

不推荐使用过度表演或容易尴尬的比喻，例如“游戏关卡”“侦探破案”“大脑天气”“挑战任务”“隐藏小胜利”。这些表达只有在用户自己先使用类似语气时，AI 才可以顺着轻轻使用。

## 元认知支架方向

Prompt 使用四个元认知方向作为观察维度，但它们不是固定步骤，也不需要按顺序覆盖。

| 方向 | 关注问题 |
|---|---|
| 看清任务 | 任务真实难度、边界、开始前理解和实际推进是否一致 |
| 看清自己 | 用户在什么状态、时间、场景下更容易开始、停住或继续 |
| 看清策略 | 哪些做法实际帮助了推进，哪些做法效果一般 |
| 看清规律 | 这次或这一周的经验能否转成未来可复用的小经验 |

## Tag 生成逻辑

主回复 AI 不再输出 `SUGGESTIONS` 隐藏注释。当前实现是在 AI 回复完成后，由前端调用 `generateSuggestions()`，基于最近对话上下文从标准 Tag 池中挑选候选方向，也可以在有明确数据证据时生成自定义方向。

这样做有两个好处：

- 用户可见回复更干净，不混入控制文本。
- 自由反思可以根据对话状态返回 0 个 Tag，例如追问、澄清、用户想结束或已经自然收束时。

Tag 的定位是低压力的“可点击问题入口”，不是结论、图表名或研究分类。

## 推荐论文表述

可以这样描述当前策略：

> We designed the reflection dialogue as a low-burden metacognitive scaffold informed by ADHD coaching strategies. Rather than enforcing a fixed reflection script, the system dynamically selects one conversational move at each turn, such as interpreting a data cue, acknowledging emotion, eliciting missing context, extracting a reusable strategy, suggesting a small experiment, or closing the reflection. To reduce repetitiveness, the system offers varied but plain-language entry points, such as noticing what went smoothly, identifying what needs to be made smaller, or keeping one small takeaway. This design aims to reduce the cognitive burden of open-ended reflection while supporting users' self-awareness, strategy recognition, and willingness to continue the conversation.

中文版本：

> 我们将反思对话设计为面向 ADHD 用户的低负担元认知支架，并借鉴 ADHD coaching 中的议程设定、优势优先、执行功能外部化、小实验和低压力问责等策略。系统不强制用户遵循固定复盘步骤，而是在每轮对话中根据用户当前状态选择一个合适的微动作，例如解释数据线索、承接情绪、澄清上下文、提取可复用策略、提出小实验或温和收束。为减少重复感，系统提供多种朴素而不尴尬的入口，例如先看顺的地方、看看哪里需要变小，或只收一个小发现。该设计旨在降低开放式反思的认知负担，同时提升用户继续对话和深入反思的意愿。
