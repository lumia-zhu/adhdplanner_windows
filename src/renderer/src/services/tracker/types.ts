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
  source: 'self' | 'ai_chip' | 'memory_chip' | 'skip'  // 自己打字 / 点击 AI 建议 / 点击记忆建议 / 跳过直接开始
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

/** 子任务被标记为完成 */
export interface ExecSubtaskCompletedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  subtaskId: string
  subtaskTitle: string
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
  reasonSource: 'ai_chip' | 'self' | 'common_chip' // 点了 AI 预测 / 自己输入 / 点了常见原因标签
  stuckCategory?: 'task_understanding' | 'task_load' | 'attention' | 'quality_pressure' | 'emotion_motivation' | 'context_conflict'
  stuckResponseMode?: 'direct_action' | 'reflective_question' | 'emotion_elaboration'
  activeAppContext?: {
    windowSeconds: number
    primaryAppName: string
    primaryShare: number
    secondaryAppName?: string
    confidence: 'medium' | 'high'
  }
}

/** AI 生成了反思提示（新版 stuck 流程） */
export interface StuckReflectionShownPayload {
  sessionId: string
  taskId: string
  difficulty: string        // 用户描述的困难
  reflection: string        // AI 生成的反思提示文本
}

/** 用户点击了反思提示中的建议反馈（👍 / 👎） */
export interface StuckHintFeedbackClickedPayload {
  sessionId: string
  taskId: string
  hintIndex: number
  hintText: string
  feedback: 'up' | 'down'
  action: 'select' | 'switch' | 'clear'
}

/** 用户离开反思提示时的反馈汇总（可不选） */
export interface StuckHintFeedbackSummaryPayload {
  sessionId: string
  taskId: string
  hintCount: number
  ratedCount: number
  upCount: number
  downCount: number
  skipped: boolean
  ratings: {
    hintIndex: number
    hintText: string
    feedback: 'up' | 'down'
  }[]
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

export interface StuckChatStartedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  conversationId: string
  stuckReason: string
  stuckCategory?: StuckReasonPayload['stuckCategory']
  stuckResponseMode?: StuckReasonPayload['stuckResponseMode']
}

export interface StuckChatMessageSentPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  conversationId: string
  messageIndex: number
  charCount: number
}

export interface StuckChatReplyReceivedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  conversationId: string
  messageIndex: number
  charCount: number
  usedFallback: boolean
  error?: string
}

export interface StuckChatEndedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  conversationId: string
  messageCount: number
  durationMs: number
  reason: 'resume' | 'exit' | 'phase_change'
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
  /** 'manual' 表示用户通过补记功能手动添加，缺省为真实计时 */
  source?: 'manual'
  /** 快速专注模式（无脚手架直接计时） */
  isQuickFocus?: boolean
}

/** 专注会话结束 */
export interface SessionEndedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  totalDurationSeconds: number
  completedMicroSteps: number
  endReason: 'task_done' | 'exit' | 'abandon' | 'pause' | 'manual_entry'
  /** 'manual' 表示用户通过补记功能手动添加，缺省为真实计时 */
  source?: 'manual'
  /** 快速专注模式 */
  isQuickFocus?: boolean
}

/** 专注会话暂停 */
export interface SessionPausedPayload {
  sessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  elapsedSeconds: number
  completedMicroSteps: number
}

/** 专注会话恢复 */
export interface SessionResumedPayload {
  sessionId: string
  originalSessionId: string
  taskId: string
  taskTitle: string
  microAction: string
  pausedDurationSeconds: number
  completedMicroSteps: number
}

/** 宏观任务被标记为完成 */
export interface MacroTaskCompletedPayload {
  taskId: string
  taskTitle: string
  completedVia: 'main_task' | 'flow' | 'manual' | 'subtasks_all_done' // 完成方式
}

/** ====== 6. 每日快照 (Daily Snapshot) ====== */

/** 遗留任务池：今天没被执行的任务 */
export interface DailyLeftoversPayload {
  leftoverTasks: { id: string; title: string; priority: string }[]
  totalCount: number
}

/** ====== 7. 任务管理 (Task Management) ====== */

export interface TaskCreatedPayload {
  taskId: string
  title: string
  source: 'editor' | 'quick-add'
}

export interface TaskToggledPayload {
  taskId: string
  completed: boolean
}

export interface TaskDeletedPayload {
  taskId: string
}

export interface TaskCarriedOverPayload {
  taskIds: string[]
  fromDate: string
}

export interface TaskCarryOverDismissedPayload {
  date: string
  totalCount: number
  groupCount: number
  fromDates: string[]
  source: 'collapsed' | 'expanded'
}

