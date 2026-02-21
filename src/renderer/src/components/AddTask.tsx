import { useState, useRef } from 'react'
import type { Task, Subtask } from '../types'

interface AddTaskProps {
  onAdd: (task: Task) => void
}

/**
 * 底部添加任务组件
 * 快速模式：直接在输入框打字，按 Enter 以默认优先级"中"添加任务
 * 高级模式：点击右侧展开按钮，填写备注、优先级、子任务后添加
 */
export default function AddTask({ onAdd }: AddTaskProps) {
  const [title, setTitle] = useState('')           // 主输入框内容
  const [isOpen, setIsOpen] = useState(false)      // 是否展开高级选项面板
  const [note, setNote] = useState('')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [subtaskInput, setSubtaskInput] = useState('')
  const subtaskInputRef = useRef<HTMLInputElement>(null)

  /** 提交任务（快速 / 高级通用） */
  const handleSubmit = () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    const finalSubtasks = [...subtasks]
    const pending = subtaskInput.trim()
    if (pending) {
      finalSubtasks.push({ id: `sub-${Date.now()}-${Math.random()}`, title: pending, completed: false })
    }
    onAdd({
      id: Date.now().toString(),
      title: trimmedTitle,
      note: note.trim(),
      priority,
      completed: false,
      createdAt: Date.now(),
      subtasks: finalSubtasks.length > 0 ? finalSubtasks : undefined,
    })
    handleReset()
  }

  const handleReset = () => {
    setTitle(''); setNote(''); setPriority('medium')
    setSubtasks([]); setSubtaskInput(''); setIsOpen(false)
  }

  /** 主输入框按键：Enter 提交，Escape 清空并关闭高级面板 */
  const handleMainKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSubmit() }
    if (e.key === 'Escape') handleReset()
  }

  const handleAddSubtask = () => {
    const trimmed = subtaskInput.trim()
    if (!trimmed) return
    setSubtasks(prev => [...prev, { id: `sub-${Date.now()}-${Math.random()}`, title: trimmed, completed: false }])
    setSubtaskInput('')
    subtaskInputRef.current?.focus()
  }

  const priorities = [
    { value: 'high',   label: '高', activeClass: 'bg-red-500 text-white',    inactiveClass: 'text-red-400 border border-red-200 hover:bg-red-50' },
    { value: 'medium', label: '中', activeClass: 'bg-orange-500 text-white', inactiveClass: 'text-orange-400 border border-orange-200 hover:bg-orange-50' },
    { value: 'low',    label: '低', activeClass: 'bg-blue-500 text-white',   inactiveClass: 'text-blue-400 border border-blue-200 hover:bg-blue-50' },
  ] as const

  return (
    <div className="relative px-3 pt-1 pb-2">

      {/* 点击遮罩关闭高级面板 */}
      {isOpen && <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />}

      {/* 高级选项面板：从输入条上方弹出 */}
      {isOpen && (
        <div className="absolute bottom-full left-3 right-3 mb-2 z-20 rounded-2xl bg-white border border-gray-200 shadow-xl p-3 space-y-2.5">
          {/* 备注 */}
          <input
            autoFocus
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit() } if (e.key === 'Escape') setIsOpen(false) }}
            placeholder="备注（可选）"
            maxLength={100}
            className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
          />

          {/* 子任务 */}
          <div className="space-y-1.5">
            {subtasks.map((sub, idx) => (
              <div key={sub.id} className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-gray-50">
                <span className="text-xs text-gray-300 flex-shrink-0 w-3 text-right">{idx + 1}</span>
                <span className="flex-1 text-xs text-gray-700 truncate">{sub.title}</span>
                <button
                  onClick={() => setSubtasks(prev => prev.filter(s => s.id !== sub.id))}
                  className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5 pl-1">
              <input
                ref={subtaskInputRef}
                type="text"
                value={subtaskInput}
                onChange={(e) => setSubtaskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtask() } }}
                placeholder="+ 添加子任务（按 Enter 确认）"
                maxLength={50}
                className="flex-1 px-2 py-1 text-xs rounded-lg border border-dashed border-gray-200 bg-white focus:outline-none focus:border-indigo-300 focus:border-solid transition-all placeholder-gray-300"
              />
            </div>
          </div>

          {/* 优先级 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">优先级：</span>
            {priorities.map((p) => (
              <button key={p.value} onClick={() => setPriority(p.value)}
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${priority === p.value ? p.activeClass : p.inactiveClass}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ===== 底部主输入条 ===== */}
      <div className="relative z-20 flex items-center gap-2 px-3 py-2.5 rounded-2xl bg-white border border-gray-200 shadow-md focus-within:border-indigo-300 focus-within:shadow-indigo-100 transition-all">

        {/* 加号图标（装饰） */}
        <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </div>

        {/* 直接可输入的文本框 */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleMainKeyDown}
          placeholder="添加新任务，按 Enter 确认..."
          maxLength={50}
          className="flex-1 text-sm text-gray-700 placeholder-gray-400 bg-transparent outline-none"
        />

        {/* 右侧：展开高级选项按钮 */}
        <button
          onClick={() => setIsOpen(v => !v)}
          className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
            isOpen
              ? 'bg-indigo-500 text-white'
              : 'text-gray-300 hover:text-indigo-400 hover:bg-indigo-50'
          }`}
          title="设置优先级、备注、子任务"
        >
          {/* 三个点图标 */}
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
          </svg>
        </button>

        {/* 发送按钮（有内容时高亮，点击提交） */}
        <button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-200 text-white disabled:text-gray-400"
          title="添加任务（Enter）"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </button>

      </div>
    </div>
  )
}
