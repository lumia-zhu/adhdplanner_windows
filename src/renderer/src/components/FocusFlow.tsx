/**
 * FocusFlow —— 阶段1：元认知拦截覆盖层
 *
 * 用户点击某个任务时触发：
 *   1. 全屏半透明遮罩，其他内容淡化
 *   2. 选中任务居中放大显示
 *   3. 下方出现输入框："你现在的第一个极其具体的物理动作是什么？"
 *   4. AI 自动生成 2 个可点击的微动作筹码
 *   5. 用户输入或点击筹码后按 Enter / 点击【开始】→ 进入执行阶段
 */

import { useState, useEffect, useRef } from 'react'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { generateMicroActions } from '../services/ai'

interface FocusFlowProps {
  task: Task
  aiConfig: AIConfig
  onStart: (microTask: string) => void   // 用户确认微任务 → 进入执行
  onCancel: () => void                    // 取消
}

export default function FocusFlow({ task, aiConfig, onStart, onCancel }: FocusFlowProps) {
  const [microTask, setMicroTask] = useState('')
  const [chips, setChips] = useState<string[]>([])
  const [loadingChips, setLoadingChips] = useState(false)
  const [chipError, setChipError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 自动请求 AI 建议
  useEffect(() => {
    inputRef.current?.focus()
    if (!aiConfig.apiKey || !aiConfig.modelId) return
    setLoadingChips(true)
    setChipError(null)
    generateMicroActions(task.title, undefined, aiConfig)
      .then(({ chips: newChips, error }) => {
        setChips(newChips)
        if (error) setChipError(error)
      })
      .finally(() => setLoadingChips(false))
  }, [task.id])

  const handleStart = () => {
    const text = microTask.trim()
    if (text) onStart(text)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 半透明遮罩 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />

      {/* 主内容卡片 */}
      <div className="relative z-10 w-[400px] bg-white rounded-2xl shadow-2xl overflow-hidden
                      animate-in fade-in zoom-in-95 duration-200">

        {/* 顶部：选中的任务 */}
        <div className="px-6 pt-6 pb-4">
          <p className="text-xs text-emerald-500 font-semibold uppercase tracking-wider mb-2">
            🎯 即将开始
          </p>
          <h2 className="text-xl font-bold text-gray-900 leading-snug">{task.title}</h2>
          {task.note && (
            <p className="text-sm text-gray-400 mt-1">{task.note}</p>
          )}
          {/* 子任务概览 */}
          {task.subtasks && task.subtasks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {task.subtasks.map(sub => (
                <span
                  key={sub.id}
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    sub.completed
                      ? 'bg-emerald-50 text-emerald-400 line-through'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {sub.title}
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
            手放在键盘上，你现在的
            <span className="text-emerald-600 font-bold">第一个极其具体的物理动作</span>
            是什么？
          </label>

          {/* 输入框 */}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={microTask}
              onChange={(e) => setMicroTask(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); if (e.key === 'Escape') onCancel() }}
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
                onClick={() => { setMicroTask(chip); inputRef.current?.focus() }}
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
            onClick={onCancel}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            取消 (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
