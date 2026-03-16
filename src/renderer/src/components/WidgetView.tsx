/**
 * WidgetView —— 阶段2：Dynamic Bar（执行与单步接力）
 *
 * 五种阶段：
 *   executing  – 正在执行微任务：任务名 + 计时 + [✓完成] + [🆘卡住了]
 *   relay      – 微任务完成后展开：输入下一步 + AI筹码 + [继续] + [🚀直接做]
 *   stuck_a    – 急救状态A：LLM 提示 + 卡点预测筹码 + 自由输入
 *   stuck_b    – 急救状态B：同理心安抚 + 绕路筹码 + 自定义输入
 *   flow       – 心流模式：只显示宏观任务名 + 计时 + [✓完成]
 *
 * 窗口尺寸：
 *   executing / flow → 380×48（薄条）
 *   relay            → 380×232（展开）
 *   stuck_a / stuck_b→ 380×304（急救面板）
 */

import { useState, useEffect, useRef } from 'react'
import type { Task } from '../types'
import type { AIConfig, MicroActionChip } from '../services/ai'
import { generateStuckChips, generatePivotResponse, generateStuckReflection } from '../services/ai'
import type { PivotResult, StuckReflectionResult } from '../services/ai'
import { aiCache } from '../services/ai-cache'
import { tracker } from '../services/tracker'
import { triggerEffect } from '../effects'

// ===================== 常量 =====================

const BAR_W = 380
const BAR_H_THIN = 66
const BAR_H_RELAY = 280
const BAR_H_STUCK = 340
const BAR_H_FIRST_STEP = 92   // 简化模式：父任务 + 当前步骤 + 按钮行

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
}

