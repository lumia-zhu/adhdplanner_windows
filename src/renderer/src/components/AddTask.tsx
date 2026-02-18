import { useState, useRef } from 'react'
import type { Task, Subtask } from '../types'

interface AddTaskProps {
  onAdd: (task: Task) => void  // 添加任务的回调函数
}

/**
 * 添加任务表单组件
 * 支持：标题、备注、优先级、子任务列表
 */
export default function AddTask({ onAdd }: AddTaskProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])  // 子任务列表
  const [subtaskInput, setSubtaskInput] = useState('')      // 子任务输入框内容
  const subtaskInputRef = useRef<HTMLInputElement>(null)

  /** 添加一条子任务到列表 */
  const handleAddSubtask = () => {
    const trimmed = subtaskInput.trim()
    if (!trimmed) return
    setSubtasks(prev => [...prev, {
      id: `sub-${Date.now()}-${Math.random()}`,
      title: trimmed,
      completed: false,
    }])
    setSubtaskInput('')
    // 添加后光标留在输入框，方便连续输入
    subtaskInputRef.current?.focus()
  }

  /** 删除一条子任务 */
  const handleRemoveSubtask = (id: string) => {
    setSubtasks(prev => prev.filter(s => s.id !== id))
  }

  /** 提交表单：创建新任务 */
  const handleSubmit = () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    // 如果子任务输入框还有未确认的内容，先自动加进去
    const finalSubtasks = [...subtasks]
    const pendingSubtask = subtaskInput.trim()
    if (pendingSubtask) {
      finalSubtasks.push({
        id: `sub-${Date.now()}-${Math.random()}`,
        title: pendingSubtask,
        completed: false,
      })
    }

    const newTask: Task = {
      id: Date.now().toString(),
      title: trimmedTitle,
      note: note.trim(),
      priority,
      completed: false,
      createdAt: Date.now(),
      subtasks: finalSubtasks.length > 0 ? finalSubtasks : undefined,
    }

    onAdd(newTask)
    handleReset()
  }

  const handleReset = () => {
    setTitle('')
    setNote('')
    setPriority('medium')
    setSubtasks([])
    setSubtaskInput('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
    if (e.key === 'Escape') handleReset()
  }

  /** 子任务输入框按 Enter 添加，按 Escape 清空 */
  const handleSubtaskKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask() }
    if (e.key === 'Escape') setSubtaskInput('')
  }

  const priorities = [
    { value: 'high',   label: '高', activeClass: 'bg-red-500 text-white',    inactiveClass: 'text-red-400 border border-red-200 hover:bg-red-50' },
    { value: 'medium', label: '中', activeClass: 'bg-orange-500 text-white', inactiveClass: 'text-orange-400 border border-orange-200 hover:bg-orange-50' },
    { value: 'low',    label: '低', activeClass: 'bg-blue-500 text-white',   inactiveClass: 'text-blue-400 border border-blue-200 hover:bg-blue-50' },
  ] as const

  return (
    <div className="px-4 py-3 border-b border-gray-100">
      {!isOpen ? (
        /* 收起状态：点击展开表单 */
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
        /* 展开状态：完整表单 */
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/30 p-3 space-y-2.5">

          {/* 任务标题 */}
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

          {/* 备注 */}
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="备注（可选）"
            maxLength={100}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />

          {/* ===== 子任务区域 ===== */}
          <div className="space-y-1.5">
            {/* 已添加的子任务列表 */}
            {subtasks.map((sub, idx) => (
              <div key={sub.id} className="flex items-center gap-1.5 pl-1">
                {/* 层级缩进线 */}
                <div className="w-3 h-px bg-gray-300 flex-shrink-0" />
                <span className="text-xs text-gray-400 flex-shrink-0">{idx + 1}.</span>
                <span className="flex-1 text-xs text-gray-700 truncate">{sub.title}</span>
                {/* 删除子任务 */}
                <button
                  onClick={() => handleRemoveSubtask(sub.id)}
                  className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* 子任务输入行 */}
            <div className="flex items-center gap-1.5 pl-1">
              <div className="w-3 h-px bg-gray-200 flex-shrink-0" />
              <input
                ref={subtaskInputRef}
                type="text"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={handleSubtaskKeyDown}
                placeholder="+ 添加子任务（按 Enter 确认）"
                maxLength={50}
                className="flex-1 px-2 py-1 text-xs rounded-md border border-dashed border-gray-200 bg-white focus:outline-none focus:border-indigo-300 focus:border-solid transition-all placeholder-gray-300"
              />
            </div>
          </div>

          {/* 优先级 + 操作按钮 */}
          <div className="flex items-center justify-between">
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
            <div className="flex gap-1.5">
              <button
                onClick={handleReset}
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
