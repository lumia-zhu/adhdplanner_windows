/**
 * FocusFlow —— 阶段1：元认知拦截覆盖层
 *
 * 两个内部阶段：
 *   1. understanding —— 任务理解：AI 生成情境化反思问题，帮用户澄清思路（1-2轮）
 *   2. micro_action  —— 微脚手架：用户确认第一个具体动作（原有逻辑）
 *
 * 用户点击某个任务时触发：
 *   1. 背景柔和模糊淡入，营造聚焦感
 *   2. 卡片从下方平滑滑入
 *   3. 如果有 AI → 先进入 understanding 阶段
 *   4. 完成理解（或跳过）后 → 进入 micro_action 阶段
 *   5. 用户确认后进入执行阶段
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Task } from '../types'
import type { AIConfig, MicroActionChip } from '../services/ai'
import { generateReflectionQuestion, generateFollowUpQuestion, getRandomFallbackQuestion, buildStartupHint } from '../services/ai'
import { tracker } from '../services/tracker'
import { aiCache } from '../services/ai-cache'
import { findStartupMemoryMatches, mergeStartupSuggestions } from '../services/startup-memory'
import { loadMemory } from '../services/memory-manager'
import AILoadingTips from './AILoadingTips'

// ★ Feature Flag：关闭任务理解阶段，直接进入第一步选择
// 设为 true 可恢复完整的 understanding → micro_action 流程
export const ENABLE_TASK_UNDERSTANDING = false

// ★ 通用回退建议（AI 超时时兜底显示）
const FALLBACK_CHIPS: MicroActionChip[] = [
  { action: '打开相关文件', note: '先准备好工具就行' },
  { action: '先写一句话开头', note: '想到什么写什么' },
]

// ===================== 类型 =====================

/** 理解阶段的问答记录 */
export interface UnderstandingEntry {
  question: string
  answer: string
}

interface FocusFlowProps {
  task: Task
  aiConfig: AIConfig
  onStart: (microTask: string, source: 'self' | 'ai_chip' | 'memory_chip' | 'skip', understandingContext?: string) => void
  onCancel: () => void
}

// ===================== 主组件 =====================

