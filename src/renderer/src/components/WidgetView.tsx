/**
 * WidgetView —— 阶段2：Dynamic Bar（执行与单步接力）
 *
 * 三种状态：
 *   executing  – 正在执行微任务：显示任务名 + 计时 + [✓完成] + [🆘卡住了]
 *   relay      – 微任务完成后展开：输入下一步 + AI筹码 + [继续] + [🚀直接做]
 *   flow       – 心流模式：只显示宏观任务名 + 计时 + [✓完成]
 *
 * 窗口尺寸：
 *   executing / flow → 380×44（薄条）
 *   relay            → 380×200（展开）
 */

import { useState, useEffect, useRef } from 'react'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { generateMicroActions } from '../services/ai'
import { triggerEffect } from '../effects'

// ===================== 常量 =====================

const BAR_W = 380
const BAR_H_THIN = 44
const BAR_H_EXPAND = 210

// ===================== 类型 =====================

export interface FocusSession {
  taskId: string
  taskTitle: string
  currentMicroTask: string
  startTime: number          // 当前微任务开始时间戳（ms）
  isFlowMode: boolean        // 用户已进入心流
  phase: 'executing' | 'relay'
  microHistory: string[]     // 已完成微任务列表
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
}

// ===================== 主组件 =====================

export default function WidgetView({
  tasks, session, aiConfig, focusTaskId,
  onToggle, onExit,
  onMicroComplete, onNextMicro, onEnterFlow, onTaskDone,
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
      onExit={onExit}
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
  onExit: () => void
}

function FocusDynamicBar({
  session, aiConfig,
  onMicroComplete, onNextMicro, onEnterFlow, onTaskDone, onExit,
}: FocusDynamicBarProps) {
  const { phase, isFlowMode, currentMicroTask, taskTitle, startTime } = session

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

  // 进入 relay 阶段时：展开窗口 + 请求 AI 建议
  useEffect(() => {
    if (phase === 'relay') {
      window.electronAPI.resizeWidget(BAR_W, BAR_H_EXPAND)
      inputRef.current?.focus()
      // 请求 AI 建议
      if (aiConfig.apiKey && aiConfig.modelId) {
        setLoadingChips(true)
        generateMicroActions(taskTitle, currentMicroTask, aiConfig)
          .then(({ chips: newChips }) => setChips(newChips))
          .finally(() => setLoadingChips(false))
      }
    } else {
      window.electronAPI.resizeWidget(BAR_W, BAR_H_THIN)
      setNextMicro('')
      setChips([])
    }
  }, [phase])

  const handleContinue = () => {
    const text = nextMicro.trim()
    if (text) onNextMicro(text)
  }

  // ============ 执行状态 / 心流状态（薄条）============
  if (phase === 'executing') {
    const displayTask = isFlowMode ? taskTitle : currentMicroTask

    return (
      <div className="drag-region w-full h-full flex items-center bg-white border border-gray-200
                      rounded-xl shadow-lg px-3 gap-2 select-none overflow-hidden">

        {/* 左侧：状态指示器 */}
        <div className="no-drag flex-shrink-0">
          {isFlowMode ? (
            <div className="w-6 h-6 rounded-lg bg-violet-500 flex items-center justify-center">
              <span className="text-white text-xs">🚀</span>
            </div>
          ) : (
            <div className="w-6 h-6 rounded-lg bg-emerald-500 flex items-center justify-center">
              <span className="text-white text-xs">🎯</span>
            </div>
          )}
        </div>

        {/* 中间：任务文字 */}
        <div className="no-drag flex-1 min-w-0">
          <span className="text-xs text-gray-700 font-medium truncate block">{displayTask}</span>
        </div>

        {/* 计时器 */}
        <span className="no-drag text-xs text-gray-400 font-mono flex-shrink-0">{timeStr}</span>

        {/* 分割线 */}
        <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

        {/* 完成按钮 */}
        <button
          onClick={(e) => {
            triggerEffect(e.currentTarget)
            if (isFlowMode) onTaskDone()
            else onMicroComplete()
          }}
          className="no-drag flex items-center gap-1 px-2.5 py-1 rounded-lg
                     bg-emerald-50 text-emerald-600 text-xs font-semibold
                     hover:bg-emerald-100 active:scale-95 transition-all flex-shrink-0"
        >
          ✓ 完成
        </button>

        {/* 卡住了按钮（非心流模式才显示） */}
        {!isFlowMode && (
          <button
            onClick={onMicroComplete}
            className="no-drag flex items-center gap-0.5 px-2 py-1 rounded-lg
                       bg-orange-50 text-orange-500 text-xs font-medium
                       hover:bg-orange-100 active:scale-95 transition-all flex-shrink-0"
            title="卡住了？重新定义下一步"
          >
            🆘
          </button>
        )}

        {/* 退出按钮 */}
        <button
          onClick={onExit}
          className="no-drag w-5 h-5 rounded flex items-center justify-center
                     text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
          title="退出专注"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  // ============ 接力状态（展开面板）============
  return (
    <div className="w-full h-full flex flex-col bg-white border border-gray-200
                    rounded-xl shadow-lg select-none overflow-hidden">

      {/* 顶部薄条：已完成提示 */}
      <div className="drag-region flex items-center px-3 py-2 gap-2 border-b border-gray-100">
        <div className="no-drag w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <span className="no-drag text-xs text-emerald-600 font-medium flex-1 truncate">
          漂亮！「{currentMicroTask}」已完成
        </span>
        <span className="no-drag text-xs text-gray-400 font-mono flex-shrink-0">{timeStr}</span>
        <button
          onClick={onExit}
          className="no-drag w-5 h-5 rounded flex items-center justify-center
                     text-gray-300 hover:text-gray-500 transition-colors flex-shrink-0"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 接力输入区域 */}
      <div className="no-drag flex-1 px-3 py-3 flex flex-col gap-2.5">
        <p className="text-xs text-gray-500 font-medium leading-relaxed">
          趁热打铁，紧接着的<span className="text-emerald-600 font-bold">一个动作</span>是？
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
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-gray-200
                       focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100
                       outline-none bg-gray-50 focus:bg-white transition-all"
          />
          <button
            onClick={handleContinue}
            disabled={!nextMicro.trim()}
            className="px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-semibold
                       hover:bg-emerald-600 active:scale-95
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all flex-shrink-0"
          >
            继续
          </button>
        </div>

        {/* AI 筹码 */}
        <div className="flex flex-wrap gap-1.5 min-h-[24px]">
          {loadingChips && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <span className="w-2.5 h-2.5 border-[1.5px] border-gray-300 border-t-emerald-400 rounded-full animate-spin" />
              AI 思考中…
            </span>
          )}
          {!loadingChips && chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => { setNextMicro(chip); inputRef.current?.focus() }}
              className="text-[10px] px-2.5 py-1 rounded-full
                         bg-emerald-50 text-emerald-700 border border-emerald-200
                         hover:bg-emerald-100 active:scale-95 transition-all"
            >
              💡 {chip}
            </button>
          ))}
        </div>

        {/* 路径 B：进入心流 */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <span className="text-[10px] text-gray-400">
            已完成 {session.microHistory.length} 步
          </span>
          <button
            onClick={onEnterFlow}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full
                       bg-violet-50 text-violet-600 text-[11px] font-semibold border border-violet-200
                       hover:bg-violet-100 active:scale-95 transition-all"
          >
            🚀 我有感觉了，直接做
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
