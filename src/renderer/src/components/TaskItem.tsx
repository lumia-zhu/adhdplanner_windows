import { useState, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task, Subtask } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { triggerEffect } from '../effects'

interface TaskItemProps {
  task: Task
  onToggle: (id: string) => void                          // 切换父任务完成状态
  onToggleSubtask: (taskId: string, subtaskId: string) => void  // 切换子任务完成状态
  onEdit: (task: Task) => void                            // 编辑任务
  onDelete: (id: string) => void                          // 删除任务
  onFocus: (id: string) => void                           // 专注模式
}

export default function TaskItem({ task, onToggle, onToggleSubtask, onEdit, onDelete, onFocus }: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editNote, setEditNote] = useState(task.note)
  const [editPriority, setEditPriority] = useState(task.priority)
  const [editSubtasks, setEditSubtasks] = useState<Subtask[]>(task.subtasks ?? [])
  const [editSubtaskInput, setEditSubtaskInput] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [subtasksExpanded, setSubtasksExpanded] = useState(true) // 子任务默认展开
  const subtaskInputRef = useRef<HTMLInputElement>(null)

  // ---- dnd-kit 拖拽 ----
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const priorityConfig = PRIORITY_CONFIG[task.priority]
  const subtasks = task.subtasks ?? []
  const hasSubtasks = subtasks.length > 0
  const completedSubtaskCount = subtasks.filter(s => s.completed).length

  // ===== 编辑模式下的子任务操作 =====

  const handleAddEditSubtask = () => {
    const trimmed = editSubtaskInput.trim()
    if (!trimmed) return
    setEditSubtasks(prev => [...prev, {
      id: `sub-${Date.now()}-${Math.random()}`,
      title: trimmed,
      completed: false,
    }])
    setEditSubtaskInput('')
    subtaskInputRef.current?.focus()
  }

  const handleRemoveEditSubtask = (id: string) => {
    setEditSubtasks(prev => prev.filter(s => s.id !== id))
  }

  const handleSaveEdit = () => {
    if (!editTitle.trim()) return
    // 如果子任务输入框还有未确认内容，自动加入
    const finalSubtasks = [...editSubtasks]
    const pending = editSubtaskInput.trim()
    if (pending) {
      finalSubtasks.push({ id: `sub-${Date.now()}-${Math.random()}`, title: pending, completed: false })
    }
    onEdit({
      ...task,
      title: editTitle.trim(),
      note: editNote.trim(),
      priority: editPriority,
      subtasks: finalSubtasks.length > 0 ? finalSubtasks : undefined,
    })
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(task.title)
    setEditNote(task.note)
    setEditPriority(task.priority)
    setEditSubtasks(task.subtasks ?? [])
    setEditSubtaskInput('')
    setIsEditing(false)
  }

  const priorities = [
    { value: 'high',   label: '高', activeClass: 'bg-red-500 text-white',    inactiveClass: 'text-red-400 border border-red-200 hover:bg-red-50' },
    { value: 'medium', label: '中', activeClass: 'bg-orange-500 text-white', inactiveClass: 'text-orange-400 border border-orange-200 hover:bg-orange-50' },
    { value: 'low',    label: '低', activeClass: 'bg-blue-500 text-white',   inactiveClass: 'text-blue-400 border border-blue-200 hover:bg-blue-50' },
  ] as const

  // ===== 编辑模式 =====
  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/30 p-3 space-y-2">
        {/* 标题 */}
        <input
          autoFocus
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') handleCancelEdit() }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        {/* 备注 */}
        <input
          type="text"
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          placeholder="备注（可选）"
          className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />

        {/* 子任务编辑区 */}
        <div className="space-y-1">
          <span className="text-xs text-gray-400 font-medium">子任务</span>
          {editSubtasks.map((sub, idx) => (
            <div key={sub.id} className="flex items-center gap-1.5 pl-1">
              <div className="w-3 h-px bg-gray-300 flex-shrink-0" />
              <span className="text-xs text-gray-400 flex-shrink-0">{idx + 1}.</span>
              <span className={`flex-1 text-xs truncate ${sub.completed ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                {sub.title}
              </span>
              <button
                onClick={() => handleRemoveEditSubtask(sub.id)}
                className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          {/* 新增子任务输入 */}
          <div className="flex items-center gap-1.5 pl-1">
            <div className="w-3 h-px bg-gray-200 flex-shrink-0" />
            <input
              ref={subtaskInputRef}
              type="text"
              value={editSubtaskInput}
              onChange={(e) => setEditSubtaskInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEditSubtask() } }}
              placeholder="+ 添加子任务（按 Enter 确认）"
              maxLength={50}
              className="flex-1 px-2 py-1 text-xs rounded-md border border-dashed border-gray-200 bg-white focus:outline-none focus:border-indigo-300 focus:border-solid transition-all placeholder-gray-300"
            />
          </div>
        </div>

        {/* 优先级 + 保存/取消 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">优先级：</span>
            {priorities.map((p) => (
              <button
                key={p.value}
                onClick={() => setEditPriority(p.value)}
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                  editPriority === p.value ? p.activeClass : p.inactiveClass
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button onClick={handleCancelEdit} className="px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
            <button onClick={handleSaveEdit} disabled={!editTitle.trim()} className="px-3 py-1.5 text-xs bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-40">保存</button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 正常显示模式 =====
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-xl border transition-all duration-200 ${
        isDragging
          ? 'shadow-lg border-indigo-200 bg-indigo-50 opacity-90 z-50 scale-[1.02]'
          : task.completed
            ? 'bg-gray-50 border-gray-100 opacity-60'
            : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm'
      }`}
    >
      {/* ===== 主行：拖动把手 + 勾选 + 标题 + 操作按钮 ===== */}
      <div className="flex items-center gap-2 px-0 py-0">
        {/* 拖动把手 */}
        <div
          {...attributes}
          {...listeners}
          className="pl-2 py-3 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400 transition-colors flex-shrink-0 touch-none"
          title="拖动排序"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" />
            <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
            <circle cx="5" cy="12" r="1.5" /><circle cx="11" cy="12" r="1.5" />
          </svg>
        </div>

        {/* 主内容区 */}
        <div className="flex flex-1 items-start gap-2 py-2.5 pr-2 min-w-0">
          {/* 完成勾选按钮 */}
          <button
            onClick={(e) => {
              onToggle(task.id)
              if (!task.completed) triggerEffect(e.currentTarget)
            }}
            className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
              task.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-indigo-400'
            }`}
          >
            {task.completed && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          {/* 标题 + 备注 */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${task.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
              {task.title}
            </p>
            {task.note && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">{task.note}</p>
            )}
          </div>

          {/* 右侧：进度 + 优先级 + 操作按钮 */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 子任务进度（有子任务时显示） */}
            {hasSubtasks && (
              <button
                onClick={() => setSubtasksExpanded(v => !v)}
                className="flex items-center gap-0.5 text-xs text-gray-400 hover:text-indigo-500 transition-colors bg-gray-50 hover:bg-indigo-50 px-1.5 py-0.5 rounded-md"
                title={subtasksExpanded ? '收起子任务' : '展开子任务'}
              >
                {/* 折叠箭头 */}
                <svg className={`w-2.5 h-2.5 transition-transform ${subtasksExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                <span className={completedSubtaskCount === subtasks.length ? 'text-green-500' : ''}>
                  {completedSubtaskCount}/{subtasks.length}
                </span>
              </button>
            )}

            {/* 优先级标签 */}
            <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md ${priorityConfig.bg} ${priorityConfig.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${priorityConfig.dot}`}></span>
              {priorityConfig.label}
            </span>

            {/* 专注按钮（仅未完成任务） */}
            {!task.completed && (
              <button
                onClick={() => onFocus(task.id)}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md hover:bg-green-50 flex items-center justify-center text-gray-400 hover:text-green-500 transition-all"
                title="专注此任务"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}

            {/* 编辑按钮 */}
            <button
              onClick={() => setIsEditing(true)}
              className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md hover:bg-indigo-50 flex items-center justify-center text-gray-400 hover:text-indigo-500 transition-all"
              title="编辑"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </button>

            {/* 删除按钮（二次确认） */}
            {showDeleteConfirm ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-red-500">确认?</span>
                <button onClick={() => onDelete(task.id)} className="w-6 h-6 rounded-md bg-red-500 flex items-center justify-center text-white hover:bg-red-600 transition-all">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
                <button onClick={() => setShowDeleteConfirm(false)} className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-all">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md hover:bg-red-50 flex items-center justify-center text-gray-400 hover:text-red-500 transition-all"
                title="删除"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===== 子任务列表（可折叠）===== */}
      {hasSubtasks && subtasksExpanded && (
        <div className="pb-2 pr-2 pl-10 space-y-1">
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2 group/sub">
              {/* 层级连接线 */}
              <div className="w-3 h-px bg-gray-200 flex-shrink-0" />

              {/* 子任务勾选按钮 */}
              <button
                onClick={(e) => {
                  onToggleSubtask(task.id, sub.id)
                  if (!sub.completed) triggerEffect(e.currentTarget)
                }}
                className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-all ${
                  sub.completed
                    ? 'bg-green-400 border-green-400'
                    : 'border-gray-300 hover:border-indigo-400'
                }`}
              >
                {sub.completed && (
                  <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              {/* 子任务标题 */}
              <span className={`flex-1 text-xs truncate ${sub.completed ? 'line-through text-gray-300' : 'text-gray-600'}`}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
