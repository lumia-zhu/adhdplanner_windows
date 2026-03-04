/**
 * FocusFlow —— 阶段1：元认知拦截覆盖层
 *
 * 用户点击某个任务时触发：
 *   1. 背景柔和模糊淡入，营造聚焦感
 *   2. 卡片从下方平滑滑入
 *   3. 输入框自动聚焦
 *   4. AI 自动生成 2 个可点击的微动作筹码
 *   5. 用户确认后进入执行阶段
 */

import { useState, useEffect, useRef } from 'react'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { aiCache } from '../services/ai-cache'

interface FocusFlowProps {
  task: Task
  aiConfig: AIConfig
  onStart: (microTask: string, source: 'self' | 'ai_chip') => void
  onCancel: () => void
}

export default function FocusFlow({ task, aiConfig, onStart, onCancel }: FocusFlowProps) {
  const [microTask, setMicroTask] = useState('')
  const [chips, setChips] = useState<string[]>([])
  const [loadingChips, setLoadingChips] = useState(false)
  const [chipError, setChipError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<'self' | 'ai_chip'>('self')

  // ---- 子任务导航：找到第一个未完成的子任务 ----
  const subtasks = task.subtasks ?? []
  const activeSubtask = subtasks.find(s => !s.completed) ?? null

  // 入场动画状态：mounted 后延迟一帧触发 CSS transition
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  // 自动获取 AI 建议（优先缓存 → 在途请求 → 新请求）+ 延迟聚焦
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 350)
    if (!aiConfig.apiKey || !aiConfig.modelId) return () => clearTimeout(timer)
    setLoadingChips(true)
    setChipError(null)
    let cancelled = false
    aiCache.get(task.id, task.title, aiConfig, activeSubtask?.title)
      .then(({ chips: newChips, error, fromCache }) => {
        if (cancelled) return
        setChips(newChips)
        if (error) setChipError(error)
        if (fromCache) console.log('[FocusFlow] AI 建议来自缓存，秒出 ✓')
      })
      .finally(() => { if (!cancelled) setLoadingChips(false) })
    return () => { cancelled = true; clearTimeout(timer) }
  }, [task.id])

  // 退出动画：先淡出再回调
  const handleClose = () => {
    setVisible(false)
    setTimeout(onCancel, 300)
  }

  // Esc 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  const handleStart = () => {
    const text = microTask.trim()
    if (text) onStart(text, sourceRef.current)
  }

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
        {/* 顶部：选中的任务 */}
        <div className="px-6 pt-6 pb-4">
          <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wider mb-2">
            🎯 即将开始
          </p>
          <h2 className="text-xl font-bold text-gray-900 leading-snug">{task.title}</h2>
          {task.note && (
            <p className="text-sm text-gray-400 mt-1">{task.note}</p>
          )}
          {/* 子任务概览：高亮当前要做的子任务 */}
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

        {/* 微脚手架区域 */}
        <div className="px-6 py-5">
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
              ref={inputRef}
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

          {/* AI 建议筹码 */}
          <div className="mt-3 flex flex-wrap gap-2 min-h-[28px]">
            {loadingChips && (
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-gray-300 border-t-emerald-400 rounded-full animate-spin" />
                AI 正在思考…
              </span>
            )}
            {!loadingChips && chips.map((chip, i) => (
              <button
                key={i}
                onClick={() => { setMicroTask(chip); sourceRef.current = 'ai_chip'; inputRef.current?.focus() }}
                className="text-xs px-3 py-1.5 rounded-full
                           bg-emerald-50 text-emerald-700 border border-emerald-200
                           hover:bg-emerald-100 hover:border-emerald-300
                           active:scale-95 transition-all cursor-pointer"
              >
                💡 {chip}
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

        {/* 底部取消 */}
        <div className="px-6 pb-4 flex justify-end">
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
