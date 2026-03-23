/**
 * 搬迁轻提示条 —— 显示在任务列表底部、新建输入框上方。
 *
 * 改进点：
 *   - 聚合最近 7 天所有未完成任务（而非只显示一天）
 *   - 底部位置不打扰主交互流程
 *   - 收起态只有一行灰色小字，极其轻量
 *   - 展开后按日期分组，支持勾选后批量搬迁
 */

import { useState, useMemo } from 'react'
import type { Task } from '../types'

export interface CarryOverGroup {
  fromDate: string
  tasks: Task[]
}

interface CarryOverBannerProps {
  groups: CarryOverGroup[]
  onCarryOver: (dateTaskMap: Record<string, string[]>) => void
  onDismiss: () => void
}

function dateLabel(fromDate: string): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const from = new Date(fromDate + 'T00:00:00')
  const diffDays = Math.round((today.getTime() - from.getTime()) / 86400000)
  if (diffDays === 1) return '昨天'
  if (diffDays === 2) return '前天'
  return `${from.getMonth() + 1}月${from.getDate()}日`
}

export default function CarryOverBanner({ groups, onCarryOver, onDismiss }: CarryOverBannerProps) {
  const [expanded, setExpanded] = useState(false)

  const totalCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.tasks.length, 0),
    [groups],
  )

  // 默认全选
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>()
    groups.forEach(g => g.tasks.forEach(t => ids.add(t.id)))
    return ids
  })

  const toggleTask = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = () => {
    if (selectedIds.size === 0) return
    const dateTaskMap: Record<string, string[]> = {}
    for (const g of groups) {
      const ids = g.tasks.filter(t => selectedIds.has(t.id)).map(t => t.id)
      if (ids.length > 0) dateTaskMap[g.fromDate] = ids
    }
    onCarryOver(dateTaskMap)
  }

  const dayCount = groups.length

  if (totalCount === 0) return null

  // -------- 收起态：一行引导式提示 --------
  if (!expanded) {
    return (
      <div className="flex items-center justify-center gap-2 py-2.5 select-none">
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 text-xxs text-amber-600/80 hover:text-amber-700
                     transition-colors rounded-xl px-3.5 py-2 bg-amber-50/70 hover:bg-amber-50
                     border border-amber-200/60 hover:border-amber-300/70 hover:shadow-sm"
        >
          <span className="text-sm">📦</span>
          <span>
            {dayCount === 1
              ? `${dateLabel(groups[0].fromDate)}还有 ${totalCount} 个任务没做完，要继续吗`
              : `之前有 ${totalCount} 个任务还没做完哦，看看要不要加到今天`
            }
          </span>
          <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          onClick={onDismiss}
          className="text-3xs text-gray-300 hover:text-gray-500 transition-colors px-1"
          title="不需要"
        >
          ✕
        </button>
      </div>
    )
  }

  // -------- 展开态：按日期分组 --------
  return (
    <div className="mx-3 my-2 rounded-xl border border-amber-200/70 bg-amber-50/50 overflow-hidden
                    shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center gap-1.5 text-xs text-amber-700"
        >
          <span className="text-sm">📦</span>
          <span className="font-medium">
            {dayCount === 1
              ? `${dateLabel(groups[0].fromDate)}还有 ${totalCount} 个没做完`
              : `之前 ${dayCount} 天共 ${totalCount} 个没做完`
            }
          </span>
          <svg className="w-3 h-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleConfirm}
            disabled={selectedIds.size === 0}
            className="text-xxs font-medium px-3 py-1 rounded-lg
                       bg-amber-500 hover:bg-amber-600 active:scale-95
                       text-white disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all duration-150"
          >
            加到今天{selectedIds.size < totalCount && selectedIds.size > 0
              ? ` (${selectedIds.size})` : ''}
          </button>
          <button
            onClick={onDismiss}
            className="text-xxs text-gray-400 hover:text-gray-600 transition-colors px-1"
            title="不需要"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 按日期分组的任务列表 */}
      <div className="border-t border-amber-200/50 px-4 py-2 space-y-2 max-h-[200px] overflow-y-auto">
        {groups.map(group => (
          <div key={group.fromDate}>
            <div className="text-3xs text-amber-500 font-medium mb-1">
              {dateLabel(group.fromDate)}
            </div>
            {group.tasks.map(task => (
              <label
                key={task.id}
                className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-amber-100/40
                           cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onChange={() => toggleTask(task.id)}
                  className="w-3 h-3 rounded accent-amber-500"
                />
                <span className="text-xxs text-gray-600 truncate">{task.title}</span>
                {task.subtasks && task.subtasks.length > 0 && (
                  <span className="text-3xs text-gray-400 flex-shrink-0">
                    ({task.subtasks.filter(s => s.completed).length}/{task.subtasks.length})
                  </span>
                )}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
