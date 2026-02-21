/**
 * 全链路行为追踪 —— 类型定义
 *
 * 采用【事件溯源】模式：
 *   - 每个用户动作 → 一条 TrackEvent
 *   - 按日期存储为 JSON 文件（tracker-2026-02-21.json）
 *   - 晚上用 summary.ts 把事件流聚合成结构化摘要，喂给 LLM 做反思对话
 *
 * ★ 扩展规则：
 *   需要追踪新行为时，只需：
 *   1. 在 TrackEventMap 添加新事件类型 + payload
 *   2. 在对应组件中调用 tracker.track('新类型', payload)
 *   无需修改存储层或 IPC 层。
 */

// ===================== 事件 Payload 定义 =====================
// 每种事件的附带数据（payload），用 interface 确保类型安全

/** ====== 1. 计划阶段 (Planning Phase) ====== */

/** 用户倾倒的原始任务列表（脑暴池） */
export interface PlanBrainDumpPayload {
  tasks: { id: string; title: string }[]  // 早上所有任务快照
  taskCount: number
}

/** 用户选择了要聚焦执行的宏观任务 */
export interface PlanFocusSelectedPayload {
  taskId: string
  taskTitle: string
  taskNote?: string
}

/** 用户确定了第一个微动作（破冰第一步） */
export interface PlanFirstMicroPayload {
  taskId: string
  taskTitle: string
  microAction: string
  source: 'self' | 'ai_chip'  // 自己打字 or 点击了 AI 建议
}

/** ====== 2. 执行阶段 (Execution Phase) ====== */

/** 微任务开始执行 */
export interface ExecMicroStartedPayload {
  sessionId: string         // 本次专注会话 ID
  taskId: string            // 所属宏观任务
  taskTitle: string
  microAction: string
  estimatedSeconds?: number // 用户预估时长（秒），可选
}

/** 微任务完成 */
export interface ExecMicroCompletedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  actualSeconds: number     // 实际耗时（秒）
  estimatedSeconds?: number // 如果有预估，一起记录以计算偏差
}

/** 用户进入心流模式（点了「我有感觉了，直接做」） */
export interface ExecFlowEnteredPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  lastMicroAction: string   // 进入心流前的最后一个微动作
  completedStepCount: number // 进入心流前已完成的微步数
}

/** 心流模式结束 */
export interface ExecFlowEndedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  flowDurationSeconds: number // 心流持续时长
  endReason: 'task_done' | 'exit' | 'stuck' // 结束原因
}

/** ====== 3. 卡顿与急救 (Stuck & Rescue) ====== */

/** 用户点击了🆘卡住了 */
export interface StuckTriggeredPayload {
  sessionId: string
  taskId: string
  microAction: string       // 卡在哪个微任务上
  elapsedSeconds: number    // 卡住时已经执行了多久
}

/** 用户提交了卡顿原因 */
export interface StuckReasonPayload {
  sessionId: string
  taskId: string
  microAction: string
  reason: string            // 具体原因
  reasonSource: 'ai_chip' | 'self' // 点了 AI 预测 or 自己输入
}

/** AI 生成了绕路建议 */
export interface StuckPivotOfferedPayload {
  sessionId: string
  taskId: string
  empathy: string           // AI 的同理心安抚语
  pivotSuggestions: string[]// AI 建议的平替路径
}

/** 用户选择了绕路方案 */
export interface StuckPivotChosenPayload {
  sessionId: string
  taskId: string
  chosenPivot: string       // 用户选的具体方案
  pivotSource: 'ai_chip' | 'self' | 'resume_original' // 来源
}

/** ====== 4. 中断与放弃 (Abandonment) ====== */

/** 用户直接退出，未走完成或急救流程 */
export interface AbandonExitPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string       // 退出时在做什么
  elapsedSeconds: number    // 退出时已经执行了多久
  phase: string             // 退出时处于什么阶段
}

/** ====== 5. 会话生命周期 (Session Lifecycle) ====== */

/** 专注会话开始 */
export interface SessionStartedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
}

/** 专注会话结束 */
export interface SessionEndedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  totalDurationSeconds: number
  completedMicroSteps: number
  endReason: 'task_done' | 'exit' | 'abandon'
}

