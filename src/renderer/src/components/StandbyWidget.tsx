/**
 * StandbyWidget —— 常驻待命入口
 *
 * 两种状态：
 *   1. 待命条（80px）—— 任务名下拉选择 + 开始/继续 + 展开主界面
 *   2. 第一步面板（280px）—— 点击"开始"后内嵌展开，确认第一步后直接进入执行
 *
 * 色彩规范：
 *   绿色（emerald）= 开始 / 启动
 *   琥珀色（amber）= 暂停 / 继续
 *   紫色（indigo）= 品牌 / 选中态
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { Task } from '../types'
import type { AIConfig, MicroActionChip } from '../services/ai'
import { aiCache } from '../services/ai-cache'
import AILoadingTips from './AILoadingTips'

const BAR_W = 380
const BAR_H = 80
const PANEL_H = 330
const DROPDOWN_MAX_H = 200
const TASK_ROW_H = 40

const FALLBACK_CHIPS: MicroActionChip[] = [
  { action: '打开相关文件', note: '先准备好工具就行' },
  { action: '先写一句话开头', note: '想到什么写什么' },
]

interface StandbyWidgetProps {
  tasks: Task[]
  aiConfig: AIConfig
  onStartMicro: (taskId: string, microTask: string, source: 'self' | 'ai_chip' | 'skip') => void
  onResumePaused: (taskId: string) => void
  onExpand: () => void
}

function pickDefaultTask(tasks: Task[]): Task | null {
  const paused = tasks.find(t => !t.completed && t.pausedSession)
  if (paused) return paused
  return tasks.find(t => !t.completed) ?? null
}

export default function StandbyWidget({
  tasks, aiConfig, onStartMicro, onResumePaused, onExpand,
}: StandbyWidgetProps) {
  // ---- 待命条状态 ----
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // ---- "开始第一步"面板状态 ----
  const [firstStepTaskId, setFirstStepTaskId] = useState<string | null>(null)
  const [microTask, setMicroTask] = useState('')
  const [chips, setChips] = useState<MicroActionChip[]>([])
  const [loadingChips, setLoadingChips] = useState(false)
  const [chipError, setChipError] = useState<string | null>(null)
  const microInputRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<'self' | 'ai_chip'>('self')

  // ---- 任务列表（暂停的排前面） ----
  const incompleteTasks = useMemo(() => {
    const paused: Task[] = []
    const rest: Task[] = []
    for (const t of tasks) {
      if (t.completed) continue
      if (t.pausedSession) paused.push(t)
      else rest.push(t)
    }
    return [...paused, ...rest]
  }, [tasks])

  const autoDefault = useMemo(() => pickDefaultTask(tasks), [tasks])
  const currentTask = (selectedId && incompleteTasks.find(t => t.id === selectedId)) || autoDefault
  const isPaused = !!currentTask?.pausedSession

  // 第一步面板的目标任务
  const firstStepTask = firstStepTaskId
    ? incompleteTasks.find(t => t.id === firstStepTaskId) ?? null
    : null
  const activeSubtask = firstStepTask
    ? (firstStepTask.subtasks ?? []).find(s => !s.completed) ?? null
    : null

  // ---- 窗口尺寸 ----
  const dropdownH = Math.min(incompleteTasks.length * TASK_ROW_H, DROPDOWN_MAX_H)
  const totalH = firstStepTask
    ? PANEL_H
    : (dropdownOpen && incompleteTasks.length > 0 ? BAR_H + dropdownH : BAR_H)

  useEffect(() => {
    window.electronAPI.resizeWidget(BAR_W, totalH)
  }, [totalH])

  // ---- 打开第一步面板 ----
  const openFirstStep = useCallback((task: Task) => {
    setFirstStepTaskId(task.id)
    setDropdownOpen(false)
    setMicroTask('')
    setChips([])
    setChipError(null)
    sourceRef.current = 'self'

    const hasAI = !!(aiConfig.apiKey && aiConfig.modelId)
    if (hasAI) {
      setLoadingChips(true)
      const subtaskTitle = (task.subtasks ?? []).find(s => !s.completed)?.title
      aiCache.get(task.id, task.title, aiConfig, subtaskTitle)
        .then(({ chips: newChips, error }) => {
          setChips(newChips.length > 0 ? newChips : FALLBACK_CHIPS)
          if (error) setChipError(error)
        })
        .catch(() => setChips(FALLBACK_CHIPS))
        .finally(() => setLoadingChips(false))
    } else {
      setLoadingChips(false)
    }

    setTimeout(() => microInputRef.current?.focus(), 350)
  }, [aiConfig])

  const closeFirstStep = useCallback(() => {
    setFirstStepTaskId(null)
    setMicroTask('')
    setChips([])
    setChipError(null)
  }, [])

  // ---- Esc 关闭面板 ----
  useEffect(() => {
    if (!firstStepTaskId) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFirstStep()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [firstStepTaskId, closeFirstStep])

  // 目标任务消失时自动关闭面板
  useEffect(() => {
    if (firstStepTaskId && !firstStepTask) closeFirstStep()
  }, [firstStepTaskId, firstStepTask, closeFirstStep])

  // ---- 面板操作 ----
  const handleConfirm = () => {
    if (!firstStepTaskId || !microTask.trim()) return
    onStartMicro(firstStepTaskId, microTask.trim(), sourceRef.current)
  }

  const handleChipStart = (chip: MicroActionChip) => {
    if (!firstStepTaskId) return
    onStartMicro(firstStepTaskId, chip.action, 'ai_chip')
  }

  const handleSkipFirstStep = () => {
    if (!firstStepTask) return
    const defaultAction = activeSubtask
      ? `开始做「${activeSubtask.title}」`
      : '开始做'
    onStartMicro(firstStepTask.id, defaultAction, 'skip')
  }

  // ---- 点击外部关闭下拉 ----
  useEffect(() => {
    if (!dropdownOpen) return
    const handle = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [dropdownOpen])

  // ---- 待命条按钮 ----
  const handleStart = (task: Task) => {
    setDropdownOpen(false)
    if (task.pausedSession) {
      onResumePaused(task.id)
    } else {
      openFirstStep(task)
    }
  }

  const handleSelect = (task: Task) => {
    setSelectedId(task.id)
    setDropdownOpen(false)
  }

  // ===================== 渲染 =====================

  // ---- "开始第一步"内嵌面板 ----
  if (firstStepTask) {
    return (
      <div className="w-full h-full flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden select-none">
        {/* 头部：任务名 + 关闭 */}
        <div className="drag-region flex items-center gap-2 px-4 pt-3.5 pb-2">
          <div className="no-drag flex-1 min-w-0">
            <p className="text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">
              🎯 即将开始
            </p>
            <p className="text-sm font-bold text-gray-800 truncate mt-0.5">
              {firstStepTask.title}
            </p>
          </div>
          <button
            onClick={closeFirstStep}
            className="no-drag w-6 h-6 flex items-center justify-center text-gray-300 hover:text-gray-500 rounded transition-colors"
            title="取消 (Esc)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mx-4 border-t border-gray-100" />

        {/* 输入区 */}
        <div className="px-4 pt-3 pb-2">
          <p className="text-xs text-gray-500 mb-2 leading-relaxed">
            {activeSubtask
              ? <>下一步是「<span className="text-emerald-600 font-medium">{activeSubtask.title}</span>」，从哪个动作开始？</>
              : <>你现在的<span className="text-emerald-600 font-medium">第一个具体动作</span>是？</>
            }
          </p>
          <div className="flex gap-1.5">
            <input
              ref={microInputRef}
              type="text"
              value={microTask}
              onChange={(e) => { setMicroTask(e.target.value); sourceRef.current = 'self' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
              placeholder="例如：打开空白文档…"
              maxLength={50}
              className="no-drag flex-1 px-3 py-2 text-xs rounded-lg border border-gray-200
                         focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100
                         outline-none transition-all bg-gray-50 focus:bg-white
                         placeholder-gray-300"
            />
            <button
              onClick={handleConfirm}
              disabled={!microTask.trim()}
              className="no-drag px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-semibold
                         hover:bg-emerald-600 active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed
                         shadow-sm shadow-emerald-200/50 transition-all"
            >
              确认
            </button>
          </div>
        </div>

        {/* AI 建议芯片 */}
        <div className="px-4 pb-1 flex flex-col gap-1.5 min-h-[32px]">
          {loadingChips && (
            <AILoadingTips variant="start" title="AI 正在想第一步…" compact />
          )}
          {!loadingChips && chips.map((chip, i) => (
            <button
              key={i}
              onClick={() => handleChipStart(chip)}
              className="no-drag w-full text-left px-3 py-2 rounded-lg
                         bg-emerald-50 border border-emerald-200
                         hover:bg-emerald-100 hover:border-emerald-300
                         active:scale-[0.98] transition-all cursor-pointer"
            >
              <span className="text-xs text-emerald-700 font-medium">▶ {chip.action}</span>
              {chip.note && (
                <span className="block text-[10px] text-emerald-500/70 mt-0.5 leading-snug">
                  {chip.note}
                </span>
              )}
            </button>
          ))}
          {!loadingChips && chipError && (
            <span className="text-[10px] text-red-400">⚠️ AI 暂不可用</span>
          )}
        </div>

        {/* 底部操作 */}
        <div className="mt-auto px-4 pb-3 flex justify-between items-center">
          <button
            onClick={handleSkipFirstStep}
            className="no-drag text-[11px] text-emerald-500 hover:text-emerald-700 transition-colors"
          >
            跳过，直接开始 →
          </button>
          <button
            onClick={closeFirstStep}
            className="no-drag text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            取消 (Esc)
          </button>
        </div>
      </div>
    )
  }

  // ---- 正常待命条 ----
  return (
    <div className="w-full h-full flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden select-none">

      {/* ---- 主条 ---- */}
      <div className="drag-region flex items-center gap-2 px-4" style={{ height: BAR_H }}>

        {/* 区域1：任务名下拉选择器 */}
        <button
          ref={triggerRef}
          onClick={() => incompleteTasks.length > 0 && setDropdownOpen(v => !v)}
          className={`no-drag flex-1 min-w-0 flex items-center gap-1.5 text-left rounded-lg px-2 py-1.5 transition-colors ${
            incompleteTasks.length > 0 ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'
          } ${dropdownOpen ? 'bg-gray-50' : ''}`}
        >
          <div className="flex-1 min-w-0">
            {currentTask ? (
              <>
                <div className="text-[13px] font-semibold text-gray-800 truncate">
                  {currentTask.title}
                </div>
                {isPaused && (
                  <div className="text-[11px] text-gray-400 truncate mt-0.5">
                    上次停在：{currentTask.pausedSession?.currentMicroTask}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[13px] text-gray-400">还没有任务</div>
            )}
          </div>
          {/* 下拉箭头（有多个任务时才显示） */}
          {incompleteTasks.length > 1 && (
            <svg className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {/* 区域2：开始 / 继续 */}
        {currentTask && (
          <button
            onClick={() => handleStart(currentTask)}
            className={`no-drag flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold transition-all active:scale-95 shadow-sm ${
              isPaused
                ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200/50'
                : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-200/50'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            {isPaused ? '继续' : '开始'}
          </button>
        )}

        {/* 区域3：展开主界面（始终显示） */}
        <button
          onClick={onExpand}
          className="no-drag w-7 h-7 flex items-center justify-center text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
          title="展开主界面"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      {/* ---- 任务下拉列表 ---- */}
      {dropdownOpen && incompleteTasks.length > 0 && (
        <div
          ref={dropdownRef}
          className="border-t border-gray-100 overflow-y-auto overscroll-contain"
          style={{ maxHeight: DROPDOWN_MAX_H }}
        >
          {incompleteTasks.map(task => {
            const taskIsPaused = !!task.pausedSession
            const isCurrent = task.id === currentTask?.id
            return (
              <button
                key={task.id}
                onClick={() => handleSelect(task)}
                className={`w-full flex items-center gap-2 px-4 text-left transition-colors ${
                  isCurrent ? 'bg-emerald-50/60' : 'hover:bg-gray-50'
                }`}
                style={{ height: TASK_ROW_H }}
              >
                {isCurrent && (
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                )}
                <span className={`flex-1 text-xs truncate ${
                  isCurrent ? 'text-emerald-700 font-medium' : 'text-gray-700'
                }`}>
                  {task.title}
                </span>
                {taskIsPaused && (
                  <span className="text-[10px] text-amber-500 flex-shrink-0">暂停中</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
