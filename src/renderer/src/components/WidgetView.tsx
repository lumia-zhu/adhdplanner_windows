/**
 * WidgetView —— 阶段2：Dynamic Bar（执行与单步接力）
 *
 * 五种阶段：
 *   executing  – 正在执行微任务：任务名 + 计时 + [✓完成] + [🆘卡住了]
 *   relay      – 微任务完成后展开：输入下一步 + AI筹码 + [继续] + [🚀直接做]
 *   stuck_a    – 急救状态A：LLM 提示 + 卡点预测筹码 + 自由输入
 *   stuck_b    – 急救状态B：AI 急救对话 + 继续任务
 *   flow       – 心流模式：只显示宏观任务名 + 计时 + [✓完成]
 *
 * 窗口尺寸：
 *   executing / quick → 560×52（低干扰横向薄条）
 *   relay            → 380×232（展开）
 *   stuck_a / stuck_b→ 380×304/460（急救面板）
 */

import { useState, useEffect, useRef } from 'react'
import type { Task } from '../types'
import type { AIConfig, MicroActionChip, StuckChatContext, StuckChatMessage, StuckProductivityContext } from '../services/ai'
import { generateStuckChips, chatStuckSupportStream, buildStuckHint, classifyStuckReason, classifyStuckResponseMode } from '../services/ai'
import type { ActivityRecord } from './ActivityHeatmap'
import { aiCache } from '../services/ai-cache'
import { tracker } from '../services/tracker'
import { buildDailySummary, type TrackEvent } from '../services/tracker'
import { triggerEffect } from '../effects'
import AILoadingTips from './AILoadingTips'
import { getToday } from '../hooks/useDateNavigation'

// ===================== 常量 =====================

const BAR_W_PANEL = 620
const BAR_W_EXECUTING = 560
const BAR_H_THIN = 66
const BAR_H_RELAY = 280
const BAR_H_STUCK = 340
const BAR_H_STUCK_CHAT = 460
const BAR_H_FIRST_STEP = 52  // 简化模式：横向低干扰任务条
const STUCK_APP_CONTEXT_WINDOW_MS = 90_000
const STUCK_APP_CONTEXT_TIMEOUT_MS = 200
const STUCK_APP_CONTEXT_MIN_PRIMARY_SHARE = 0.5

// ★ Feature Flag：关闭逐步拆解（relay 循环），简化为"理解 → 第一步 → 完成 → 退出"
// 设为 true 可恢复完整的 step-by-step 接力模式
export const ENABLE_STEP_BY_STEP = false

/** 卡住时的常见原因快捷标签（点击自动填入输入框） */
const STUCK_COMMON_REASONS = [
  '不确定下一步该做什么',
  '这一步太难/复杂了，不知道从哪开始',
  '不确定去哪找需要的信息',
  '总是被其他事情分心',
]

// ===================== 类型 =====================

export interface FocusSession {
  sessionId: string           // 本次专注会话唯一 ID（用于关联所有事件）
  taskId: string
  taskTitle: string
  currentMicroTask: string
  startTime: number          // 当前微任务开始时间戳（ms）—— 用于分析、埋点
  sessionStartTime: number   // ★ 整个会话的开始时间戳 —— 用于显示计时器，不因 stuck/relay/flow 切换而重置
  isFlowMode: boolean        // 用户已进入心流
  phase: 'executing' | 'relay' | 'stuck_a' | 'stuck_b'
  microHistory: string[]     // 已完成微任务列表
  // ---- 子任务导航 ----
  currentSubtaskId?: string       // 当前正在做的子任务 ID
  currentSubtaskTitle?: string    // 当前正在做的子任务标题
  isSubtaskTransition?: boolean   // true = 刚切到新子任务，relay 显示子任务入口提示
  allSubtasksDone?: boolean       // true = 所有子任务完成，提供宏观任务完成选项
  // ---- 快速专注模式 ----
  isQuickFocus?: boolean          // true = 一键专注模式，无绑定任务，结束时再填写任务名称
  // ---- AI 第一步提示（非强制，仅展示） ----
  firstStepHint?: string          // FocusFlow 中确认的第一步，在任务结构视图中作为提示行显示
  // ---- 暂停恢复累计时间 ----
  elapsedOffset?: number          // 暂停→恢复后，之前已累计的秒数（仅用于计时器显示连续性，不影响埋点）
}

/** 快速专注模式下的薄条高度 */
const BAR_H_QUICK = 52

interface WidgetViewProps {
  tasks: Task[]
  session: FocusSession | null     // null = 旧的普通小组件模式
  aiConfig: AIConfig
  focusTaskId?: string | null
  onToggle: (id: string) => void
  onExit: () => void
  // 阶段2 回调
  onMicroComplete: () => void            // 微任务完成
  onNextMicro: (micro: string) => void   // 继续接力（输入下一步）
  onEnterFlow: () => void                // 进入心流
  onTaskDone: () => void                 // 整个任务完成（心流模式 ✓）
  onStuck: () => void                    // 进入卡住状态A
  onStuckToB: () => void                 // 状态A→B：提交了卡点原因
  onResume: (newMicro: string) => void   // 急救完成，用新微任务重启
  onSubtaskDone: () => void              // 当前子任务搞定，切到下一个
  onPause: () => void                    // 暂停当前任务，切到别的事
  // ★ 简化模式：任务结构视图回调
  onWidgetSubtaskToggle?: (subtaskId: string) => void  // 勾选/取消子任务
}

// ===================== 主组件 =====================

export default function WidgetView({
  tasks, session, aiConfig, focusTaskId,
  onToggle, onExit,
  onMicroComplete, onNextMicro, onEnterFlow, onTaskDone,
  onStuck, onStuckToB, onResume, onSubtaskDone, onPause,
  onWidgetSubtaskToggle,
}: WidgetViewProps) {

  // 如果没有 session → 走旧的普通小组件模式
  if (!session) {
    return <LegacyWidget tasks={tasks} focusTaskId={focusTaskId} onToggle={onToggle} onExit={onExit} />
  }

  // ★ 快速专注模式：简化 widget，只显示计时器和完成按钮
  if (session.isQuickFocus) {
    return (
      <QuickFocusWidget
        session={session}
        onTaskDone={onTaskDone}
        onExit={onExit}
      />
    )
  }

  // ★ 简化模式：从 tasks 中获取当前任务的子任务（任务结构视图用）
  const currentTask = tasks.find(t => t.id === session.taskId)
  const taskSubtasks = currentTask?.subtasks ?? []

  // 有 session → 进入专注执行模式
  return (
    <FocusDynamicBar
      session={session}
      aiConfig={aiConfig}
      todayTasks={tasks}
      taskSubtasks={taskSubtasks}
      onMicroComplete={onMicroComplete}
      onNextMicro={onNextMicro}
      onEnterFlow={onEnterFlow}
      onTaskDone={onTaskDone}
      onStuck={onStuck}
      onStuckToB={onStuckToB}
      onResume={onResume}
      onSubtaskDone={onSubtaskDone}
      onExit={onExit}
      onPause={onPause}
      onWidgetSubtaskToggle={onWidgetSubtaskToggle}
    />
  )
}

// ===================== FocusDynamicBar =====================

interface FocusDynamicBarProps {
  session: FocusSession
  aiConfig: AIConfig
  todayTasks: Task[]
  taskSubtasks: Array<{ id: string; title: string; completed: boolean }>
  onMicroComplete: () => void
  onNextMicro: (micro: string) => void
  onEnterFlow: () => void
  onTaskDone: () => void
  onStuck: () => void
  onStuckToB: () => void
  onResume: (newMicro: string) => void
  onSubtaskDone: () => void
  onExit: () => void
  onPause: () => void
  onWidgetSubtaskToggle?: (subtaskId: string) => void
}