/** 快速专注模式下的薄条高度 */
const BAR_H_QUICK = 66

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
  session, aiConfig, taskSubtasks,
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
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - timerBase) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [timerBase])

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

  const [pivotData, setPivotData] = useState<PivotResult | null>(null)
  const [loadingPivot, setLoadingPivot] = useState(false)
  const [pivotInput, setPivotInput] = useState('')
  const pivotInputRef = useRef<HTMLInputElement>(null)

  // ---- 卡住反思状态 ----
  const [reflectionData, setReflectionData] = useState<StuckReflectionResult | null>(null)
  const [loadingReflection, setLoadingReflection] = useState(false)

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
      window.electronAPI.resizeWidget(BAR_W, h)
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
      window.electronAPI.resizeWidget(BAR_W, BAR_H_STUCK)
      stuckInputRef.current?.focus()
      // 请求 AI 卡点预测
      setStuckChips([])
      setStuckInput('')
      if (aiConfig.apiKey && aiConfig.modelId) {
        setLoadingStuck(true)
        generateStuckChips(taskTitle, currentMicroTask, aiConfig)
          .then(({ chips: c }) => setStuckChips(c))
          .finally(() => setLoadingStuck(false))
      }
    } else if (phase === 'stuck_b') {
      window.electronAPI.resizeWidget(BAR_W, BAR_H_STUCK)
      pivotInputRef.current?.focus()
    } else {
      // executing / flow
      let execHeight = BAR_H_THIN
      if (!ENABLE_STEP_BY_STEP) {
        if (isFlowMode) {
          // 任务结构视图：基础高度 + 每个子任务 36px，上限 300px
          const baseH = 110  // 顶部任务名 + 底部按钮
          const subsH = taskSubtasks.length * 36
          execHeight = Math.min(baseH + subsH, 300)
        } else {
          execHeight = BAR_H_FIRST_STEP
        }
      }
      window.electronAPI.resizeWidget(BAR_W, execHeight)
      setNextMicro('')
      setChips([])
      setStuckChips([])
      setStuckInput('')
      setPivotData(null)
      setPivotInput('')
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
        window.electronAPI.resizeWidget(BAR_W, h)
      }
    })
    return () => cancelAnimationFrame(frameId)
  }, [phase, allSubtasksDone, chips, loadingChips, currentSubtaskId])

  // relay 继续
  const handleContinue = () => {
    const text = nextMicro.trim()
    if (text) onNextMicro(text)
  }

  // stuck_a → stuck_b：用户点击 Reflect，提交困难描述并请求 AI 反思提示
  const handleSubmitStuckReason = (reason: string, reasonSource: 'common_chip' | 'self') => {
    if (!reason.trim()) return

    // 📊 埋点：卡顿归因
    tracker.track('stuck.reason', {
      sessionId: session.sessionId,
      taskId: session.taskId,
      microAction: currentMicroTask,
      reason: reason.trim(),
      reasonSource,
    })

    // 切换到 stuck_b 阶段（显示反思提示）
    onStuckToB()

    // 请求 AI 生成反思提示
    setLoadingReflection(true)
    setReflectionData(null)

    generateStuckReflection(taskTitle, currentMicroTask, reason.trim(), aiConfig)
      .then(result => {
        if (result.reflection) {
          setReflectionData(result.reflection)
          // 📊 埋点：AI 生成了反思提示
          tracker.track('stuck.reflection_shown', {
            sessionId: session.sessionId,
            taskId: session.taskId,
            difficulty: reason.trim(),
            reflection: JSON.stringify(result.reflection),
          })
        } else {
          // AI 返回失败时用 fallback
          setReflectionData({
            interpret: '暂时没能帮你分析，不过没关系——试着自己想一想刚才为什么会卡住。',
            hints: ['回忆一下刚才具体卡在哪个点？'],
            cheer: '你可以的 💪',
          })
        }
        setLoadingReflection(false)
      })
      .catch(() => {
        setReflectionData({
          interpret: '网络不太好，不过没关系——这也是一个暂停思考的机会。',
          hints: ['想想刚才卡在哪一步，也许答案已经在你脑海里了'],
          cheer: '相信自己 ✨',
        })
        setLoadingReflection(false)
      })
  }

  // stuck_b → 重启：用户选了绕路方案或自定义输入
  const handlePivotResume = (newMicro: string, pivotSource: 'ai_chip' | 'self' | 'resume_original') => {
    if (newMicro.trim()) {
      // 📊 埋点：用户选择了绕路方案
      tracker.track('stuck.pivot_chosen', {
        sessionId: session.sessionId,
        taskId: session.taskId,
        chosenPivot: newMicro.trim(),
        pivotSource,
      })
      onResume(newMicro.trim())
    }
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
          <div className="drag-region w-full h-full flex flex-col justify-center bg-white/95 backdrop-blur-sm
                          border border-gray-200/60 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)]
                          px-4 py-2 select-none overflow-hidden">

            {/* Row 1: 父任务名（居中）+ 计时器 */}
            <div className="flex items-center">
              <div className="w-[48px] flex-shrink-0" />
              <p className="flex-1 text-[12px] text-gray-500 text-center truncate">{taskTitle}</p>
              <span className="w-[48px] text-[11px] text-gray-400 font-mono text-right flex-shrink-0
                               bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
            </div>

            {/* Row 2: 当前步骤（居中，加粗，行动焦点） */}
            <p className="text-[14px] text-gray-800 font-semibold text-center mt-1 leading-snug">
              🎯 {currentMicroTask}
            </p>

            {/* Row 3: 暂停 | 完成这一步 | 卡住了? */}
            <div className="flex items-center mt-2">
              <div className="w-[60px] flex items-center flex-shrink-0">
                <button
                  onClick={onPause}
                  className="no-drag text-[11px] text-gray-400
                             hover:text-blue-500 active:scale-95 transition-all whitespace-nowrap"
                  title="暂停，去处理别的事"
                >
                  暂停
                </button>
              </div>
              <div className="flex-1 flex justify-center">
                <button
                  onClick={handleMicroDoneClick}
                  disabled={showMicroDone}
                  className={`no-drag px-6 py-1.5 rounded-xl
                             text-xs font-semibold transition-all
                             ${showMicroDone
                               ? 'bg-teal-400 text-white scale-110 shadow-md shadow-teal-200/60'
                               : 'bg-teal-500 text-white shadow-sm shadow-teal-200/50 hover:bg-teal-600 active:scale-95'
                             }`}
                >
                  {showMicroDone ? '✅' : '完成这一步'}
                </button>
              </div>
              <div className="w-[60px] flex items-center justify-end flex-shrink-0">
                <button
                  onClick={onStuck}
                  className="no-drag text-[11px] text-amber-500
                             hover:text-amber-600 active:scale-95 transition-all whitespace-nowrap"
                  title="卡住了？让AI帮你换条路"
                >
                  卡住了?
                </button>
              </div>
            </div>
          </div>
        )
      }

      // —— 状态 B：第一步已完成 → 任务结构视图（主任务 + 子任务 checkbox） ——
      const taskStructureRef = taskStructurePanelRef
      return (
        <div ref={taskStructureRef}
             className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                        border border-gray-200/60 rounded-2xl
                        shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

          {/* 顶部：主任务名 + 计时器 —— ★ 这是拖拽手柄区域，不加 no-drag */}
          <div className="px-4 pt-3 pb-2 border-b border-gray-100/60">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400 font-medium tracking-wide">📋 当前任务</span>
              <span className="text-[11px] text-gray-400 font-mono
                               bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
            </div>
            <p className="text-[14px] text-gray-800 font-semibold mt-1 leading-snug text-center">{taskTitle}</p>
          </div>

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
                    <span className={`text-[13px] leading-snug ${
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
          <div className="no-drag px-4 pb-3 pt-2 border-t border-gray-100/60 flex items-center">
            <div className="w-[60px] flex items-center flex-shrink-0">
              <button
                onClick={onPause}
                className="text-[11px] text-gray-400 hover:text-blue-500
                           active:scale-95 transition-all whitespace-nowrap"
                title="暂停，去处理别的事"
              >
                暂停
              </button>
            </div>
            <div className="flex-1 flex justify-center">
              <button
                onClick={(e) => {
                  triggerEffect(e.currentTarget)
                  onTaskDone()
                }}
                className="px-5 py-2 rounded-xl bg-emerald-500 text-white text-xs font-semibold
                           shadow-sm shadow-emerald-200/50
                           hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                           active:scale-95 transition-all"
              >
                ✓ 完成主任务
              </button>
            </div>
            <div className="w-[60px] flex items-center justify-end flex-shrink-0">
              <button
                onClick={onStuck}
                className="text-[11px] text-amber-500
                           hover:text-amber-600 active:scale-95 transition-all whitespace-nowrap"
                title="卡住了？让AI帮你换条路"
              >
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
      <div className="drag-region w-full h-full flex flex-col justify-center bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)]
                      px-3.5 py-1 select-none overflow-hidden">

        {/* 上行：三栏布局 — 左区（图标）| 中区（任务名）| 右区（计时+关闭），中区绝对居中 */}
        <div className="flex items-center">
          {/* 左区：图标 */}
          <div className="w-[60px] flex items-center flex-shrink-0">
            {isFlowMode ? (
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-violet-500 to-violet-600
                              flex items-center justify-center">
                <span className="text-white text-[10px]">🚀</span>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600
                              flex items-center justify-center">
                <span className="text-white text-[10px]">🎯</span>
              </div>
            )}
          </div>
          {/* 中区：任务名 */}
          <span className="flex-1 min-w-0 text-[15px] text-gray-800 font-semibold truncate text-center">
            {displayTask}
          </span>
          {/* 右区：计时 + 关闭（宽度与左区平衡） */}
          <div className="w-[60px] flex items-center justify-end gap-1 flex-shrink-0">
            <span className="text-[11px] text-gray-400 font-mono
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
          {/* 左区：暂停文字按钮（与上行左区同宽） */}
          <div className="w-[60px] flex items-center flex-shrink-0">
            <button
              onClick={onPause}
              className="no-drag text-[11px] text-gray-400
                         hover:text-blue-500 active:scale-95 transition-all whitespace-nowrap"
              title="暂停，去处理别的事"
            >
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
              className={`no-drag px-6 py-1.5 rounded-xl
                         text-xs font-semibold transition-all
                         ${showMicroDone
                           ? 'bg-teal-400 text-white scale-110 shadow-md shadow-teal-200/60'
                           : 'bg-teal-500 text-white shadow-sm shadow-teal-200/50 hover:bg-teal-600 active:scale-95'
                         }`}
            >
              {showMicroDone ? '✅' : '✓ 完成'}
            </button>
          </div>
          {/* 卡住了 — 右对齐次级文字（与上行右区同宽，垂直对齐） */}
          <div className="w-[60px] flex items-center justify-end flex-shrink-0">
            {!isFlowMode && (
              <button
                onClick={onStuck}
                className="no-drag text-[11px] text-amber-500
                           hover:text-amber-600 active:scale-95 transition-all whitespace-nowrap"
                title="卡住了？让AI帮你换条路"
              >
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
            <span className="text-white text-[10px]">🆘</span>
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
            className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-gray-200
                       focus:border-orange-400 focus:ring-1 focus:ring-orange-100
                       outline-none bg-gray-50 focus:bg-white transition-all resize-none"
          />

          {/* 常见原因标签 */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] text-gray-400 font-medium">常见原因（点击填入）：</p>
            <div className="flex flex-wrap gap-1.5">
              {STUCK_COMMON_REASONS.map((reason, i) => (
                <button
                  key={i}
                  onClick={() => setStuckInput(reason)}
                  className={`text-left text-[11px] px-2.5 py-1.5 rounded-lg transition-all
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
              Reflect
            </button>
          </div>

          {/* 返回继续执行 */}
          <div className="flex items-center justify-end pt-1 border-t border-gray-100/80">
            <button
              onClick={() => onResume(currentMicroTask)}
              className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              没事，我继续做 →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ============ 急救状态B：反思提示 ============
  if (phase === 'stuck_b') {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        {/* 顶部条 —— ★ 文字区域可拖拽，只有按钮需要 no-drag */}
        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-amber-500
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white text-[10px]">💡</span>
          </div>
          <span className="text-xs text-amber-700 font-medium flex-1 truncate">
            反思提示
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

        {/* 反思内容 —— 单卡片自然呈现，ADHD 友好 */}
        <div className="no-drag flex-1 px-4 py-3 flex flex-col gap-2.5 overflow-y-auto">

          {/* 加载中 */}
          {loadingReflection && (
            <div className="flex items-center gap-2 py-6 justify-center">
              <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-amber-400 rounded-full animate-spin" />
              <span className="text-xs text-gray-400">AI 正在帮你梳理思路…</span>
            </div>
          )}

          {/* 反思卡片 —— 统一样式，分段但不分格式 */}
          {!loadingReflection && reflectionData && (
            <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl px-4 py-3
                            text-xs text-gray-700 leading-[1.85] flex flex-col gap-2">
              <p>{reflectionData.interpret}</p>
              {reflectionData.hints.length > 0 && (
                <p>
                  {reflectionData.hints.map((h, i) => (
                    <span key={i}>{i > 0 && <br />}💡 {h}</span>
                  ))}
                </p>
              )}
              <p>{reflectionData.cheer}</p>
            </div>
          )}

          {/* Continue task 按钮 */}
          {!loadingReflection && (
            <div className="flex justify-center pt-0.5">
              <button
                onClick={() => onResume(currentMicroTask)}
                className="px-6 py-2 rounded-xl bg-emerald-500 text-white text-xs font-semibold
                           shadow-sm shadow-emerald-200/50
                           hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                           active:scale-95 transition-all"
              >
                继续任务
              </button>
            </div>
          )}
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
          <span className="text-[10px] text-gray-400 font-medium tracking-wide">正在推进</span>
          <div className="flex items-center gap-1.5">
            {/* 轻量步数 + 计时 */}
            <span className="text-[10px] text-emerald-500 font-medium">
              第 {session.microHistory.length + 1} 步
            </span>
            <span className="text-[10px] text-gray-400 font-mono
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
        <p className="text-[13px] text-gray-800 font-semibold truncate mt-1">{taskTitle}</p>
        {/* 当前子任务阶段（有子任务才显示） */}
        {currentSubtaskTitle && (
          <p className="text-[11px] text-indigo-500 mt-0.5 truncate">
            {isSubtaskTransition ? '进入新阶段：' : '当前阶段：'}{currentSubtaskTitle}
          </p>
        )}
      </div>

      {/* ② 中间主区域 */}
      <div className="no-drag px-4 py-3 flex flex-col gap-2.5 flex-1">

        {/* 刚完成提示 —— 很轻的一句话，串起上下文连续感 */}
        <p className="text-[11px] text-gray-400 truncate leading-relaxed">
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
            className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-gray-200
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
            <span className="text-[10px] text-gray-400 flex items-center gap-1.5">
              <span className="w-3 h-3 border-[1.5px] border-gray-300 border-t-emerald-400 rounded-full animate-spin" />
              AI 在帮你想…
            </span>
          )}
          {!loadingChips && chips.length > 0 && (
            <>
              <p className="text-[10px] text-gray-400">也可以直接接这个：</p>
              <div className="flex flex-wrap gap-2">
                {chips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => onNextMicro(chip.action)}
                    className="text-[11px] px-3 py-1.5 rounded-xl
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
          className="px-2 py-1 rounded-lg text-[11px] text-gray-400 whitespace-nowrap
                     hover:bg-gray-100 hover:text-gray-600
                     active:scale-95 transition-all"
          title="暂停当前任务，切换到其他任务"
        >
          暂停一下
        </button>
        {currentSubtaskId && (
          <button
            onClick={onSubtaskDone}
            className="px-2 py-1 rounded-lg text-[11px] text-gray-400 whitespace-nowrap
                       hover:bg-indigo-50 hover:text-indigo-500
                       active:scale-95 transition-all"
          >
            下个子任务
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onEnterFlow}
          className="px-2 py-1 rounded-lg text-[11px] text-gray-400 whitespace-nowrap
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
          className="px-2 py-1 rounded-lg text-[11px] text-gray-400 whitespace-nowrap
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
  const [elapsed, setElapsed] = useState(0)

  // 每秒更新计时
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [sessionStartTime])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <div className="drag-region w-full h-full flex flex-col justify-center bg-white/95 backdrop-blur-sm
                    border border-gray-200/60 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)]
                    px-4 py-2 select-none overflow-hidden">
      {/* 第一行：专注中 + 计时器 */}
      <div className="flex items-center">
        <div className="w-[48px] flex-shrink-0" />
        <p className="flex-1 text-[14px] text-emerald-600 font-semibold text-center leading-snug">
          🟢 专注中...
        </p>
        <span className="w-[48px] text-[11px] text-gray-400 font-mono text-right flex-shrink-0
                         bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
      </div>
      {/* 第二行：做完了 + 退出 */}
      <div className="flex items-center mt-2">
        <div className="w-[60px] flex-shrink-0" />
        <div className="flex-1 flex justify-center">
          <button
            onClick={onTaskDone}
            className="no-drag px-6 py-1.5 rounded-xl
                       text-xs font-semibold transition-all
                       bg-emerald-500 text-white shadow-sm shadow-emerald-200/50 hover:bg-emerald-600 active:scale-95"
          >
            做完了
          </button>
        </div>
        <div className="w-[60px] flex items-center justify-end flex-shrink-0">
          <button
            onClick={onExit}
            className="no-drag text-[11px] text-gray-400
                       hover:text-red-500 active:scale-95 transition-all whitespace-nowrap"
            title="退出专注"
          >
            退出
          </button>
        </div>
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