export interface TaskReorderedPayload {
  taskId: string
  fromIndex: number
  toIndex: number
}

export interface TaskEditedPayload {
  taskId: string
  field: 'title' | 'note'
}

/** ====== 8. 反思 (Reflection) ====== */

export interface ReflectOpenedPayload {
  date: string
  mode: 'daily' | 'weekly'
}

export interface ReflectMessageSentPayload {
  date: string
  mode: 'daily' | 'weekly'
  messageIndex: number
  charCount: number
  source?: 'input' | 'suggestion'
}

export interface ReflectEndedPayload {
  date: string
  mode: 'daily' | 'weekly'
  messageCount: number
  durationMs: number
}

export interface ReflectClosedPayload {
  date: string
  mode: 'daily' | 'weekly'
  durationMs: number
  hadChat: boolean
  hadEndedProperly: boolean
}

export interface ReflectModeSwitchedPayload {
  from: 'daily' | 'weekly'
  to: 'daily' | 'weekly'
}

export interface ReflectChatOpenedPayload {
  date: string
  mode: 'daily' | 'weekly'
}

export interface ReflectChartReferencedPayload {
  chartId: string
}

export interface ReflectVisualRefClickedPayload {
  type: string
  value?: string
  matched: boolean
  count?: number
  chartId?: string
  mode?: 'daily' | 'weekly'
  resolvedValue?: string
  fallbackChartId?: string
}

export interface ReflectFullscreenToggledPayload {
  date: string
  mode: 'daily' | 'weekly'
  fullscreen: boolean
}

/** ====== 8.5 心情记录 (Mood) ====== */

export interface MoodSavedPayload {
  date: string
  mood: number
  hasNote: boolean
  noteCharCount: number
  isUpdate: boolean
}

/** ====== 9. 导航与模式 (Navigation & Mode) ====== */

export interface NavDateChangedPayload {
  from: string
  to: string
  method: 'arrow' | 'calendar' | 'today'
}

export interface ModeWidgetPayload {}

/** ====== 10. 脚手架补充 (Scaffold) ====== */

export interface PlanScaffoldSkippedPayload {
  taskId: string
}

export interface PlanChipSelectedPayload {
  taskId: string
  chipText: string
}

export interface PlanTaskUnderstandingPayload {
  taskId: string
  taskTitle: string
  understandingContext: string
}

/** ====== 补充：任务结构与清理 ====== */

export interface TaskSubtaskCreatedPayload {
  taskId: string
  subtaskTitle: string
}

export interface TaskSubtaskToggledPayload {
  taskId: string
  subtaskId: string
  subtaskTitle: string
  completed: boolean
}

export interface TaskSubtaskDeletedPayload {
  taskId: string
  subtaskId: string
  subtaskTitle: string
}

export interface TaskPriorityChangedPayload {
  taskId: string
  from: string
  to: string
}

export interface TaskClearedCompletedPayload {
  count: number
}

/** ====== 11. 记忆面板 (Memory) ====== */

export interface MemoryOpenedPayload {}

export interface MemoryDeletedPayload {
  type: 'session' | 'commitment' | 'firstStep' | 'stableFirstStep' | 'stuckReason' | 'hintFeedback'
  itemId: string
}

/** ====== 12. 设置与系统 (Settings & System) ====== */

export interface SettingsSavedPayload {
  settingType: 'profile' | 'ai_config'
}

export interface AuthLoginPayload {
  email?: string
}

export interface AuthLogoutPayload {}

export interface AppLaunchedPayload {}

export interface AppQuitPayload {}

export interface ManualTimeAddedPayload {
  date: string
  entryCount: number
}

// ===================== 事件注册表 =====================
// ★ 所有事件类型在这里集中注册，确保类型安全

export interface TrackEventMap {
  // 计划阶段
  'plan.brain_dump':            PlanBrainDumpPayload
  'plan.focus_selected':        PlanFocusSelectedPayload
  'plan.first_micro':           PlanFirstMicroPayload
  'plan.task_understanding':    PlanTaskUnderstandingPayload
  'plan.scaffold_skipped':      PlanScaffoldSkippedPayload
  'plan.chip_selected':         PlanChipSelectedPayload

  // 执行阶段
  'exec.micro_started':         ExecMicroStartedPayload
  'exec.micro_completed':       ExecMicroCompletedPayload
  'exec.subtask_completed':     ExecSubtaskCompletedPayload
  'exec.flow_entered':          ExecFlowEnteredPayload
  'exec.flow_ended':            ExecFlowEndedPayload

