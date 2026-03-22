/**
 * QuickFocusEndDialog —— 快速专注结束弹窗
 *
 * 当用户在「快速专注」模式下点击「做完了」时弹出。
 * 弹窗让用户输入刚才做了什么（任务名称），然后创建一个已完成的任务。
 * 如果用户不想填写，也可以跳过（用默认名称"专注时段"保存）。
 */

import { useState, useRef, useEffect } from 'react'

interface QuickFocusEndDialogProps {
  /** 本次专注的时长（秒） */
  durationSeconds: number
  /** 确认提交：传入用户填写的任务名 */
  onConfirm: (taskTitle: string) => void
  /** 跳过不填：用默认名称保存 */
  onSkip: () => void
}

/** 把秒数格式化为 "XX 分 XX 秒" 或 "XX 分钟" 形式 */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s} 秒`
  if (s === 0) return `${m} 分钟`
  return `${m} 分 ${s} 秒`
}

export default function QuickFocusEndDialog({
  durationSeconds,
  onConfirm,
  onSkip,
}: QuickFocusEndDialogProps) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 弹窗打开时自动聚焦输入框
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const handleSubmit = () => {
    const trimmed = title.trim()
    if (trimmed) {
      onConfirm(trimmed)
    } else {
      onSkip()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onSkip()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[380px] p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* 标题 & 时长 */}
        <div className="text-center mb-5">
          <div className="text-3xl mb-2">🎉</div>
          <h2 className="text-lg font-semibold text-gray-800">专注完成！</h2>
          <p className="text-sm text-gray-400 mt-1">
            你刚才专注了 <span className="text-emerald-600 font-medium">{formatDuration(durationSeconds)}</span>
          </p>
        </div>

        {/* 输入区域 */}
        <div className="mb-5">
          <label className="block text-sm text-gray-500 mb-1.5">你刚才做了什么？</label>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例如：写论文第三章、整理笔记..."
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm
                       focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400
                       placeholder:text-gray-300 transition-all"
            maxLength={100}
          />
        </div>

        {/* 按钮区域 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onSkip}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm text-gray-400
                       hover:text-gray-600 hover:bg-gray-50 transition-all"
          >
            跳过
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold
                       bg-emerald-500 text-white shadow-sm shadow-emerald-200/50
                       hover:bg-emerald-600 active:scale-[0.98] transition-all"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
