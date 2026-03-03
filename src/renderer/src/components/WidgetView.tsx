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
import type { AIConfig } from '../services/ai'
import { generateMicroActions, generateStuckChips, generatePivotResponse } from '../services/ai'
import type { PivotResult } from '../services/ai'
import { tracker } from '../services/tracker'
import { triggerEffect } from '../effects'

// ===================== 常量 =====================

const BAR_W = 380
const BAR_H_THIN = 58
const BAR_H_RELAY = 240
const BAR_H_STUCK = 340

// ===================== 类型 =====================

export interface FocusSession {
  sessionId: string           // 本次专注会话唯一 ID（用于关联所有事件）
  taskId: string
  taskTitle: string
  currentMicroTask: string
  startTime: number          // 当前微任务开始时间戳（ms）
  isFlowMode: boolean        // 用户已进入心流
  phase: 'executing' | 'relay' | 'stuck_a' | 'stuck_b'
  microHistory: string[]     // 已完成微任务列表
  // ---- 子任务导航 ----
  currentSubtaskId?: string       // 当前正在做的子任务 ID
  currentSubtaskTitle?: string    // 当前正在做的子任务标题
  isSubtaskTransition?: boolean   // true = 刚切到新子任务，relay 显示子任务入口提示
  allSubtasksDone?: boolean       // true = 所有子任务完成，提供宏观任务完成选项
}

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
}

// ===================== 主组件 =====================

export default function WidgetView({
  tasks, session, aiConfig, focusTaskId,
  onToggle, onExit,
  onMicroComplete, onNextMicro, onEnterFlow, onTaskDone,
  onStuck, onStuckToB, onResume, onSubtaskDone, onPause,
}: WidgetViewProps) {

  // 如果没有 session → 走旧的普通小组件模式
  if (!session) {
    return <LegacyWidget tasks={tasks} focusTaskId={focusTaskId} onToggle={onToggle} onExit={onExit} />
  }

  // 有 session → 进入专注执行模式
  return (
    <FocusDynamicBar
      session={session}
      aiConfig={aiConfig}
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
    />
  )
}

// ===================== FocusDynamicBar =====================

interface FocusDynamicBarProps {
  session: FocusSession
  aiConfig: AIConfig
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
}