function FocusDynamicBar({
  session, aiConfig, todayTasks, taskSubtasks,
  onMicroComplete, onNextMicro, onEnterFlow, onTaskDone,
  onStuck, onStuckToB, onResume, onSubtaskDone, onExit, onPause,
  onWidgetSubtaskToggle,
}: FocusDynamicBarProps) {
  const {
    taskId, phase, isFlowMode, currentMicroTask, taskTitle, startTime,
    currentSubtaskId, currentSubtaskTitle, isSubtaskTransition, allSubtasksDone,
  } = session

  // ---- 计时器（精确到秒）----
  // ★ 使用 sessionStartTime 作为计时基准 —— 不因 stuck/relay/flow 切换而重置
  // 向后兼容：如果旧 session 没有 sessionStartTime，则 fallback 到 startTime
  const timerBase = session.sessionStartTime || startTime
  const offset = session.elapsedOffset || 0  // 暂停→恢复后累计的历史秒数
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - timerBase) / 1000) + offset)
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [timerBase, offset])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  // ---- 接力输入 ----
  const [nextMicro, setNextMicro] = useState('')
  const [chips, setChips] = useState<MicroActionChip[]>([])
  const [loadingChips, setLoadingChips] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const relayPanelRef = useRef<HTMLDivElement>(null)  // 用于测量 relay 面板真实内容高度
  const taskStructurePanelRef = useRef<HTMLDivElement>(null)  // 用于测量任务结构面板高度

  // ---- 急救面板状态 ----
  const [stuckChips, setStuckChips] = useState<string[]>([])
  const [loadingStuck, setLoadingStuck] = useState(false)
  const [stuckInput, setStuckInput] = useState('')
  const stuckInputRef = useRef<HTMLInputElement>(null)

  // ---- 卡住急救对话状态 ----
  const [stuckReason, setStuckReason] = useState('')
  const [stuckMessages, setStuckMessages] = useState<StuckChatMessage[]>([])
  const [stuckChatContext, setStuckChatContext] = useState<StuckChatContext | null>(null)
  const [stuckChatInput, setStuckChatInput] = useState('')
  const [loadingStuckChat, setLoadingStuckChat] = useState(false)
  const [streamingStuckChat, setStreamingStuckChat] = useState(false)
  const [stuckChatError, setStuckChatError] = useState('')
  const stuckChatInputRef = useRef<HTMLTextAreaElement>(null)
  const stuckMessagesEndRef = useRef<HTMLDivElement>(null)
  const stuckStreamCleanupRef = useRef<(() => void) | null>(null)
  const isStuckChatBusy = loadingStuckChat || streamingStuckChat

  useEffect(() => {
    return () => {
      stuckStreamCleanupRef.current?.()
    }
  }, [])

  // ---- ★ Workaround: Windows 下 Chromium 拖拽区域缓存 bug ----
  // 窗口 resize 后 -webkit-app-region 命中区域不会自动重算，
  // 主进程 resize 后会发 'widget:refreshDrag'，这里通过切换 CSS 强制刷新。
  useEffect(() => {
    const refresh = (): void => {
      document.body.style.setProperty('-webkit-app-region', 'no-drag')
      requestAnimationFrame(() => {
        document.body.style.removeProperty('-webkit-app-region')
      })
    }
    window.electronAPI?.onRefreshDrag?.(refresh)
    return () => {
      window.electronAPI?.offRefreshDrag?.(refresh)
    }
  }, [])

  // ---- ★ 执行阶段：静默预加载 relay 接力建议 ----
  // 用户正在做微任务时，后台提前请求 AI 建议
  // 等用户点"✅ 完成"进入 relay 时，缓存已热好 → 0 等待
  useEffect(() => {
    if (!ENABLE_STEP_BY_STEP) return  // 逐步拆解关闭时不需要预加载 relay 建议
    if (phase === 'executing' && !isFlowMode && aiConfig.apiKey && aiConfig.modelId) {
      aiCache.prefetch(taskId, taskTitle, aiConfig, currentSubtaskTitle, currentMicroTask)
    }
  }, [phase, taskId, currentMicroTask, currentSubtaskTitle])

  // ---- 回退模板：AI 超过 2.5 秒没返回时显示通用建议 ----
  const FALLBACK_CHIPS: MicroActionChip[] = [
    { action: '继续往下做', note: '保持节奏就好' },
    { action: '换个更简单的方式', note: '降低门槛也是进展' },
    { action: '先做最熟悉的部分', note: '从擅长的开始' },
  ]
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---- 窗口尺寸管理 ----
  useEffect(() => {
    if (phase === 'relay') {
      // 全部完成时矮一些，其余统一高度
      const h = allSubtasksDone ? 180 : BAR_H_RELAY
      window.electronAPI.resizeWidget(BAR_W_PANEL, h)
      if (!allSubtasksDone) inputRef.current?.focus()
      // 请求 AI 接力建议（优先缓存，秒出）
      if (aiConfig.apiKey && aiConfig.modelId && !allSubtasksDone) {
        setLoadingChips(true)

        // ★ 超时回退：2.5 秒后若 AI 还没返回，先显示通用建议
        fallbackTimerRef.current = setTimeout(() => {
          setChips(prev => prev.length === 0 ? FALLBACK_CHIPS : prev)
          setLoadingChips(false)
          console.log('[Widget relay] AI 超时，显示回退模板')
        }, 2500)

        // 子任务过渡时不传 lastStep（让AI基于新子任务生成建议）
        const lastStep = isSubtaskTransition ? undefined : currentMicroTask
        aiCache.get(taskId, taskTitle, aiConfig, currentSubtaskTitle, lastStep)
          .then(({ chips: c, fromCache }) => {
            // AI 返回了 → 取消回退定时器，用真实结果
            if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current)
            setChips(c)
            if (fromCache) console.log('[Widget relay] AI 建议来自缓存 ✓')
          })
          .finally(() => setLoadingChips(false))
      }
    } else if (phase === 'stuck_a') {
      window.electronAPI.resizeWidget(BAR_W_PANEL, BAR_H_STUCK)
      stuckInputRef.current?.focus()
      // 请求 AI 卡点预测
      setStuckChips([])
      setStuckInput('')
      if (aiConfig.apiKey && aiConfig.modelId) {
        setLoadingStuck(true)
        // 加载行为记忆 → 构建卡点预测 hint
        window.electronAPI.loadMemoryStore()
          .then(raw => buildStuckHint((raw as any).stuckReasons ?? [], (raw as any).hintFeedback ?? []).forChips)
          .catch(() => '')
          .then(hint => generateStuckChips(taskTitle, currentMicroTask, aiConfig, hint || undefined))
          .then(({ chips: c }) => setStuckChips(c))
          .finally(() => setLoadingStuck(false))
      }
    } else if (phase === 'stuck_b') {
      window.electronAPI.resizeWidget(BAR_W_PANEL, BAR_H_STUCK_CHAT)
      stuckChatInputRef.current?.focus()
    } else {
      // executing / flow
      let execHeight = BAR_H_THIN
      if (!ENABLE_STEP_BY_STEP) {
        if (isFlowMode) {
          if (taskSubtasks.length === 0 && !session.firstStepHint) {
            execHeight = BAR_H_FIRST_STEP
          } else {
            // 任务结构视图：基础高度 + 每个子任务 36px + 可选第一步提示行，上限 300px
            const hintH = session.firstStepHint ? 24 : 0
            const baseH = 106 + hintH  // 顶部任务名 + 底部按钮行
            const subsH = taskSubtasks.length * 36
            execHeight = Math.min(baseH + subsH, 300)
          }
        } else {
          execHeight = BAR_H_FIRST_STEP
        }
      }
      const execWidth = !ENABLE_STEP_BY_STEP
        && phase === 'executing'
        && (!isFlowMode || (taskSubtasks.length === 0 && !session.firstStepHint))
        ? BAR_W_EXECUTING
        : BAR_W_PANEL
      window.electronAPI.resizeWidget(execWidth, execHeight)
      setNextMicro('')
      setChips([])
      setStuckChips([])
      setStuckInput('')
      setStuckReason('')
      setStuckMessages([])
      setStuckChatContext(null)
      setStuckChatInput('')
      setStuckChatError('')
      // 清理回退定时器
      if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null }
    }
  }, [phase, currentSubtaskId, allSubtasksDone, isFlowMode, taskSubtasks])

  // ---- ★ relay 面板高度自适应 ----
  // 当面板内容变化（如 AI 建议加载完成、chip 数量变化）时，
  // 测量真实内容高度，自动调整 Electron 窗口大小，避免底部被截断
  useEffect(() => {
    if (!ENABLE_STEP_BY_STEP) return  // 逐步拆解关闭时无 relay 面板
    if (phase !== 'relay' || allSubtasksDone || !relayPanelRef.current) return
    const frameId = requestAnimationFrame(() => {
      if (relayPanelRef.current) {
        const h = Math.max(relayPanelRef.current.scrollHeight, 200)
        window.electronAPI.resizeWidget(BAR_W_PANEL, h)
      }
    })
    return () => cancelAnimationFrame(frameId)
  }, [phase, allSubtasksDone, chips, loadingChips, currentSubtaskId])

  // relay 继续
  const handleContinue = () => {
    const text = nextMicro.trim()
    if (text) onNextMicro(text)
  }

  const buildTodayTaskSnapshot = (): StuckChatContext['todayTasks'] => {
    return todayTasks
      .map(task => ({
        title: task.title,
        completed: task.completed,
        priority: task.priority,
      }))
      .slice(0, 8)
  }

  const getRecentDateStrings = (days: number): string[] => {
    const [year, month, day] = getToday().split('-').map(Number)
    const base = new Date(year, month - 1, day)
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(base)
      date.setDate(base.getDate() - index)
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    })
  }

  const buildProductivityContext = async (reason: string): Promise<StuckProductivityContext> => {
    const todayTotalTasks = todayTasks.length
    const todayCompletedTasks = todayTasks.filter(task => task.completed).length
    const todayPendingTasks = todayTotalTasks - todayCompletedTasks
    const todayHighPriorityPending = todayTasks.filter(task => !task.completed && task.priority === 'high').length
    const currentTask = todayTasks.find(task => task.id === taskId || task.title === taskTitle)
    const completedSubtasks = taskSubtasks.filter(subtask => subtask.completed).length
    const currentSubtaskProgress = taskSubtasks.length > 0
      ? `${completedSubtasks}/${taskSubtasks.length} 个子任务已完成`
      : undefined
    const sessionElapsedMinutes = Math.max(
      1,
      Math.round(((Date.now() - session.sessionStartTime) / 1000 + (session.elapsedOffset || 0)) / 60),
    )

    const dates = getRecentDateStrings(7)
    const [taskGroups, eventGroups] = await Promise.all([
      Promise.all(dates.map(date => window.electronAPI.loadTasks(date).catch(() => []))),
      Promise.all(dates.map(date => window.electronAPI.loadTrackerEvents(date).catch(() => []))),
    ])

    let recentCompletedTasks = 0
    let recentCompletedMicroSteps = 0
    let recentStuckCount = 0
    let recentSimilarStuckCount = 0
    let recentSuccessfulRescues = 0
    let recentFlowMinutes = 0
    const normalizedReason = reason.trim().toLowerCase()

    taskGroups.forEach(group => {
      const tasks = Array.isArray(group) ? (group as Task[]) : []
      recentCompletedTasks += tasks.filter(task => task.completed).length
    })

    eventGroups.forEach((group, index) => {
      const events = Array.isArray(group) ? (group as TrackEvent[]) : []
      if (events.length === 0) return
      try {
        const summary = buildDailySummary(dates[index], events)
        recentCompletedMicroSteps += summary.stats.completedMicroSteps
        recentStuckCount += summary.stats.totalStuckCount
        recentFlowMinutes += summary.stats.totalFlowMinutes
        recentSuccessfulRescues += summary.stuckEvents.filter(event => event.rescueSucceeded).length
        recentSimilarStuckCount += summary.stuckEvents.filter(event => {
          const eventReason = event.reason.trim().toLowerCase()
          return !!normalizedReason && (
            eventReason === normalizedReason ||
            eventReason.includes(normalizedReason) ||
            normalizedReason.includes(eventReason)
          )
        }).length
      } catch {
        // 某天事件格式异常时跳过，不影响卡住急救主流程。
      }
    })

    return {
      todayTotalTasks,
      todayCompletedTasks,
      todayPendingTasks,
      todayHighPriorityPending,
      currentTaskPriority: currentTask?.priority,
      currentSubtaskProgress,
      sessionElapsedMinutes,
      completedMicroSteps: session.microHistory.length,
      recentCompletedTasks,
      recentCompletedMicroSteps,
      recentStuckCount,
      recentSimilarStuckCount,
      recentSuccessfulRescues,
      recentFlowMinutes,
    }
  }

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> => {
    return Promise.race([
      promise,
      new Promise<undefined>(resolve => window.setTimeout(() => resolve(undefined), timeoutMs)),
    ])
  }

  const buildStuckActiveAppContext = async (): Promise<StuckChatContext['activeAppContext']> => {
    const records = await withTimeout(
      window.electronAPI.loadActivityData(getToday()) as Promise<unknown[]>,
      STUCK_APP_CONTEXT_TIMEOUT_MS,
    )
    if (!Array.isArray(records)) return undefined

    const now = Date.now()
    const recentRecords = (records as ActivityRecord[])
      .filter(record => (
        typeof record.ts === 'number'
        && record.ts >= now - STUCK_APP_CONTEXT_WINDOW_MS
        && record.ts <= now + 5_000
        && record.appUsage
      ))

    const appCounts = new Map<string, number>()
    for (const record of recentRecords) {
      if (!record.appUsage) continue
      for (const [appName, count] of Object.entries(record.appUsage)) {
        if (!appName.trim() || count <= 0) continue
        appCounts.set(appName, (appCounts.get(appName) || 0) + count)
      }
    }

    const rankedApps = [...appCounts.entries()].sort((a, b) => b[1] - a[1])
    const totalSamples = rankedApps.reduce((sum, [, count]) => sum + count, 0)
    const primary = rankedApps[0]
    if (!primary || totalSamples <= 0) return undefined

    const primaryShare = primary[1] / totalSamples
    if (primaryShare < STUCK_APP_CONTEXT_MIN_PRIMARY_SHARE) return undefined

    return {
      windowSeconds: STUCK_APP_CONTEXT_WINDOW_MS / 1000,
      primaryAppName: primary[0],
      primaryShare,
      secondaryAppName: rankedApps[1]?.[0],
      confidence: primaryShare >= 0.7 ? 'high' : 'medium',
    }
  }

  const fallbackStuckFirstReply = (context: StuckChatContext): string => {
    if (context.stuckResponseMode === 'direct_action') {
      return `可以，先处理这个。\n\n回来后从这里继续：${context.currentStep}`
    }
    if (context.stuckResponseMode === 'emotion_elaboration') {
      return '一想到这件事，脑子里最先冒出来的 **念头** 是什么？'
    }
    const questionByCategory: Record<StuckChatContext['stuckCategory'], string> = {
      task_understanding: '刚才你看着这个任务时，脑子里第一个冒出来的 **疑问** 是什么？',
      task_load: '刚才你觉得它变复杂的时候，最先冒出来的是 **哪一块**？',
      attention: '刚才注意力被带走前，手上这一步发生了 **什么变化**？',
      emotion_motivation: '刚才那种 **不想做**，你会怎么形容它？',
      context_conflict: '刚才除了这个任务，还有什么事情一直在你脑子里 **占位置**？',
    }
    return questionByCategory[context.stuckCategory]
  }

  const fallbackStuckSecondReply = (context: StuckChatContext): string => {
    if (context.stuckCategory === 'emotion_motivation') {
      const pendingTask = context.todayTasks.find(task => !task.completed && task.title !== context.taskTitle)
      const switchTaskText = pendingTask
        ? `> 可以先这样试试：把「${context.taskTitle}」停在现在这个位置，换到「${pendingTask.title}」试 **5 分钟**。`
        : `> 可以先这样试试：把「${context.taskTitle}」停在现在这个位置，离开屏幕 **3 分钟**。`
      return `听起来现在更需要先把阻力降下来，而不是硬推完整任务。\n\n${switchTaskText}\n\n目的只是让自己不要完全断掉，不需要马上恢复满格状态。`
    }
    return `听起来真正卡住的是进入方式还不够小，不是你不努力。\n\n> 可以先这样试试：回到「${context.taskTitle}」，做一个 **1 分钟** 动作。\n\n打开当前材料或任务页，停在最容易继续的那个位置就可以。`
  }

  const renderStuckMessageContent = (text: string) => {
    const normalizedText = text.replace(/\s*>\s*(可以先这样试试[:：])/g, '\n\n> $1')
    const paragraphs = normalizedText.split(/\n{2,}/).map(part => part.trim()).filter(Boolean)
    const renderInlineContent = (paragraph: string) => {
      const parts = paragraph.split(/(\*\*[^*]+\*\*)/g)
      return parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
        }
        return <span key={index}>{part}</span>
      })
    }

    return (
      <div className="space-y-3">
        {paragraphs.map((paragraph, paragraphIndex) => {
          const isCallout = paragraph.startsWith('>')
          const cleanParagraph = isCallout ? paragraph.replace(/^>\s*/, '') : paragraph
          if (isCallout) {
            return (
              <div
                key={paragraphIndex}
                className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-gray-700 leading-relaxed"
              >
                {renderInlineContent(cleanParagraph)}
              </div>
            )
          }

          return (
            <p key={paragraphIndex} className="leading-relaxed">
              {renderInlineContent(cleanParagraph)}
            </p>
          )
        })}
      </div>
    )
  }

  const requestStuckChatReply = async (
    messages: StuckChatMessage[],
    context: StuckChatContext,
    visibleMessages: StuckChatMessage[] = messages,
  ) => {
    stuckStreamCleanupRef.current?.()
    setLoadingStuckChat(true)
    setStreamingStuckChat(false)
    setStuckChatError('')
    const isFirstRound = messages.some(message => message.role === 'user' && message.content.includes('【首轮卡住反思】'))
    const fallbackText = isFirstRound
      ? fallbackStuckFirstReply(context)
      : fallbackStuckSecondReply(context)

    setStuckMessages([...visibleMessages, { role: 'assistant', content: '' }])

    await new Promise<void>((resolve) => {
      let settled = false
      let streamedText = ''

      const finish = (content: string, error?: string) => {
        if (settled) return
        settled = true
        const finalContent = content.trim() || fallbackText
        setStuckMessages([...visibleMessages, { role: 'assistant', content: finalContent }])
        setStuckChatError(error ?? '')
        setLoadingStuckChat(false)
        setStreamingStuckChat(false)
        stuckStreamCleanupRef.current = null
        resolve()
      }

      void chatStuckSupportStream(
        messages,
        context,
        aiConfig,
        (delta) => {
          streamedText += delta
          setLoadingStuckChat(false)
          setStreamingStuckChat(true)
          setStuckMessages([...visibleMessages, { role: 'assistant', content: streamedText }])
        },
        (fullText) => {
          finish(fullText)
        },
        (error) => {
          finish(streamedText, error || 'AI 暂时没有回复，先给你一个备用小步骤。')
        },
      ).then((cleanup) => {
        if (!settled) stuckStreamCleanupRef.current = cleanup
      }).catch(() => {
        finish(streamedText, 'AI 暂时没有回复，先给你一个备用小步骤。')
      })
    })
  }

  const handleSendStuckChat = () => {
    const text = stuckChatInput.trim()
    if (!text || isStuckChatBusy || !stuckChatContext) return
    const nextMessages: StuckChatMessage[] = [
      ...stuckMessages,
      { role: 'user', content: text },
    ]
    setStuckMessages(nextMessages)
    setStuckChatInput('')
    requestStuckChatReply(nextMessages, stuckChatContext).catch(() => {
      setStuckMessages([
        ...nextMessages,
        { role: 'assistant', content: fallbackStuckSecondReply(stuckChatContext) },
      ])
      setStuckChatError('AI 暂时没有回复，先给你一个备用小步骤。')
      setLoadingStuckChat(false)
      setStreamingStuckChat(false)
    })
  }

  useEffect(() => {
    if (phase !== 'stuck_b') return
    const frameId = requestAnimationFrame(() => {
      stuckMessagesEndRef.current?.scrollIntoView({ block: 'end' })
    })
    return () => cancelAnimationFrame(frameId)
  }, [phase, stuckMessages, loadingStuckChat, streamingStuckChat])

  // stuck_a → stuck_b：用户提交困难描述后进入 AI 急救对话
  const handleSubmitStuckReason = (reason: string, reasonSource: 'common_chip' | 'self') => {
    const trimmedReason = reason.trim()
    if (!trimmedReason) return
    const stuckCategory = classifyStuckReason(trimmedReason)
    const stuckResponseMode = classifyStuckResponseMode(trimmedReason, stuckCategory)

    // 行为学习：记录卡住原因到 MemoryStore
    window.electronAPI.loadMemoryStore().then(raw => {
      const store = raw as any
      if (!store.stuckReasons) store.stuckReasons = []
      store.stuckReasons.push({
        taskTitle: session.taskTitle,
        microAction: currentMicroTask,
        reason: trimmedReason,
        date: getToday(),
      })
      store.stuckReasons = store.stuckReasons.slice(-30)
      window.electronAPI.saveMemoryStore(store)
    }).catch(() => {})

    // 切换到 stuck_b 阶段（显示 AI 急救对话）
    onStuckToB()

    setStuckReason(trimmedReason)
    setStuckChatInput('')
    setStuckChatError('')
    setStuckMessages([])

    Promise.all([
      window.electronAPI.loadMemoryStore().catch(() => null),
      buildProductivityContext(trimmedReason).catch(() => undefined),
      buildStuckActiveAppContext().catch(() => undefined),
    ])
      .then(([raw, productivityContext, activeAppContext]) => {
        const hints = buildStuckHint(
          (raw as any)?.stuckReasons ?? [],
          (raw as any)?.hintFeedback ?? [],
        )
        const context: StuckChatContext = {
          taskTitle,
          currentStep: currentMicroTask,
          currentSubtaskTitle,
          stuckReason: trimmedReason,
          stuckCategory,
          stuckResponseMode,
          todayTasks: buildTodayTaskSnapshot(),
          productivityContext,
          activeAppContext,
          memoryHint: `${hints.forChips}${hints.forReflection}`,
        }
        // 📊 埋点：卡顿归因。应用线索只记录应用名，不包含窗口标题或网址。
        tracker.track('stuck.reason', {
          sessionId: session.sessionId,
          taskId: session.taskId,
          microAction: currentMicroTask,
          reason: trimmedReason,
          reasonSource,
          stuckCategory,
          stuckResponseMode,
          activeAppContext,
        })
        const initialInstruction = stuckResponseMode === 'direct_action'
          ? '请你直接允许用户先处理这个现实事务或阻碍，并给一个很短的回来点，不要追问。'
          : stuckResponseMode === 'emotion_elaboration'
            ? '请你只问一个开放问题：一想到这件事，脑子里最先冒出来的念头是什么？不要给建议。'
            : '请你主动发起第一条反思对话，只问一个白话开放问题，不要直接给建议。'
        const initialMessages: StuckChatMessage[] = [{
          role: 'user',
          content: `【首轮卡住反思】用户刚才选择/输入的卡住原因是：「${trimmedReason}」。${initialInstruction}`,
        }]
        setStuckChatContext(context)
        return requestStuckChatReply(initialMessages, context, [])
      })
      .catch(() => {
        const context: StuckChatContext = {
          taskTitle,
          currentStep: currentMicroTask,
          currentSubtaskTitle,
          stuckReason: trimmedReason,
          stuckCategory,
          stuckResponseMode,
          todayTasks: buildTodayTaskSnapshot(),
        }
        tracker.track('stuck.reason', {
          sessionId: session.sessionId,
          taskId: session.taskId,
          microAction: currentMicroTask,
          reason: trimmedReason,
          reasonSource,
          stuckCategory,
          stuckResponseMode,
        })
        const initialInstruction = stuckResponseMode === 'direct_action'
          ? '请你直接允许用户先处理这个现实事务或阻碍，并给一个很短的回来点，不要追问。'
          : stuckResponseMode === 'emotion_elaboration'
            ? '请你只问一个开放问题：一想到这件事，脑子里最先冒出来的念头是什么？不要给建议。'
            : '请你主动发起第一条反思对话，只问一个白话开放问题，不要直接给建议。'
        const initialMessages: StuckChatMessage[] = [{
          role: 'user',
          content: `【首轮卡住反思】用户刚才选择/输入的卡住原因是：「${trimmedReason}」。${initialInstruction}`,
        }]
        setStuckChatContext(context)
        requestStuckChatReply(initialMessages, context, []).catch(() => {
          setStuckMessages([
            { role: 'assistant', content: fallbackStuckFirstReply(context) },
          ])
          setStuckChatError('AI 暂时没有回复，先给你一个备用小步骤。')
          setLoadingStuckChat(false)
          setStreamingStuckChat(false)
        })
      })
  }

  // ============ 微任务完成闪动动画状态 ============
  const [showMicroDone, setShowMicroDone] = useState(false)

  /** 微任务完成 → 先播放轻量 ✅ 动画，再跳 relay */
  const handleMicroDoneClick = () => {
    setShowMicroDone(true)
    setTimeout(() => {
      setShowMicroDone(false)
      onMicroComplete()
    }, 800) // 800ms 闪动后跳转（多 300ms 做预加载安全缓冲）
  }

  // ============ 执行状态 / 心流状态 ============
  if (phase === 'executing') {

    // ===== ENABLE_STEP_BY_STEP OFF：简化执行界面 =====
    if (!ENABLE_STEP_BY_STEP) {

      // —— 状态 A：正在执行第一步 ——
      if (!isFlowMode) {
        return (
          <div className="drag-region w-full h-full flex items-center gap-2.5 bg-white/75 hover:bg-white/95 backdrop-blur-md
                          border border-gray-200/35 hover:border-gray-200/60 rounded-xl
                          shadow-[0_2px_12px_rgba(0,0,0,0.035)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.08)]
                          px-3 py-1 select-none overflow-hidden transition-all duration-200">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-xs text-gray-800 truncate max-w-[96px]" title={taskTitle}>{taskTitle}</span>
              <span className="text-gray-400 flex-shrink-0">·</span>
              <span className="text-sm text-gray-950 font-semibold truncate max-w-[230px]" title={currentMicroTask}>
                🎯 {currentMicroTask}
              </span>
            </div>

            <div className="no-drag flex items-center gap-2.5 flex-shrink-0">
              <span className="text-xxs text-gray-400 font-mono
                               bg-gray-100/70 px-2 py-0.5 rounded-lg">{timeStr}</span>
              <button
                onClick={onPause}
                className="flex items-center gap-1 text-xs text-gray-800
                           hover:text-blue-600 active:scale-95 transition-colors whitespace-nowrap"
                title="暂停，去处理别的事"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 9v6m4-6v6" />
                </svg>
                暂停
              </button>
              <button
                onClick={handleMicroDoneClick}
                disabled={showMicroDone}
                className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all
                           ${showMicroDone
                             ? 'bg-teal-400 text-white shadow-sm shadow-teal-200/50'
                             : 'bg-teal-500 text-white shadow-sm shadow-teal-200/50 hover:bg-teal-600 hover:shadow-md hover:shadow-teal-200/60 active:scale-95'
                           }`}
              >
                {showMicroDone ? '已完成' : '完成这一步'}
              </button>
              <button
                onClick={onStuck}
                className="flex items-center gap-1 text-xs text-gray-800
                           hover:text-amber-600 active:scale-95 transition-colors whitespace-nowrap"
                title="卡住了？让AI帮你换条路"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                卡住了?
              </button>
            </div>
          </div>
        )
      }

      // —— 状态 B：第一步完成后进入主任务（无子任务时保持横向低干扰条） ——
      if (taskSubtasks.length === 0 && !session.firstStepHint) {
        return (
          <div className="drag-region w-full h-full flex items-center gap-2.5 bg-white/75 hover:bg-white/95 backdrop-blur-md
                          border border-gray-200/35 hover:border-gray-200/60 rounded-xl
                          shadow-[0_2px_12px_rgba(0,0,0,0.035)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.08)]
                          px-3 py-1 select-none overflow-hidden transition-all duration-200">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-xs text-gray-800 flex-shrink-0">当前任务</span>
              <span className="text-gray-400 flex-shrink-0">·</span>
              <span className="text-sm text-gray-950 font-semibold truncate max-w-[260px]" title={taskTitle}>
                {taskTitle}
              </span>
            </div>

            <div className="no-drag flex items-center gap-2.5 flex-shrink-0">
              <span className="text-xxs text-gray-400 font-mono
                               bg-gray-100/70 px-2 py-0.5 rounded-lg">{timeStr}</span>
              <button
                onClick={onPause}
                className="flex items-center gap-1 text-xs text-gray-800
                           hover:text-blue-600 active:scale-95 transition-colors whitespace-nowrap"
                title="暂停，去处理别的事"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 9v6m4-6v6" />
                </svg>
                暂停
              </button>
              <button
                onClick={(e) => {
                  triggerEffect(e.currentTarget)
                  onTaskDone()
                }}
                className="px-3.5 py-1 rounded-full bg-emerald-500 text-white text-xs font-semibold
                           shadow-sm shadow-emerald-200/50
                           hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                           active:scale-95 transition-all"
              >
                完成主任务
              </button>
              <button
                onClick={onStuck}
                className="flex items-center gap-1 text-xs text-gray-800
                           hover:text-amber-600 active:scale-95 transition-colors whitespace-nowrap"
                title="卡住了？让AI帮你换条路"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                卡住了?
              </button>
            </div>
          </div>
        )
      }

      // —— 任务结构视图（主任务 + AI 第一步提示 + 子任务 checkbox） ——
      const taskStructureRef = taskStructurePanelRef
      return (
        <div ref={taskStructureRef}
             className="drag-region w-full h-full flex flex-col bg-white/85 backdrop-blur-md
                        border border-gray-200/60 rounded-2xl
                        shadow-[0_3px_18px_rgba(0,0,0,0.06)] select-none overflow-hidden">

          {/* 顶部：主任务名 + 计时器 —— ★ 这是拖拽手柄区域，不加 no-drag */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400 font-medium tracking-wide">📋 当前任务</span>
              <span className="text-xxs text-gray-400 font-mono
                               bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
            </div>
            <p className="text-sm text-gray-800 font-semibold mt-1 leading-snug text-center">{taskTitle}</p>
          </div>

          {/* AI 第一步提示行（非强制，仅展示） */}
          {session.firstStepHint && (
            <div className="px-4 pt-0.5 pb-1">
              <p className="text-xxs text-gray-400 leading-snug truncate text-center">
                第一步：{session.firstStepHint}
              </p>
            </div>
          )}

          {/* 中间：子任务列表（有子任务时显示） */}
          {taskSubtasks.length > 0 && (
            <div className="no-drag px-4 py-2.5 flex flex-col gap-1.5 flex-1 overflow-y-auto">
              {taskSubtasks.map((sub) => {
                const checked = sub.completed
                return (
                  <label
                    key={sub.id}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer
                               transition-all hover:bg-gray-50
                               ${checked ? 'opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onWidgetSubtaskToggle?.(sub.id)}
                      className="no-drag w-4 h-4 rounded border-gray-300
                                 text-emerald-500 focus:ring-emerald-200
                                 cursor-pointer flex-shrink-0"
                    />
                    <span className={`text-s leading-snug ${
                      checked
                        ? 'text-gray-400 line-through'
                        : 'text-gray-700'
                    }`}>
                      {sub.title}
                    </span>
                  </label>
                )
              })}
            </div>
          )}

          {/* 底部：暂停 + 完成主任务 + 卡住了 */}
          <div className="no-drag px-3 pb-3 pt-1.5 flex items-center">
            <div className="w-[72px] flex items-center flex-shrink-0">
              <button
                onClick={onPause}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500
                           active:scale-95 transition-colors whitespace-nowrap"
                title="暂停，去处理别的事"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 9v6m4-6v6" />
                </svg>
                暂停
              </button>
            </div>
            <div className="flex-1 flex justify-center">
              <button
                onClick={(e) => {
                  triggerEffect(e.currentTarget)
                  onTaskDone()
                }}
                className="px-5 py-1.5 rounded-full bg-emerald-500 text-white text-xs font-semibold
                           shadow-sm shadow-emerald-200/50
                           hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                           active:scale-95 transition-all"
              >
                ✓ 完成主任务
              </button>
            </div>
            <div className="w-[72px] flex items-center justify-end flex-shrink-0">
              <button
                onClick={onStuck}
                className="flex items-center gap-1 text-xs text-gray-400
                           hover:text-amber-500 active:scale-95 transition-colors whitespace-nowrap"
                title="卡住了？让AI帮你换条路"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                卡住了?
              </button>
            </div>
          </div>
        </div>
      )
    }

    // ===== ENABLE_STEP_BY_STEP ON：原逐步拆解执行界面（含心流模式） =====
    const displayTask = isFlowMode ? taskTitle : currentMicroTask

    return (
      <div className="drag-region w-full h-full flex flex-col justify-center bg-white/85 backdrop-blur-md
                      border border-gray-200/60 rounded-2xl shadow-[0_3px_18px_rgba(0,0,0,0.06)]
                      px-3.5 py-1 select-none overflow-hidden">

        {/* 上行：三栏布局 — 左区（图标）| 中区（任务名）| 右区（计时+关闭），中区绝对居中 */}
        <div className="flex items-center">
          {/* 左区：图标 */}
          <div className="w-[60px] flex items-center flex-shrink-0">
            {isFlowMode ? (
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-violet-500 to-violet-600
                              flex items-center justify-center">
                <span className="text-white text-2xs">🚀</span>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600
                              flex items-center justify-center">
                <span className="text-white text-2xs">🎯</span>
              </div>
            )}
          </div>
          {/* 中区：任务名 */}
          <span className="flex-1 min-w-0 text-md text-gray-800 font-semibold truncate text-center">
            {displayTask}
          </span>
          {/* 右区：计时 + 关闭（宽度与左区平衡） */}
          <div className="w-[60px] flex items-center justify-end gap-1 flex-shrink-0">
            <span className="text-xxs text-gray-400 font-mono
                             bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
            <button
              onClick={onExit}
              className="no-drag w-5 h-5 rounded-md flex items-center justify-center
                         text-gray-300 hover:text-gray-500 hover:bg-gray-100
                         transition-all flex-shrink-0"
              title="退出专注"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 下行：三栏布局 — 左区（暂停）| 完成按钮居中 | 卡住了右对齐，与上行对齐 */}
        <div className="flex items-center mt-1">
          {/* 左区：暂停（与上行左区同宽） */}
          <div className="w-[60px] flex items-center flex-shrink-0">
            <button
              onClick={onPause}
              className="no-drag flex items-center gap-1 text-2xs text-gray-400
                         hover:text-blue-500 active:scale-95 transition-colors whitespace-nowrap"
              title="暂停，去处理别的事"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 9v6m4-6v6" />
              </svg>
              暂停
            </button>
          </div>
          {/* 完成按钮 — 居中主角 */}
          <div className="flex-1 flex justify-center">
            <button
              onClick={(e) => {
                if (isFlowMode) {
                  triggerEffect(e.currentTarget)
                  onTaskDone()
                } else {
                  handleMicroDoneClick()
                }
              }}
              disabled={showMicroDone}
              className={`no-drag px-5 py-1.5 rounded-full
                         text-xs font-semibold transition-all
                         ${showMicroDone
                           ? 'bg-teal-400 text-white shadow-sm shadow-teal-200/50'
                           : 'bg-teal-500 text-white shadow-sm shadow-teal-200/50 hover:bg-teal-600 active:scale-95'
                         }`}
            >
              {showMicroDone ? '✅' : '✓ 完成'}
            </button>
          </div>
          {/* 卡住了 — 右对齐（与上行右区同宽） */}
          <div className="w-[60px] flex items-center justify-end flex-shrink-0">
            {!isFlowMode && (
              <button
                onClick={onStuck}
                className="no-drag flex items-center gap-1 text-2xs text-gray-400
                           hover:text-amber-500 active:scale-95 transition-colors whitespace-nowrap"
                title="卡住了？让AI帮你换条路"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                卡住了?
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ============ 急救状态A：描述困难 + 常见原因标签 ============
  if (phase === 'stuck_a') {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        {/* 顶部条 —— ★ 文字区域可拖拽，只有按钮需要 no-drag */}
        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-500
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white text-2xs">🆘</span>
          </div>
          <span className="text-xs text-orange-600 font-medium flex-1 truncate">
            卡住了：{currentMicroTask}
          </span>
          <span className="text-xs text-gray-500 font-mono flex-shrink-0
                           bg-gray-100/80 px-2 py-0.5 rounded-md">{timeStr}</span>
          <button
            onClick={() => onResume(currentMicroTask)}
            className="no-drag w-6 h-6 rounded-xl flex items-center justify-center
                       text-gray-300 hover:text-gray-500 hover:bg-gray-100
                       transition-all flex-shrink-0"
            title="返回继续做"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="no-drag flex-1 px-4 py-3 flex flex-col gap-3 overflow-y-auto">

          {/* 提示语 */}
          <p className="text-xs text-gray-600 leading-relaxed">
            描述一下你遇到了<span className="text-orange-600 font-bold">什么困难</span>？
          </p>

          {/* 输入框 */}
          <textarea
            ref={stuckInputRef as unknown as React.RefObject<HTMLTextAreaElement>}
            value={stuckInput}
            onChange={(e) => setStuckInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && stuckInput.trim()) {
                e.preventDefault()
                handleSubmitStuckReason(stuckInput.trim(), 'self')
              }
              if (e.key === 'Escape') onResume(currentMicroTask)
            }}
            placeholder="我现在遇到的问题是……"
            maxLength={200}
            rows={2}
            className="w-full px-3.5 py-2.5 text-xs rounded-lg border border-gray-200
                       focus:border-orange-400 focus:ring-1 focus:ring-orange-100
                       outline-none bg-gray-50 focus:bg-white transition-all resize-none"
          />

          {/* 常见原因标签 */}
          <div className="flex flex-col gap-1.5">
            <p className="text-2xs text-gray-400 font-medium">常见原因（点击填入）：</p>
            <div className="flex flex-wrap gap-1.5">
              {STUCK_COMMON_REASONS.map((reason, i) => (
                <button
                  key={i}
                  onClick={() => setStuckInput(reason)}
                  className={`text-left text-xxs px-2.5 py-1.5 rounded-lg transition-all
                    ${stuckInput === reason
                      ? 'bg-orange-100 text-orange-700 border border-orange-300'
                      : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200'
                    }`}
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>

          {/* Reflect 按钮 */}
          <div className="flex justify-center pt-1">
            <button
              onClick={() => {
                if (stuckInput.trim()) {
                  const source = STUCK_COMMON_REASONS.includes(stuckInput.trim()) ? 'common_chip' : 'self'
                  handleSubmitStuckReason(stuckInput.trim(), source as 'common_chip' | 'self')
                }
              }}
              disabled={!stuckInput.trim()}
              className="px-6 py-2 rounded-xl bg-orange-500 text-white text-xs font-semibold
                         shadow-sm shadow-orange-200/50
                         hover:bg-orange-600 hover:shadow-md hover:shadow-orange-200/60
                         active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                         transition-all"
            >
              聊一下吧
            </button>
          </div>

          {/* 返回继续执行 */}
          <div className="flex items-center justify-end pt-1 border-t border-gray-100/80">
            <button
              onClick={() => onResume(currentMicroTask)}
              className="text-xxs text-gray-400 hover:text-gray-600 transition-colors"
            >
              没事，我继续做 →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ============ 急救状态B：AI 急救对话 ============
  if (phase === 'stuck_b') {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        {/* 顶部条 —— ★ 文字区域可拖拽，只有按钮需要 no-drag */}
        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-500
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white text-2xs">AI</span>
          </div>
          <span className="text-xs text-amber-700 font-medium flex-1 truncate">
            聊一聊吧
          </span>
          <span className="text-xs text-gray-500 font-mono flex-shrink-0
                           bg-gray-100/80 px-2 py-0.5 rounded-md">{timeStr}</span>
          <button
            onClick={() => onResume(currentMicroTask)}
            className="no-drag w-6 h-6 rounded-xl flex items-center justify-center
                       text-gray-300 hover:text-gray-500 hover:bg-gray-100
                       transition-all flex-shrink-0"
            title="返回继续做"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="no-drag flex-1 px-4 py-3 flex flex-col gap-2.5 min-h-0">
          <div className="text-xxs text-gray-500 bg-amber-50/70 border border-amber-100 rounded-xl px-3 py-2 leading-relaxed">
            <span className="block truncate">
              任务：<span className="text-amber-700 font-medium">{taskTitle}</span>
            </span>
            <span className="block truncate mt-0.5">
              卡住原因：<span className="text-amber-700">{stuckReason || '这个步骤'}</span>
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5">
            {stuckMessages.map((message, index) => (
              message.role === 'assistant' && !message.content.trim()
                ? null
                : (
                    <div
                      key={`${message.role}-${index}`}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`no-drag select-text cursor-text max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-[1.65] ${
                          message.role === 'user'
                            ? 'bg-orange-500 text-white rounded-br-md'
                            : 'bg-gray-50 text-gray-700 border border-gray-100 rounded-bl-md'
                        }`}
                        style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                      >
                        {renderStuckMessageContent(message.content)}
                      </div>
                    </div>
                  )
            ))}

            {loadingStuckChat && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-bl-md px-3 py-2">
                  <AILoadingTips
                    variant="stuck"
                    title="AI 正在思考"
                    compact
                    mode="dots"
                  />
                </div>
              </div>
            )}

            <div ref={stuckMessagesEndRef} />
          </div>

          {stuckChatError && (
            <div className="text-xxs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
              {stuckChatError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <textarea
              ref={stuckChatInputRef}
              value={stuckChatInput}
              onChange={(e) => setStuckChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendStuckChat()
                }
              }}
              placeholder="想调整回复，可以在这里说"
              rows={1}
              disabled={isStuckChatBusy}
              className="h-11 flex-1 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5
                         text-xs text-gray-700 placeholder:text-gray-300 outline-none
                         focus:border-orange-300 focus:ring-2 focus:ring-orange-100
                         disabled:bg-gray-50 disabled:text-gray-400 transition-all"
            />
            <button
              onClick={handleSendStuckChat}
              disabled={!stuckChatInput.trim() || isStuckChatBusy || !stuckChatContext}
              className="h-11 px-3.5 rounded-xl bg-orange-500 text-white text-xs font-semibold
                         hover:bg-orange-600 active:scale-95 disabled:opacity-40
                         disabled:cursor-not-allowed transition-all"
            >
              发送
            </button>
          </div>

          <div className="flex items-center justify-between pt-1.5 border-t border-gray-100/80">
            <span className="text-xxs text-gray-400">找到一个能做的小动作就回去试试吧。</span>
            <button
              onClick={() => onResume(currentMicroTask)}
              className="px-4 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold
                         shadow-sm shadow-emerald-200/50 hover:bg-emerald-600
                         active:scale-95 transition-all"
              >
              继续任务
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ============ 接力状态（展开面板）============
  // 当 ENABLE_STEP_BY_STEP 关闭时，不应到达此处（App.tsx 会拦截 relay 转向）
  // 但防御性处理：如果意外到达，返回空
  if (!ENABLE_STEP_BY_STEP) return null

  // ---- 所有子任务完成特殊界面 ----
  if (allSubtasksDone) {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        {/* ★ 顶部条文字区域可拖拽 */}
        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-xs text-emerald-600 font-medium flex-1 truncate">
            所有子任务都搞定了！
          </span>
          <button
            onClick={onExit}
            className="no-drag w-6 h-6 rounded-xl flex items-center justify-center
                       text-gray-300 hover:text-gray-500 hover:bg-gray-100
                       transition-all flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="no-drag flex-1 px-4 py-4 flex flex-col items-center justify-center gap-4">
          <p className="text-sm text-gray-600 font-medium text-center">
            🎉 「{taskTitle}」的子任务全部完成！<br />
            <span className="text-gray-400 text-xs">整个任务也搞定了吗？</span>
          </p>
          <div className="flex gap-3">
            <button
              onClick={(e) => {
                triggerEffect(e.currentTarget)
                onTaskDone()
              }}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold
                         shadow-sm shadow-emerald-200/50
                         hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                         active:scale-95 transition-all"
            >
              ✓ 完成整个任务
            </button>
            <button
              onClick={onEnterFlow}
              className="px-4 py-2.5 rounded-xl bg-violet-50 text-violet-600 text-sm font-semibold
                         border border-violet-200
                         hover:bg-violet-100 hover:border-violet-300
                         active:scale-95 transition-all"
            >
              🚀 继续做
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- 常规接力面板 ----
  return (
    <div ref={relayPanelRef}
         className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                    border border-gray-200/60 rounded-2xl
                    shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

      {/* ① 顶部：任务方向锚点 —— ★ 可拖拽区域（只有 × 按钮是 no-drag） */}
      <div className="px-4 pt-3 pb-2.5 border-b border-gray-100/60">
        <div className="flex items-center justify-between">
          <span className="text-2xs text-gray-400 font-medium tracking-wide">正在推进</span>
          <div className="flex items-center gap-1.5">
            {/* 轻量步数 + 计时 */}
            <span className="text-2xs text-emerald-500 font-medium">
              第 {session.microHistory.length + 1} 步
            </span>
            <span className="text-2xs text-gray-400 font-mono
                             bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
            <button
              onClick={onExit}
              className="no-drag w-5 h-5 rounded-md flex items-center justify-center
                         text-gray-300 hover:text-gray-500 hover:bg-gray-100
                         transition-all flex-shrink-0"
              title="退出专注"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {/* 主任务标题 */}
        <p className="text-s text-gray-800 font-semibold truncate mt-1">{taskTitle}</p>
        {/* 当前子任务阶段（有子任务才显示） */}
        {currentSubtaskTitle && (
          <p className="text-xxs text-indigo-500 mt-0.5 truncate">
            {isSubtaskTransition ? '进入新阶段：' : '当前阶段：'}{currentSubtaskTitle}
          </p>
        )}
      </div>

      {/* ② 中间主区域 */}
      <div className="no-drag px-4 py-3 flex flex-col gap-2.5 flex-1">

        {/* 刚完成提示 —— 很轻的一句话，串起上下文连续感 */}
        <p className="text-xxs text-gray-400 truncate leading-relaxed">
          {isSubtaskTransition
            ? '✓ 上一阶段已完成，继续往下走'
            : <>✓ 刚完成：<span className="text-emerald-500">{currentMicroTask}</span></>}
        </p>

        {/* 主问题 —— 口语化、低压力 */}
        <p className="text-xs text-gray-600 font-medium leading-relaxed">
          接下来最顺手的一小步是什么？
        </p>

        {/* 输入框 + 确认按钮 */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={nextMicro}
            onChange={(e) => setNextMicro(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleContinue() }}
            placeholder="比如：先读第 1 题…"
            maxLength={50}
            className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-gray-200
                       focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100
                       outline-none bg-gray-50 focus:bg-white transition-all"
          />
          <button
            onClick={handleContinue}
            disabled={!nextMicro.trim()}
            className="px-3.5 py-2 rounded-xl bg-emerald-500 text-white text-xs font-semibold
                       shadow-sm shadow-emerald-200/50
                       hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                       active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                       transition-all flex-shrink-0"
          >
            就做这个
          </button>
        </div>

        {/* AI 快捷接力区 —— 点一下直接开始，不用再确认 */}
        <div className="flex flex-col gap-1.5 min-h-[24px]">
          {loadingChips && (
            <span className="text-2xs text-gray-400 flex items-center gap-1.5">
              <span className="w-3 h-3 border-[1.5px] border-gray-300 border-t-emerald-400 rounded-full animate-spin" />
              AI 在帮你想…
            </span>
          )}
          {!loadingChips && chips.length > 0 && (
            <>
              <p className="text-2xs text-gray-400">也可以直接接这个：</p>
              <div className="flex flex-wrap gap-2">
                {chips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => onNextMicro(chip.action)}
                    className="text-xxs px-3 py-1.5 rounded-xl
                               bg-emerald-500 text-white border border-emerald-500
                               hover:bg-emerald-600 hover:border-emerald-600
                               shadow-sm shadow-emerald-200/50
                               active:scale-[0.98] transition-all"
                  >
                    ▶ {chip.action}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ③ 底部辅助操作 —— 全部降级成小字，不抢主流程 */}
      <div className="no-drag px-4 pb-2.5 pt-1.5 border-t border-gray-100/60 flex items-center gap-1">
        <button
          onClick={onPause}
          className="px-2 py-1 rounded-lg text-xxs text-gray-400 whitespace-nowrap
                     hover:bg-gray-100 hover:text-gray-600
                     active:scale-95 transition-all"
          title="暂停当前任务，切换到其他任务"
        >
          暂停一下
        </button>
        {currentSubtaskId && (
          <button
            onClick={onSubtaskDone}
            className="px-2 py-1 rounded-lg text-xxs text-gray-400 whitespace-nowrap
                       hover:bg-indigo-50 hover:text-indigo-500
                       active:scale-95 transition-all"
          >
            下个子任务
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onEnterFlow}
          className="px-2 py-1 rounded-lg text-xxs text-gray-400 whitespace-nowrap
                     hover:bg-violet-50 hover:text-violet-500
                     active:scale-95 transition-all"
        >
          🚀 直接做
        </button>
        <button
          onClick={(e) => {
            triggerEffect(e.currentTarget)
            onTaskDone()
          }}
          className="px-2 py-1 rounded-lg text-xxs text-gray-400 whitespace-nowrap
                     hover:bg-emerald-50 hover:text-emerald-500
                     active:scale-95 transition-all"
        >
          这个任务做完了
        </button>
      </div>
    </div>
  )
}

// ===================== 快速专注模式小组件 =====================

interface QuickFocusWidgetProps {
  session: FocusSession
  onTaskDone: () => void    // 点击"做完了" → 触发结束弹窗
  onExit: () => void        // 退出专注（不保存）
}

/**
 * 快速专注模式下的简化 Widget
 * 只显示"专注中..."文字 + 计时器 + 做完了/退出 两个按钮
 */
function QuickFocusWidget({ session, onTaskDone, onExit }: QuickFocusWidgetProps) {
  const { sessionStartTime } = session
  const offset = session.elapsedOffset || 0  // 暂停→恢复后累计的历史秒数
  const [elapsed, setElapsed] = useState(0)

  // 每秒更新计时
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000) + offset)
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [sessionStartTime, offset])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <div className="drag-region w-full h-full flex items-center gap-2.5 bg-white/75 hover:bg-white/95 backdrop-blur-md
                    border border-gray-200/35 hover:border-gray-200/60 rounded-xl
                    shadow-[0_2px_12px_rgba(0,0,0,0.035)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.08)]
                    px-3 py-1 select-none overflow-hidden transition-all duration-200">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-sm text-gray-950 font-semibold truncate">专注中</span>
      </div>

      <div className="no-drag flex items-center gap-2.5 flex-shrink-0">
        <span className="text-xxs text-gray-400 font-mono
                         bg-gray-100/70 px-2 py-0.5 rounded-lg">{timeStr}</span>
        <button
          onClick={onTaskDone}
          className="px-4 py-1 rounded-full bg-emerald-500 text-white text-xs font-semibold
                     shadow-sm shadow-emerald-200/50 hover:bg-emerald-600
                     hover:shadow-md hover:shadow-emerald-200/60 active:scale-95 transition-all"
        >
          做完了
        </button>
        <button
          onClick={onExit}
          className="text-xs text-gray-800 hover:text-red-600 active:scale-95 transition-all whitespace-nowrap"
          title="退出专注"
        >
          退出
        </button>
      </div>
    </div>
  )
}

// ===================== 旧版普通小组件（无 session 时使用）=====================

import { PRIORITY_CONFIG } from '../types'

interface LegacyWidgetProps {
  tasks: Task[]
  focusTaskId?: string | null
  onToggle: (id: string) => void
  onExit: () => void
}

function LegacyWidget({ tasks, focusTaskId, onToggle, onExit }: LegacyWidgetProps) {
  const pendingTasks = tasks.filter(t => !t.completed)
  const isFocusMode = !!focusTaskId
  const focusTask = focusTaskId ? tasks.find(t => t.id === focusTaskId) : null
  const visibleTasks = pendingTasks.slice(0, 3)
  const hiddenCount = pendingTasks.length - visibleTasks.length

  return (
    <div className="drag-region w-full h-full flex items-center bg-white border border-gray-200 rounded-xl shadow-lg px-2 gap-1.5 select-none overflow-hidden">
      <div className="no-drag flex items-center gap-1.5 flex-shrink-0">
        <div className="relative">
          {isFocusMode ? (
            <div className="w-7 h-7 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </div>
          ) : (
            <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
          )}
          {!isFocusMode && pendingTasks.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold leading-none">
              {pendingTasks.length > 9 ? '9+' : pendingTasks.length}
            </span>
          )}
        </div>
        <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
      </div>

      <div className="no-drag flex-1 flex items-center gap-1.5 overflow-hidden">
        {isFocusMode ? (
          focusTask && !focusTask.completed ? (
            <div className="flex items-center gap-1.5 w-full overflow-hidden">
              <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium">专注</span>
              <WidgetTaskChip task={focusTask} onToggle={onToggle} />
            </div>
          ) : (
            <span className="text-xs text-green-500 flex items-center gap-1"><span>🎉</span><span>任务完成！</span></span>
          )
        ) : pendingTasks.length === 0 ? (
          <span className="text-xs text-gray-400 flex items-center gap-1"><span>🎉</span><span>所有任务已完成！</span></span>
        ) : (
          <>
            {visibleTasks.map(t => <WidgetTaskChip key={t.id} task={t} onToggle={onToggle} />)}
            {hiddenCount > 0 && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">+{hiddenCount}</span>
            )}
          </>
        )}
      </div>

      <div className="no-drag flex items-center gap-0.5 flex-shrink-0">
        <div className="w-px h-5 bg-gray-200 flex-shrink-0 mr-1" />
        <button onClick={onExit} className="w-7 h-7 rounded-lg hover:bg-indigo-50 flex items-center justify-center text-gray-400 hover:text-indigo-500 transition-colors" title="展开主界面">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function WidgetTaskChip({ task, onToggle }: { task: Task; onToggle: (id: string) => void }) {
  const dotColor = PRIORITY_CONFIG[task.priority].dot
  return (
    <div className="flex items-center gap-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-2 py-1 flex-shrink-0 max-w-[120px] transition-colors group cursor-default">
      <button onClick={(e) => { onToggle(task.id); triggerEffect(e.currentTarget) }}
        className="w-3.5 h-3.5 rounded-full border border-gray-300 group-hover:border-indigo-400 flex-shrink-0 flex items-center justify-center transition-colors hover:bg-indigo-50">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      </button>
      <span className="text-xs text-gray-700 truncate">{task.title}</span>
    </div>
  )
}
