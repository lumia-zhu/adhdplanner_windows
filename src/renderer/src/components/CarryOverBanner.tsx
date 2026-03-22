/**
 * 搬迁横幅组件
 *
 * 当检测到前几天有未完成的任务时，在主界面顶部显示一个横幅，
 * 让用户选择是否把那些任务搬到今天。
 *
 * 设计原则：
 *   - 简洁友好，不打断用户
 *   - 默认全选，用户可以取消不想搬的
 *   - 支持展开/收起查看详情
 */

import { useState, useMemo } from 'react'
import type { Task } from '../types'

interface CarryOverBannerProps {
  /** 来源日期（如 "2026-03-12"） */
  fromDate: string
  /** 可搬迁的未完成任务列表 */
  tasks: Task[]
  /** 确认搬迁（传入选中的 task id 数组） */
  onCarryOver: (taskIds: string[]) => void
  /** 用户不需要搬迁（今天不再提示） */
  onDismiss: () => void
}

export default function CarryOverBanner({ fromDate, tasks, onCarryOver, onDismiss }: CarryOverBannerProps) {
  // 是否展开详情
  const [expanded, setExpanded] = useState(false)
  // 选中的任务 ID 集合（默认全选）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(tasks.map(t => t.id)))

  // 格式化来源日期为友好文字
  const fromLabel = useMemo(() => {
    // ★ 两端都归零到凌晨 0 点，避免当前时刻影响天数计算（下午时"昨天"被误算为"前天"）
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const from = new Date(fromDate + 'T00:00:00')
    const diffDays = Math.round((today.getTime() - from.getTime()) / 86400000)
    if (diffDays === 1) return '昨天'
    if (diffDays === 2) return '前天'
    // 显示月日
    return `${from.getMonth() + 1}月${from.getDate()}日`
  }, [fromDate])

  const toggleTask = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === tasks.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tasks.map(t => t.id)))
    }
  }

  const handleConfirm = () => {
    if (selectedIds.size === 0) return
    onCarryOver(Array.from(selectedIds))
  }

  return (
    <div className="mx-3 mt-2 mb-1 rounded-xl border border-amber-200 bg-amber-50/80 overflow-hidden
                    shadow-sm animate-in slide-in-from-top duration-300">
      {/* 主横幅 */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <span className="text-base">📦</span>
          <span>
            {fromLabel}有 <strong>{tasks.length}</strong> 个未完成的任务
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* 查看详情 / 收起 */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-amber-600 hover:text-amber-800 transition-colors px-2 py-1"
          >
            {expanded ? '收起' : '查看'}
          </button>
          {/* 搬到今天 */}
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="text-xs font-medium px-3 py-1.5 rounded-xl
                       bg-amber-500 hover:bg-amber-600 active:scale-95
                       text-white disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all duration-150"
          >
            搬到今天{selectedIds.size < tasks.length && selectedIds.size > 0
              ? ` (${selectedIds.size})`
              : ''}
          </button>
          {/* 不需要 */}
          <button
            onClick={onDismiss}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-1 py-1"
            title="不需要，今天不再提示"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 展开的任务列表 */}
      {expanded && (
        <div className="border-t border-amber-200/60 px-4 py-2 space-y-1">
          {/* 全选/取消全选 */}
          <button
            onClick={toggleAll}
            className="text-xs text-amber-600 hover:text-amber-800 mb-1"
          >
            {selectedIds.size === tasks.length ? '取消全选' : '全选'}
          </button>

          {tasks.map(task => (
            <label
              key={task.id}
              className="flex items-center gap-2 py-1 px-1 rounded hover:bg-amber-100/50
                         cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(task.id)}
                onChange={() => toggleTask(task.id)}
                className="w-3.5 h-3.5 rounded accent-amber-500"
              />
              <span className="text-sm text-gray-700 truncate">{task.title}</span>
              {task.subtasks && task.subtasks.length > 0 && (
                <span className="text-xs text-gray-400 flex-shrink-0">
                  ({task.subtasks.filter(s => s.completed).length}/{task.subtasks.length})
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