function FocusDynamicBar({
  session, aiConfig,
  onMicroComplete, onNextMicro, onEnterFlow, onTaskDone,
  onStuck, onStuckToB, onResume, onSubtaskDone, onExit, onPause,
}: FocusDynamicBarProps) {
  const {
    phase, isFlowMode, currentMicroTask, taskTitle, startTime,
    currentSubtaskId, currentSubtaskTitle, isSubtaskTransition, allSubtasksDone,
  } = session

  // ---- 计时器（精确到秒）----
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startTime) / 1000))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startTime])

  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  // ---- 接力输入 ----
  const [nextMicro, setNextMicro] = useState('')
  const [chips, setChips] = useState<string[]>([])
  const [loadingChips, setLoadingChips] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ---- 急救面板状态 ----
  const [stuckChips, setStuckChips] = useState<string[]>([])
  const [loadingStuck, setLoadingStuck] = useState(false)
  const [stuckInput, setStuckInput] = useState('')
  const stuckInputRef = useRef<HTMLInputElement>(null)

  const [pivotData, setPivotData] = useState<PivotResult | null>(null)
  const [loadingPivot, setLoadingPivot] = useState(false)
  const [pivotInput, setPivotInput] = useState('')
  const pivotInputRef = useRef<HTMLInputElement>(null)

  // ---- 窗口尺寸管理 ----
  useEffect(() => {
    if (phase === 'relay') {
      // 全部完成时矮一些，其余统一高度
      const h = allSubtasksDone ? 180 : BAR_H_RELAY
      window.electronAPI.resizeWidget(BAR_W, h)
      if (!allSubtasksDone) inputRef.current?.focus()
      // 请求 AI 接力建议
      if (aiConfig.apiKey && aiConfig.modelId && !allSubtasksDone) {
        setLoadingChips(true)
        // 子任务过渡时不传 lastStep（让AI基于新子任务生成建议）
        const lastStep = isSubtaskTransition ? undefined : currentMicroTask
        generateMicroActions(taskTitle, lastStep, aiConfig, currentSubtaskTitle)
          .then(({ chips: c }) => setChips(c))
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
      window.electronAPI.resizeWidget(BAR_W, BAR_H_THIN)
      setNextMicro('')
      setChips([])
      setStuckChips([])
      setStuckInput('')
      setPivotData(null)
      setPivotInput('')
    }
  }, [phase, currentSubtaskId, allSubtasksDone])

  // relay 继续
  const handleContinue = () => {
    const text = nextMicro.trim()
    if (text) onNextMicro(text)
  }

  // stuck_a → stuck_b：用户选择了卡点原因
  const handleSubmitStuckReason = (reason: string, reasonSource: 'ai_chip' | 'self') => {
    if (!reason.trim()) return

    // 📊 埋点：卡顿归因
    tracker.track('stuck.reason', {
      sessionId: session.sessionId,
      taskId: session.taskId,
      microAction: currentMicroTask,
      reason: reason.trim(),
      reasonSource,
    })

    // 切换到 stuck_b 阶段
    onStuckToB()

    // 同时发起 AI 请求获取同理心+绕路建议
    setLoadingPivot(true)
    setPivotData(null)
    setPivotInput('')

    generatePivotResponse(taskTitle, currentMicroTask, reason, aiConfig)
      .then(result => {
        setPivotData(result)
        // 📊 埋点：AI 生成了绕路建议
        if (result.empathy || result.pivots.length > 0) {
          tracker.track('stuck.pivot_offered', {
            sessionId: session.sessionId,
            taskId: session.taskId,
            empathy: result.empathy,
            pivotSuggestions: result.pivots,
          })
        }
        setLoadingPivot(false)
      })
      .catch(() => setLoadingPivot(false))
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
    }, 500) // 500ms 闪动后跳转
  }

  // ============ 执行状态 / 心流状态（薄条 58px，两行布局）============
  if (phase === 'executing') {
    const displayTask = isFlowMode ? taskTitle : currentMicroTask

    return (
      <div className="drag-region w-full h-full flex flex-col justify-center bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)]
                      px-3.5 py-1 select-none overflow-hidden">

        {/* 上行：状态指示器 + 完整任务名 + 退出 */}
        <div className="flex items-center gap-2">
          <div className="no-drag flex-shrink-0">
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
          <span className="no-drag flex-1 min-w-0 text-[13px] text-gray-700 font-medium truncate">
            {displayTask}
          </span>
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

        {/* 下行：计时 + 按钮 */}
        <div className="flex items-center gap-2 mt-0.5">
          {/* 计时器胶囊 */}
          <span className="no-drag text-[11px] text-gray-400 font-mono flex-shrink-0
                           bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>

          <div className="flex-1" />

          {/* 完成按钮 — 微任务完成时播放轻量动画，最终任务完成时才播庆祝特效 */}
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
            className={`no-drag flex items-center gap-1 px-3 py-1 rounded-lg
                       text-xs font-semibold transition-all flex-shrink-0
                       ${showMicroDone
                         ? 'bg-emerald-400 text-white scale-110 shadow-md shadow-emerald-300/60'
                         : 'bg-emerald-500 text-white shadow-sm shadow-emerald-200/50 hover:bg-emerald-600 active:scale-95'
                       }`}
          >
            {showMicroDone ? '✅' : '✓ 完成'}
          </button>

          {/* 卡住了按钮（非心流模式才显示） */}
          {!isFlowMode && (
            <button
              onClick={onStuck}
              className="no-drag flex items-center justify-center w-6 h-6 rounded-lg
                         text-gray-400 hover:text-orange-500 hover:bg-orange-50
                         active:scale-95 transition-all flex-shrink-0"
              title="卡住了？让AI帮你换条路"
            >
              <span className="text-xs">🆘</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  // ============ 急救状态A：卡点预测 ============
  if (phase === 'stuck_a') {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        {/* 顶部条 */}
        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="no-drag w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-500
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white text-[10px]">🆘</span>
          </div>
          <span className="no-drag text-xs text-orange-600 font-medium flex-1 truncate">
            卡住了：{currentMicroTask}
          </span>
          <span className="no-drag text-xs text-gray-500 font-mono flex-shrink-0
                           bg-gray-100/80 px-2 py-0.5 rounded-md">{timeStr}</span>
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

        {/* 急救内容 */}
        <div className="no-drag flex-1 px-4 py-3.5 flex flex-col gap-3 overflow-y-auto">

          {/* 快速逃逸：不是卡住，而是要处理别的事 */}
          <button
            onClick={onPause}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-blue-500
                       transition-colors self-start group/pause"
          >
            <span className="opacity-70 group-hover/pause:opacity-100 transition-opacity">⏸</span>
            不是卡住？只是要处理别的事
            <span className="opacity-0 group-hover/pause:opacity-100 text-blue-400 transition-opacity">→ 暂停</span>
          </button>

          <div className="border-t border-gray-100/80" />

          {/* LLM 提示语 */}
          <p className="text-xs text-gray-600 leading-relaxed">
            <span className="text-orange-500 font-bold">卡住太正常了</span>，这说明大脑在处理复杂信息。深呼吸。
            <br />现在主要是遇到<span className="text-orange-600 font-bold">什么具体问题</span>了？
          </p>

          {/* 动态预测筹码 */}
          <div className="flex flex-col gap-2 min-h-[36px]">
            {loadingStuck && (
              <span className="text-[10px] text-gray-400 flex items-center gap-1.5">
                <span className="w-3 h-3 border-[1.5px] border-gray-300 border-t-orange-400 rounded-full animate-spin" />
                AI 正在分析卡点…
              </span>
            )}
            {!loadingStuck && stuckChips.map((chip, i) => (
              <button
                key={i}
                onClick={() => handleSubmitStuckReason(chip, 'ai_chip')}
                className="text-left text-xs px-3.5 py-2.5 rounded-xl
                           bg-orange-50 text-orange-700 border border-orange-200
                           hover:bg-orange-100 hover:border-orange-300
                           active:scale-[0.98] transition-all"
              >
                🔘 {chip}
              </button>
            ))}
          </div>

          {/* 开放倾诉输入框 */}
          <div className="flex gap-2">
            <input
              ref={stuckInputRef}
              type="text"
              value={stuckInput}
              onChange={(e) => setStuckInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && stuckInput.trim()) handleSubmitStuckReason(stuckInput.trim(), 'self')
                if (e.key === 'Escape') onExit()
              }}
              placeholder="都不是，其实是因为……"
              maxLength={100}
              className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-gray-200
                         focus:border-orange-400 focus:ring-1 focus:ring-orange-100
                         outline-none bg-gray-50 focus:bg-white transition-all"
            />
            <button
              onClick={() => {
                if (stuckInput.trim()) handleSubmitStuckReason(stuckInput.trim(), 'self')
              }}
              disabled={!stuckInput.trim()}
              className="px-3.5 py-2.5 rounded-xl bg-orange-500 text-white text-xs font-semibold
                         shadow-sm shadow-orange-200/50
                         hover:bg-orange-600 hover:shadow-md hover:shadow-orange-200/60
                         active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                         transition-all flex-shrink-0"
            >
              说说
            </button>
          </div>

          {/* 底部：返回继续执行 */}
          <div className="flex items-center justify-end pt-2 border-t border-gray-100/80">
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

  // ============ 急救状态B：同理心接住 + 绕路 ============
  if (phase === 'stuck_b') {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        {/* 顶部条 */}
        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="no-drag w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-500
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white text-[10px]">💙</span>
          </div>
          <span className="no-drag text-xs text-blue-600 font-medium flex-1 truncate">
            别急，换条路走
          </span>
          <span className="no-drag text-xs text-gray-500 font-mono flex-shrink-0
                           bg-gray-100/80 px-2 py-0.5 rounded-md">{timeStr}</span>
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

        {/* 急救内容 */}
        <div className="no-drag flex-1 px-4 py-3.5 flex flex-col gap-3 overflow-y-auto">

          {/* 加载中 */}
          {loadingPivot && (
            <div className="flex items-center gap-2 py-4 justify-center">
              <span className="w-3 h-3 border-2 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
              <span className="text-xs text-gray-400">AI 正在帮你想办法…</span>
            </div>
          )}

          {/* 同理心安抚 */}
          {!loadingPivot && pivotData && (
            <>
              {pivotData.empathy && (
                <div className="bg-blue-50/80 border border-blue-100 rounded-xl px-3.5 py-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    💙 {pivotData.empathy}
                  </p>
                </div>
              )}

              {/* 错误提示 */}
              {pivotData.error && (
                <span className="text-xs text-red-400">⚠️ {pivotData.error}</span>
              )}

              {/* 绕路筹码 */}
              {pivotData.pivots.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] text-gray-400 font-medium">试试这样绕一下：</p>
                  {pivotData.pivots.map((pivot, i) => (
                    <button
                      key={i}
                      onClick={() => handlePivotResume(pivot, 'ai_chip')}
                      className="text-left text-xs px-3.5 py-2.5 rounded-xl
                                 bg-blue-50 text-blue-700 border border-blue-200
                                 hover:bg-blue-100 hover:border-blue-300
                                 active:scale-[0.98] transition-all"
                    >
                      🔘 {pivot}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* 自定义转轴输入 */}
          <div className="flex gap-2">
            <input
              ref={pivotInputRef}
              type="text"
              value={pivotInput}
              onChange={(e) => setPivotInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pivotInput.trim()) handlePivotResume(pivotInput, 'self')
                if (e.key === 'Escape') onExit()
              }}
              placeholder="或者你想直接做点别的？"
              maxLength={50}
              className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-gray-200
                         focus:border-blue-400 focus:ring-1 focus:ring-blue-100
                         outline-none bg-gray-50 focus:bg-white transition-all"
            />
            <button
              onClick={() => {
                if (pivotInput.trim()) handlePivotResume(pivotInput, 'self')
              }}
              disabled={!pivotInput.trim()}
              className="px-3.5 py-2.5 rounded-xl bg-blue-500 text-white text-xs font-semibold
                         shadow-sm shadow-blue-200/50
                         hover:bg-blue-600 hover:shadow-md hover:shadow-blue-200/60
                         active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                         transition-all flex-shrink-0"
            >
              走起
            </button>
          </div>

          {/* 返回继续 */}
          <div className="flex items-center justify-end pt-2 border-t border-gray-100/80">
            <button
              onClick={() => onResume(currentMicroTask)}
              className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
            >
              没事，我继续原来的 →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ============ 接力状态（展开面板）============

  // ---- 所有子任务完成特殊界面 ----
  if (allSubtasksDone) {
    return (
      <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                      border border-gray-200/60 rounded-2xl
                      shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

        <div className="flex items-center px-4 py-2.5 gap-2.5 border-b border-gray-100/80">
          <div className="no-drag w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600
                          flex items-center justify-center flex-shrink-0 shadow-sm">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="no-drag text-xs text-emerald-600 font-medium flex-1 truncate">
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
    <div className="drag-region w-full h-full flex flex-col bg-white/95 backdrop-blur-sm
                    border border-gray-200/60 rounded-2xl
                    shadow-[0_4px_24px_rgba(0,0,0,0.08)] select-none overflow-hidden">

      {/* 顶部：进度条 + 已完成提示 */}
      <div className="border-b border-gray-100/80">
        {/* 步数进度条 */}
        <div className="no-drag flex items-center gap-2 px-4 pt-2.5 pb-1">
          <div className="flex items-center gap-1">
            {session.microHistory.map((_, i) => (
              <div key={i} className="w-4 h-1.5 rounded-full bg-emerald-400" />
            ))}
            {/* 当前待填的一步（空心） */}
            <div className="w-4 h-1.5 rounded-full border border-gray-300 bg-white" />
          </div>
          <span className="text-[10px] text-emerald-500 font-medium whitespace-nowrap">
            第 {session.microHistory.length} 步 ✓
          </span>
          <div className="flex-1" />
          <span className="text-[10px] text-gray-400 font-mono flex-shrink-0
                           bg-gray-100/80 px-1.5 py-0.5 rounded-md">{timeStr}</span>
          <button
            onClick={onExit}
            className="no-drag w-5 h-5 rounded-md flex items-center justify-center
                       text-gray-300 hover:text-gray-500 hover:bg-gray-100
                       transition-all flex-shrink-0"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* 已完成提示文字 */}
        <div className="no-drag flex items-center gap-2 px-4 pb-2">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600
                          flex items-center justify-center flex-shrink-0">
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-xs text-emerald-600 font-medium flex-1 min-w-0 truncate">
            {isSubtaskTransition
              ? `进入下一个子任务`
              : `漂亮！「${currentMicroTask}」已完成`}
          </span>
        </div>
      </div>

      {/* 接力输入区域 */}
      <div className="no-drag px-4 py-3 flex flex-col gap-2.5">
        {/* 提示语：根据是否有子任务+是否刚切换子任务变化 */}
        <p className="text-xs text-gray-500 font-medium leading-relaxed">
          {isSubtaskTransition && currentSubtaskTitle ? (
            <>下一步是「<span className="text-emerald-600 font-bold">{currentSubtaskTitle}</span>」，从哪个<span className="text-emerald-600 font-bold">具体动作</span>开始？</>
          ) : currentSubtaskTitle ? (
            <>还在做「<span className="text-indigo-500 font-bold">{currentSubtaskTitle}</span>」，紧接着的<span className="text-emerald-600 font-bold">一个动作</span>是？</>
          ) : (
            <>趁热打铁，紧接着的<span className="text-emerald-600 font-bold">一个动作</span>是？</>
          )}
        </p>

        {/* 输入框 + 继续按钮 */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={nextMicro}
            onChange={(e) => setNextMicro(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleContinue() }}
            placeholder="下一个微动作…"
            maxLength={50}
            className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-gray-200
                       focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100
                       outline-none bg-gray-50 focus:bg-white transition-all"
          />
          <button
            onClick={handleContinue}
            disabled={!nextMicro.trim()}
            className="px-3.5 py-2.5 rounded-xl bg-emerald-500 text-white text-xs font-semibold
                       shadow-sm shadow-emerald-200/50
                       hover:bg-emerald-600 hover:shadow-md hover:shadow-emerald-200/60
                       active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                       transition-all flex-shrink-0"
          >
            继续
          </button>
        </div>

        {/* AI 筹码 */}
        <div className="flex flex-wrap gap-2 min-h-[24px]">
          {loadingChips && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1.5">
              <span className="w-3 h-3 border-[1.5px] border-gray-300 border-t-emerald-400 rounded-full animate-spin" />
              AI 思考中…
            </span>
          )}
          {!loadingChips && chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => { setNextMicro(chip); inputRef.current?.focus() }}
              className="text-[11px] px-3 py-1.5 rounded-xl
                         bg-emerald-50 text-emerald-700 border border-emerald-200
                         hover:bg-emerald-100 hover:border-emerald-300
                         active:scale-[0.98] transition-all"
            >
              💡 {chip}
            </button>
          ))}
        </div>

        {/* 底部操作栏 */}
        <div className="pt-2 border-t border-gray-100/80 flex flex-col gap-1.5">
          {/* 第一行：进度信息（可以放长文字） */}
          <div className="text-[11px] text-gray-400 leading-snug truncate">
            {currentSubtaskId ? (
              <>已完成 {session.microHistory.length} 步 · 正在做「<span className="text-indigo-500">{currentSubtaskTitle}</span>」</>
            ) : (
              <>已完成 {session.microHistory.length} 步</>
            )}
          </div>
          {/* 第二行：操作按钮（短标签，不会截断） */}
          <div className="flex items-center gap-1">
            <button
              onClick={onPause}
              className="px-2 py-1 rounded-lg text-[11px] text-gray-400 whitespace-nowrap
                         hover:bg-gray-100 hover:text-gray-600
                         active:scale-95 transition-all"
              title="暂停当前任务，切换到其他任务"
            >
              ⏸ 切换任务
            </button>
            {currentSubtaskId && (
              <button
                onClick={onSubtaskDone}
                className="px-2 py-1 rounded-lg text-[11px] text-indigo-500 whitespace-nowrap
                           hover:bg-indigo-50 hover:text-indigo-600
                           active:scale-95 transition-all"
              >
                → 下个子任务
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={onEnterFlow}
              className="px-2 py-1 rounded-lg text-[11px] text-violet-500 whitespace-nowrap
                         hover:bg-violet-50 hover:text-violet-600
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
                         hover:bg-emerald-50 hover:text-emerald-600
                         active:scale-95 transition-all"
            >
              ✓ 全部完成
            </button>
          </div>
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