export default function FocusFlow({ task, aiConfig, onStart, onCancel }: FocusFlowProps) {
  // ---- 阶段控制 ----
  const hasAI = !!(aiConfig.apiKey && aiConfig.modelId)
  const [phase, setPhase] = useState<'understanding' | 'micro_action'>(
    (ENABLE_TASK_UNDERSTANDING && hasAI) ? 'understanding' : 'micro_action'
  )

  // ---- understanding 阶段状态 ----
  const [reflectionQ, setReflectionQ] = useState('')           // 当前反思问题
  const [reflectionAnswer, setReflectionAnswer] = useState('')  // 用户输入的回答
  const [reflectionRound, setReflectionRound] = useState(1)     // 当前轮次 (1 or 2)
  const [reflectionHistory, setReflectionHistory] = useState<UnderstandingEntry[]>([])
  const [loadingQuestion, setLoadingQuestion] = useState(false)
  const [changingQuestion, setChangingQuestion] = useState(false)
  const reflectionInputRef = useRef<HTMLInputElement>(null)

  // ---- micro_action 阶段状态 ----
  const [microTask, setMicroTask] = useState('')
  const [chips, setChips] = useState<MicroActionChip[]>([])
  // 进入 micro_action 时会加载本地记忆和 AI 建议，先显示轻量 loading 避免闪烁
  const [loadingChips, setLoadingChips] = useState(phase === 'micro_action')
  const [chipError, setChipError] = useState<string | null>(null)
  const microInputRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<'self' | 'ai_chip'>('self')

  // ---- 子任务导航：找到第一个未完成的子任务 ----
  const subtasks = task.subtasks ?? []
  const activeSubtask = subtasks.find(s => !s.completed) ?? null

  // 入场动画状态
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  // ---- 构建 understanding 上下文字符串（传给 AI 生成更精准的第一步建议）----
  const buildUnderstandingContext = useCallback((history: UnderstandingEntry[]) => {
    if (history.length === 0) return undefined
    return history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n')
  }, [])

  // ===================== Understanding 阶段逻辑 =====================

  // 超时回退定时器
  const questionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 请求 AI 生成反思问题 */
  const fetchReflectionQuestion = useCallback(async (isChanging = false) => {
    if (isChanging) setChangingQuestion(true)
    else setLoadingQuestion(true)

    // ★ 2.5 秒超时回退
    questionTimeoutRef.current = setTimeout(() => {
      setReflectionQ(prev => prev || getRandomFallbackQuestion())
      setLoadingQuestion(false)
      setChangingQuestion(false)
      console.log('[FocusFlow] 反思问题 AI 超时，使用回退问题')
    }, 2500)

    try {
      const subtaskTitles = subtasks.length > 0
        ? subtasks.filter(s => !s.completed).map(s => s.title)
        : undefined

      const result = await generateReflectionQuestion(
        task.title,
        task.note || undefined,
        subtaskTitles,
        aiConfig,
      )

      // AI 返回了 → 取消超时回退
      if (questionTimeoutRef.current) clearTimeout(questionTimeoutRef.current)

      if (result.question) {
        setReflectionQ(result.question)
      } else {
        // AI 返回为空 → 用回退问题
        setReflectionQ(getRandomFallbackQuestion())
      }
    } catch {
      if (questionTimeoutRef.current) clearTimeout(questionTimeoutRef.current)
      setReflectionQ(getRandomFallbackQuestion())
    } finally {
      setLoadingQuestion(false)
      setChangingQuestion(false)
    }
  }, [task.id, task.title, task.note, subtasks, aiConfig])

  // understanding 阶段初始化：生成第一个反思问题
  useEffect(() => {
    if (!ENABLE_TASK_UNDERSTANDING) return          // ★ flag 关闭时不触发
    if (phase !== 'understanding' || !hasAI) return

    fetchReflectionQuestion()

    // 延迟聚焦输入框
    const focusTimer = setTimeout(() => reflectionInputRef.current?.focus(), 400)

    return () => {
      clearTimeout(focusTimer)
      if (questionTimeoutRef.current) clearTimeout(questionTimeoutRef.current)
    }
  }, [phase, hasAI])

  /** 换个问题 */
  const handleChangeQuestion = () => {
    setReflectionAnswer('')
    fetchReflectionQuestion(true)
  }

  /** 跳过 understanding → 直接进入 micro_action */
  const handleSkipUnderstanding = () => {
    setPhase('micro_action')
  }

  /** 提交回答 */
  const handleSubmitReflection = async () => {
    const answer = reflectionAnswer.trim()
    if (!answer) {
      // 空回答等于跳过
      handleSkipUnderstanding()
      return
    }

    // 记录这轮问答
    const entry: UnderstandingEntry = { question: reflectionQ, answer }
    const newHistory = [...reflectionHistory, entry]
    setReflectionHistory(newHistory)
    setReflectionAnswer('')

    if (reflectionRound >= 2) {
      // 已经是第 2 轮 → 直接进入 micro_action
      setPhase('micro_action')
      return
    }

    // 第 1 轮 → 尝试生成跟进问题
    setReflectionRound(2)
    setLoadingQuestion(true)

    // ★ 2.5 秒超时 → 直接进入 micro_action（不再追问）
    const followUpTimeout = setTimeout(() => {
      setLoadingQuestion(false)
      setPhase('micro_action')
      console.log('[FocusFlow] 跟进问题超时，直接进入 micro_action')
    }, 2500)

    try {
      const result = await generateFollowUpQuestion(
        task.title,
        reflectionQ,
        answer,
        aiConfig,
      )
      clearTimeout(followUpTimeout)

      if (result.question) {
        setReflectionQ(result.question)
        setLoadingQuestion(false)
        // 聚焦输入框
        setTimeout(() => reflectionInputRef.current?.focus(), 100)
      } else {
        // 没生成出跟进问题 → 直接进入 micro_action
        setLoadingQuestion(false)
        setPhase('micro_action')
      }
    } catch {
      clearTimeout(followUpTimeout)
      setLoadingQuestion(false)
      setPhase('micro_action')
    }
  }

  // ===================== Micro Action 阶段逻辑 =====================

  // micro_action 阶段初始化：获取 AI 建议 + 聚焦输入框
  useEffect(() => {
    if (phase !== 'micro_action') return

    const focusTimer = setTimeout(() => microInputRef.current?.focus(), 350)
    const hasAIForChips = !!(aiConfig.apiKey && aiConfig.modelId)
    setChips([])
    setLoadingChips(true)
    setChipError(null)
    let cancelled = false

    // 加载行为记忆 → 合并本地记忆建议和 AI 建议，UI 仍保持同一组按钮
    loadMemory()
      .then(store => {
        const memoryChips = findStartupMemoryMatches(task.title, activeSubtask?.title, store)
        const hint = buildStartupHint(store.firstSteps ?? [])
        if (!hasAIForChips) {
          return { chips: mergeStartupSuggestions(memoryChips, [], FALLBACK_CHIPS), error: undefined, fromCache: false }
        }
        return aiCache
          .get(task.id, task.title, aiConfig, activeSubtask?.title, undefined, hint || undefined)
          .then(result => ({
            chips: mergeStartupSuggestions(memoryChips, result.chips, FALLBACK_CHIPS),
            error: result.error,
            fromCache: result.fromCache,
          }))
      })
      .catch(() => {
        if (!hasAIForChips) return { chips: FALLBACK_CHIPS, error: undefined, fromCache: false }
        return aiCache.get(task.id, task.title, aiConfig, activeSubtask?.title)
          .then(result => ({
            chips: mergeStartupSuggestions([], result.chips, FALLBACK_CHIPS),
            error: result.error,
            fromCache: result.fromCache,
          }))
      })
      .then(result => {
        if (cancelled || !result) return
        setChips(result.chips)
        if (result.error) setChipError(result.error)
        if (result.fromCache) console.log('[FocusFlow] AI 建议来自缓存，秒出 ✓')
      })
      .catch(() => {
        if (!cancelled) setChips(FALLBACK_CHIPS)
      })
      .finally(() => { if (!cancelled) setLoadingChips(false) })

    return () => {
      cancelled = true
      clearTimeout(focusTimer)
    }
  }, [phase, task.id])

  const handleClose = () => {
    tracker.track('plan.scaffold_skipped', { taskId: task.id })
    setVisible(false)
    setTimeout(onCancel, 300)
  }

  // Esc 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  /** micro_action 阶段：确认开始 */
  const handleStart = () => {
    const text = microTask.trim()
    if (text) {
      const ctx = buildUnderstandingContext(reflectionHistory)
      onStart(text, sourceRef.current, ctx)
    }
  }

  /** AI chip 一键开始 */
  const handleChipStart = (chip: MicroActionChip) => {
    tracker.track('plan.chip_selected', { taskId: task.id, chipText: chip.action })
    const ctx = buildUnderstandingContext(reflectionHistory)
    onStart(chip.action, chip.source ?? 'ai_chip', ctx)
  }

  /** 跳过：不等 AI、不输入，直接用默认动作开始 */
  const handleSkip = () => {
    const defaultAction = activeSubtask
      ? `开始做「${activeSubtask.title}」`
      : '开始做'
    onStart(defaultAction, 'skip')
  }

  // ===================== 渲染 =====================

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 遮罩：柔和渐入 */}
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-[6px] transition-all duration-300 ease-out ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* 主内容卡片：从下方滑入 + 淡入 */}
      <div
        className={`relative z-10 w-[400px] bg-white rounded-2xl shadow-2xl overflow-hidden
                    transition-all duration-300 ease-out ${
          visible
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-8 scale-[0.97]'
        }`}
      >
        {/* 顶部：选中的任务（两个阶段共享） */}
        <div className="px-6 pt-6 pb-4">
          <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wider mb-2">
            🎯 即将开始
          </p>
          <h2 className="text-xl font-bold text-gray-900 leading-snug">{task.title}</h2>
          {task.note && (
            <p className="text-sm text-gray-400 mt-1">{task.note}</p>
          )}
          {/* 子任务概览 */}
          {subtasks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {subtasks.map(sub => (
                <span
                  key={sub.id}
                  className={`text-xs px-2 py-0.5 rounded-full transition-all ${
                    sub.completed
                      ? 'bg-emerald-50 text-emerald-400 line-through'
                      : sub.id === activeSubtask?.id
                        ? 'bg-indigo-100 text-indigo-600 font-medium ring-1 ring-indigo-300'
                        : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {sub.id === activeSubtask?.id && '▸ '}{sub.title}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 分割线 */}
        <div className="mx-6 border-t border-gray-100" />

        {/* ============ Understanding 阶段 ============ */}
        {ENABLE_TASK_UNDERSTANDING && phase === 'understanding' && (
          <div className="px-6 py-5">
            {/* 阶段提示 */}
            <p className="text-xxs text-gray-400 mb-3">
              💭 在开始之前，先想一下：
            </p>

            {/* 已回答的历史（第 2 轮时显示第 1 轮的问答） */}
            {reflectionHistory.length > 0 && (
              <div className="mb-3 space-y-2">
                {reflectionHistory.map((entry, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl px-3.5 py-2.5">
                    <p className="text-xxs text-gray-400 leading-relaxed">{entry.question}</p>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">{entry.answer}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 当前反思问题 */}
            {loadingQuestion && !changingQuestion ? (
              // 初始加载：骨架屏
              <div className="mb-3">
                <div className="h-5 w-4/5 bg-gray-100 rounded-lg animate-pulse" />
              </div>
            ) : (
              <p className={`text-sm text-gray-700 font-medium leading-relaxed mb-3 transition-opacity duration-200 ${
                changingQuestion ? 'opacity-40' : 'opacity-100'
              }`}>
                {reflectionQ}
              </p>
            )}

            {/* 输入框 */}
            <input
              ref={reflectionInputRef}
              type="text"
              value={reflectionAnswer}
              onChange={(e) => setReflectionAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && reflectionAnswer.trim()) handleSubmitReflection() }}
              placeholder="随便写几个字就行…"
              maxLength={100}
              disabled={loadingQuestion && !changingQuestion}
              className="w-full px-4 py-2.5 text-sm rounded-xl border-2 border-gray-200
                         focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100
                         outline-none transition-all bg-gray-50 focus:bg-white
                         placeholder-gray-300 disabled:opacity-50"
            />

            {/* 底部操作按钮 */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={handleChangeQuestion}
                disabled={changingQuestion || (loadingQuestion && !changingQuestion)}
                className="text-xs text-gray-400 hover:text-indigo-500 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {changingQuestion ? (
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 border-[1.5px] border-gray-300 border-t-indigo-400 rounded-full animate-spin" />
                    换一个…
                  </span>
                ) : '换个问题'}
              </button>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSkipUnderstanding}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  跳过
                </button>
                <button
                  onClick={handleSubmitReflection}
                  disabled={!reflectionAnswer.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold
                             hover:bg-emerald-600 active:scale-95
                             disabled:opacity-40 disabled:cursor-not-allowed
                             shadow-md shadow-emerald-200/50 transition-all"
                >
                  {reflectionRound >= 2 ? '开始做' : '回答好了'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============ Micro Action 阶段（原有逻辑） ============ */}
        {phase === 'micro_action' && (
          <div className="px-6 py-5">
            {/* 如果有 understanding 上下文，显示一个轻提示 */}
            {reflectionHistory.length > 0 && (
              <div className="mb-3 bg-emerald-50/60 rounded-xl px-3.5 py-2 border border-emerald-100/80">
                <p className="text-2xs text-emerald-500 font-medium mb-1">💭 你刚才的思考</p>
                {reflectionHistory.map((entry, i) => (
                  <p key={i} className="text-xxs text-gray-500 leading-relaxed truncate">
                    {entry.question} → <span className="text-gray-600">{entry.answer}</span>
                  </p>
                ))}
              </div>
            )}

            <label className="block text-sm text-gray-600 font-medium mb-3 leading-relaxed">
              {activeSubtask ? (
                <>
                  下一步是「<span className="text-indigo-500 font-bold">{activeSubtask.title}</span>」，
                  你打算从哪个<span className="text-emerald-600 font-bold">具体动作</span>开始？
                </>
              ) : (
                <>
                  手放在键盘上，你现在的
                  <span className="text-emerald-600 font-bold">第一个极其具体的物理动作</span>
                  是什么？
                </>
              )}
            </label>

            {/* 输入框 */}
            <div className="flex gap-2">
              <input
                ref={microInputRef}
                type="text"
                value={microTask}
                onChange={(e) => { setMicroTask(e.target.value); sourceRef.current = 'self' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleStart() }}
                placeholder="例如：打开空白文档…"
                maxLength={50}
                className="flex-1 px-4 py-2.5 text-sm rounded-xl border-2 border-gray-200
                           focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100
                           outline-none transition-all bg-gray-50 focus:bg-white
                           placeholder-gray-400"
              />
              <button
                onClick={handleStart}
                disabled={!microTask.trim()}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-semibold
                           hover:bg-emerald-600 active:scale-95
                           disabled:opacity-40 disabled:cursor-not-allowed
                           shadow-md shadow-emerald-200/50 transition-all"
              >
                开始
              </button>
            </div>

            {/* AI 建议：带安抚说明的微动作卡片 */}
            <div className="mt-3 flex flex-col gap-2 min-h-[28px]">
              {/* 骨架占位 */}
              {loadingChips && (
                <AILoadingTips
                  variant="start"
                  title="AI 正在为你想第一步…"
                />
              )}
              {!loadingChips && chips.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => handleChipStart(chip)}
                  className="w-full text-left px-4 py-2.5 rounded-xl
                             bg-emerald-50 border border-emerald-200
                             hover:bg-emerald-100 hover:border-emerald-300
                             active:scale-[0.98] transition-all cursor-pointer group"
                >
                  <span className="text-sm text-emerald-700 font-medium">▶ {chip.action}</span>
                  {chip.note && (
                    <span className="block text-[12px] text-emerald-500/70 mt-0.5 leading-snug">
                      {chip.note}
                    </span>
                  )}
                </button>
              ))}
              {!loadingChips && chipError && (
                <span className="text-xs text-red-400" title={chipError}>⚠️ {chipError}</span>
              )}
              {!loadingChips && !chipError && chips.length === 0 && aiConfig.apiKey && (
                <span className="text-xs text-gray-300">（AI 暂无建议）</span>
              )}
            </div>
          </div>
        )}

        {/* 底部操作：跳过 + 取消 */}
        <div className="px-6 pb-4 flex justify-between items-center">
          {/* 跳过：直接进入执行，不输入第一步 */}
          <button
            onClick={handleSkip}
            className="text-xs text-indigo-400 hover:text-indigo-600 transition-colors"
          >
            跳过，直接开始 →
          </button>
          <button
            onClick={handleClose}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            取消 (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
