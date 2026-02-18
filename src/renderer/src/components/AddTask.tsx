import { useState } from 'react'
import type { Task } from '../types'

interface AddTaskProps {
  onAdd: (task: Task) => void  // 添加任务的回调函数
}

/**
 * 添加任务表单组件
 * 点击"+"按钮展开表单，填写任务信息后点击"添加"
 */
export default function AddTask({ onAdd }: AddTaskProps) {
  const [isOpen, setIsOpen] = useState(false)   // 表单是否展开
  const [title, setTitle] = useState('')         // 任务标题
  const [note, setNote] = useState('')           // 备注
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium') // 优先级

  /** 提交表单：创建新任务 */
  const handleSubmit = () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return // 标题不能为空

    const newTask: Task = {
      id: Date.now().toString(),   // 用当前时间戳作为唯一ID
      title: trimmedTitle,
      note: note.trim(),
      priority,
      completed: false,
      createdAt: Date.now()
    }

    onAdd(newTask)

    // 重置表单
    setTitle('')
    setNote('')
    setPriority('medium')
    setIsOpen(false)
  }

  /** 按 Enter 键快速提交 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  // 优先级按钮配置
  const priorities = [
    { value: 'high', label: '高', activeClass: 'bg-red-500 text-white', inactiveClass: 'text-red-400 border border-red-200 hover:bg-red-50' },
    { value: 'medium', label: '中', activeClass: 'bg-orange-500 text-white', inactiveClass: 'text-orange-400 border border-orange-200 hover:bg-orange-50' },
    { value: 'low', label: '低', activeClass: 'bg-blue-500 text-white', inactiveClass: 'text-blue-400 border border-blue-200 hover:bg-blue-50' },
  ] as const

  return (
    <div className="px-4 py-3 border-b border-gray-100">
      {/* 当表单关闭时，显示简洁的输入提示行 */}
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-400 transition-all duration-200 group"
        >
          <div className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center group-hover:bg-indigo-50">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="text-sm">添加新任务...</span>
        </button>
      ) : (
        /* 展开后的完整表单 */
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/30 p-3 space-y-2.5">
          {/* 任务标题输入框 */}
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="任务标题（必填）"
            maxLength={50}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />

          {/* 备注输入框 */}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="备注（可选）"
            maxLength={100}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />

          {/* 优先级选择 + 操作按钮 */}
          <div className="flex items-center justify-between">
            {/* 优先级快速选择 */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">优先级：</span>
              {priorities.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                    priority === p.value ? p.activeClass : p.inactiveClass
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* 取消 / 添加按钮 */}
            <div className="flex gap-1.5">
              <button
                onClick={() => { setIsOpen(false); setTitle(''); setNote('') }}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={!title.trim()}
                className="px-3 py-1.5 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
