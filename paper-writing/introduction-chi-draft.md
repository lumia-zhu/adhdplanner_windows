# Introduction Draft

## 中文版（CHI 风格重写稿）

任务管理指个体围绕目标对任务进行理解、组织与推进的过程。作为学习、工作与日常生活得以有序展开的重要基础，它不仅关系到具体事项是否能够被完成，也影响个体如何将抽象目标转化为可执行行动、如何在多任务环境中分配时间与精力，以及如何在不同时间尺度上协调短期与长期计划。因此，任务管理并不只是记录待办事项或安排截止日期，而是一个动态展开的过程，涵盖任务理解、优先级设定、行动启动、过程监控、问题应对以及事后反思与调整等多个相互关联的环节。

对于ADHD人群而言，任务管理往往会带来更为显著的挑战。既有研究表明，ADHD通常与注意维持困难、组织困难以及自我调节困难相关，而这些特征会直接影响个体理解、推进与调整任务的方式。在大学学习情境中，这类困难尤为突出。相较于更为结构化、节奏更明确的中学环境，大学学习具有更高的自主性、更灵活且动态的安排，以及更复杂的长期任务要求。在这样的情境下，对于ADHD大学生来说，困难往往不只在于启动或推进任务，而在于如何在缺少外部结构支撑的情况下，持续理解任务、判断当前状态、识别问题所在，并据此调整后续行动。从这一角度来看，ADHD人群在任务管理中面临的困难，并不只是行为执行层面的困难，也涉及对任务过程的觉察、监控与调节。个体不仅需要执行任务本身，还需要对自身的认知与行为过程进行觉察、监控与调节。然而，这一层面的支持在现有任务管理实践中往往是缺失的，从而使相关困难在实际情境中不断被放大。

围绕任务管理，数字技术已经提供了大量支持。现有工具广泛帮助用户记录任务、设置提醒、安排日程和追踪进度，相关研究也提出了多种面向效率提升与行为支持的交互系统。然而，这些支持大多侧重于任务的外部组织与行为执行，较少关注用户如何理解自己的任务过程，以及如何在卡住、偏离和中断时重新组织行动。与此同时，生成式 AI 虽然已经越来越多地被用于计划生成、文本辅助和学习支持，但在任务管理场景中，其角色常被理解为给出建议、生成方案或替用户做决定。对于 ADHD 用户而言，这样的支持未必总是有效；过重、过抽象，或脱离当下情境的帮助，本身也可能成为新的认知负担。因此，一个尚未被充分解决的问题是：如何设计一种既贴近真实任务情境、又能够支持 ADHD 用户觉察、监控和调节自身任务过程的 AI 支持方式。

生成式 AI 为这一问题提供了新的设计机会。与现有任务管理工具相比，GenAI 能够基于具体情境提供语言化、动态化和相对个性化的支持，因此有潜力作为一种元认知支架，帮助用户更好地理解任务、识别困难、回顾过程并形成后续调整。这里的关键并不在于让 AI 替用户规划或判断，而在于探索 AI 是否能够在任务过程的关键时刻支持用户更好地觉察、监控和调节自己的行动。

基于这一思路，我们设计并部署了一个 GenAI 元认知支架原型，覆盖计划、执行与反思三个阶段，并在真实日常任务情境中展开了为期两周的 in-the-wild field deployment 研究。我们的研究问题是：

- **RQ1.** How do individuals with ADHD experience GenAI metacognitive scaffolding across planning, executing, and reflecting on everyday tasks?
- **RQ2.** What design principles and boundaries for GenAI metacognitive scaffolding emerge from its everyday use by individuals with ADHD?

University students with ADHD, who face both independent-living transitions and highly self-directed academic schedules, represent a particularly informative group for examining these questions. 基于这一考量，我们招募了 12-16 位 university students with ADHD，通过系统日志、每日 micro check-in、trace elicitation 访谈和后访谈组合收集数据，并结合 ADHD 专家访谈对发现进行验证。

通过对原型真实使用过程的研究，我们发现，用户是否接受这类 AI 支持，并不主要取决于 AI 是否更强或更智能，而更多取决于支持是否轻量、贴近当下情境，并能够帮助他们更清楚地看见自己的任务过程，而不是替他们下判断或接管决策。

基于这些发现，本研究为 HCI 社区提供三方面贡献：

1. 增进了对 **university students with ADHD** 在真实日常任务中与 GenAI 元认知支架协商、采纳与拒绝的实证理解；
2. 为面向 **individuals with ADHD** 的 GenAI 元认知支架提炼了一组设计原则与边界（principles and boundaries），落在轻量介入、时机匹配与可协商性等核心维度上；
3. 为更广的 **neurodivergent populations** 指出了一条 GenAI 设计路径——GenAI 的价值更适合被理解为对觉察与调节的支持，而非对思考与决策的替代。