  // 卡顿急救
  'stuck.triggered':            StuckTriggeredPayload
  'stuck.reason':               StuckReasonPayload
  'stuck.reflection_shown':     StuckReflectionShownPayload
  'stuck.hint_feedback_clicked': StuckHintFeedbackClickedPayload
  'stuck.hint_feedback_summary': StuckHintFeedbackSummaryPayload
  'stuck.pivot_offered':        StuckPivotOfferedPayload
  'stuck.pivot_chosen':         StuckPivotChosenPayload
  'stuck.chat_started':         StuckChatStartedPayload
  'stuck.chat_message_sent':    StuckChatMessageSentPayload
  'stuck.chat_reply_received':  StuckChatReplyReceivedPayload
  'stuck.chat_ended':           StuckChatEndedPayload

  // 中断放弃
  'abandon.exit':               AbandonExitPayload

  // 会话生命周期
  'session.started':            SessionStartedPayload
  'session.ended':              SessionEndedPayload
  'session.paused':             SessionPausedPayload
  'session.resumed':            SessionResumedPayload
  'session.macro_completed':    MacroTaskCompletedPayload

  // 每日快照
  'daily.leftovers':            DailyLeftoversPayload

  // 任务管理
  'task.created':               TaskCreatedPayload
  'task.toggled':               TaskToggledPayload
  'task.deleted':               TaskDeletedPayload
  'task.carried_over':          TaskCarriedOverPayload
  'task.carry_over_dismissed':  TaskCarryOverDismissedPayload
  'task.reordered':             TaskReorderedPayload
  'task.edited':                TaskEditedPayload
  'task.subtask_created':       TaskSubtaskCreatedPayload
  'task.subtask_toggled':       TaskSubtaskToggledPayload
  'task.subtask_deleted':       TaskSubtaskDeletedPayload
  'task.priority_changed':      TaskPriorityChangedPayload
  'task.cleared_completed':     TaskClearedCompletedPayload

  // 反思
  'reflect.opened':             ReflectOpenedPayload
  'reflect.message_sent':       ReflectMessageSentPayload
  'reflect.ended':              ReflectEndedPayload
  'reflect.closed':             ReflectClosedPayload
  'reflect.mode_switched':      ReflectModeSwitchedPayload
  'reflect.chat_opened':        ReflectChatOpenedPayload
  'reflect.chart_referenced':   ReflectChartReferencedPayload
  'reflect.visual_ref_clicked': ReflectVisualRefClickedPayload
  'reflect.fullscreen_toggled': ReflectFullscreenToggledPayload

  // 心情记录
  'mood.saved':                 MoodSavedPayload

  // 导航与模式
  'nav.date_changed':           NavDateChangedPayload
  'mode.widget_entered':        ModeWidgetPayload
  'mode.widget_expanded':       ModeWidgetPayload

  // 记忆面板
  'memory.opened':              MemoryOpenedPayload
  'memory.deleted':             MemoryDeletedPayload

  // 设置与系统
  'settings.saved':             SettingsSavedPayload
  'auth.login':                 AuthLoginPayload
  'auth.logout':                AuthLogoutPayload
  'app.launched':               AppLaunchedPayload
  'app.quit':                   AppQuitPayload
  'manual.time_added':          ManualTimeAddedPayload
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
  /** 行为分析日期；历史日期反思时可不同于实际发生日期 */
  logicalDate?: string
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
    scaffoldSource: 'self' | 'ai_chip' | 'memory_chip' | 'skip' | null // 脚手架依赖度
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
    taskTitle: string                 // 所属任务名
    triggeredAt: string               // 卡顿发生时间（HH:MM 格式）
    microAction: string               // 卡在哪
    reason: string                    // 为什么卡
    reasonSource: 'ai_chip' | 'self' | 'common_chip'
    pivotChosen: string               // 怎么绕的
    pivotSource: 'ai_chip' | 'self' | 'resume_original'
    rescueSucceeded: boolean | null   // 绕路后是否完成
  }[]

  /** 中断与恢复记录（session.paused + session.resumed） */
  interruptions: {
    taskTitle: string
    microAction: string
    pausedAt: string                  // ISO 时间
    pausedAfterSeconds: number        // 暂停时已执行多久
    resumedAfterSeconds: number | null // 暂停了多久后恢复（null = 未恢复）
  }[]

  /** AI 即时反思记录（stuck.reflection_shown）—— 卡住时 AI 给过的提示 */
  reflectionHints: {
    difficulty: string                // 用户描述的困难
    reflection: string               // AI 当时给的反思提示
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