/** 宏观任务被标记为完成 */
export interface MacroTaskCompletedPayload {
  taskId: string
  taskTitle: string
  completedVia: 'flow' | 'manual' | 'subtasks_all_done' // 完成方式
}

/** ====== 6. 每日快照 (Daily Snapshot) ====== */

/** 遗留任务池：今天没被执行的任务 */
export interface DailyLeftoversPayload {
  leftoverTasks: { id: string; title: string; priority: string }[]
  totalCount: number
}

// ===================== 事件注册表 =====================
// ★ 所有事件类型在这里集中注册，确保类型安全

export interface TrackEventMap {
  // 计划阶段
  'plan.brain_dump':        PlanBrainDumpPayload
  'plan.focus_selected':    PlanFocusSelectedPayload
  'plan.first_micro':       PlanFirstMicroPayload

  // 执行阶段
  'exec.micro_started':     ExecMicroStartedPayload
  'exec.micro_completed':   ExecMicroCompletedPayload
  'exec.flow_entered':      ExecFlowEnteredPayload
  'exec.flow_ended':        ExecFlowEndedPayload

  // 卡顿急救
  'stuck.triggered':        StuckTriggeredPayload
  'stuck.reason':           StuckReasonPayload
  'stuck.pivot_offered':    StuckPivotOfferedPayload
  'stuck.pivot_chosen':     StuckPivotChosenPayload

  // 中断放弃
  'abandon.exit':           AbandonExitPayload

  // 会话生命周期
  'session.started':        SessionStartedPayload
  'session.ended':          SessionEndedPayload
  'session.macro_completed': MacroTaskCompletedPayload

  // 每日快照
  'daily.leftovers':        DailyLeftoversPayload
}

// 所有事件类型名称
export type TrackEventType = keyof TrackEventMap

// ===================== 事件记录结构 =====================

/** 单条事件记录（存入 JSON 文件） */
export interface TrackEvent<T extends TrackEventType = TrackEventType> {
  /** 事件唯一 ID（UUID） */
  id: string
  /** 事件类型（如 'exec.micro_completed'） */
  type: T
  /** 事件发生时间戳（ms） */
  timestamp: number
  /** 所属日期（'2026-02-21'），方便按日查询 */
  date: string
  /** 事件数据 */
  payload: TrackEventMap[T]
}

// ===================== 每日汇总结构（喂给 LLM） =====================

/** 每日行为汇总，用于晚间反思对话的 LLM Context */
export interface DailySummary {
  date: string

  /** 计划阶段 */
  planning: {
    brainDumpTasks: string[]          // 原始任务列表（标题）
    focusTaskTitle: string | null     // 今日主焦点
    firstMicroAction: string | null   // 破冰第一步
    scaffoldSource: 'self' | 'ai_chip' | null // 脚手架依赖度
  }

  /** 微步轨迹 */
  microStepTrail: {
    microAction: string
    actualSeconds: number
    estimatedSeconds?: number
    timeDeltaSeconds?: number         // 实际 - 预估（正=超时，负=提前）
    status: 'completed' | 'stuck' | 'abandoned'
  }[]

  /** 心流事件 */
  flowEvents: {
    taskTitle: string
    triggeredAt: string               // ISO 时间
    durationSeconds: number
    lastMicroBeforeFlow: string
  }[]

  /** 卡顿急救记录 */
  stuckEvents: {
    microAction: string               // 卡在哪
    reason: string                    // 为什么卡
    reasonSource: 'ai_chip' | 'self'
    pivotChosen: string               // 怎么绕的
    pivotSource: 'ai_chip' | 'self' | 'resume_original'
    rescueSucceeded: boolean | null   // 绕路后是否完成
  }[]

  /** 中断放弃事件 */
  abandonments: {
    microAction: string
    taskTitle: string
    elapsedSeconds: number
    time: string                      // ISO 时间
  }[]

  /** 宏观任务闭环 */
  macroTask: {
    title: string | null
    completed: boolean
    completedVia: string | null
  }

  /** 遗留任务池 */
  leftoverTasks: string[]

  /** 统计概览 */
  stats: {
    totalMicroSteps: number
    completedMicroSteps: number
    totalStuckCount: number
    totalFlowMinutes: number
    totalFocusMinutes: number
    averageTimeDeltaSeconds: number | null // 平均时间偏差
  }
}
