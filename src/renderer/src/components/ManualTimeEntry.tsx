/**
 * ManualTimeEntry —— 反思页补记时间面板
 *
 * 收起态：居中引导文字 + 未记录任务数提示
 * 展开后：
 *   - 已有任务（无专注记录）：每行一个任务，勾选后显示时间选择
 *   - 新增任务：输入框 + 时间选择，可先添加到列表或直接确认补记
 * 确认时自动把输入框中的未添加任务一并提交
 */

import { useState, useMemo, useCallback } from 'react'
import type { Task } from '../types'
import type { TrackEvent } from '../services/tracker'

interface ManualTimeEntryProps {
  tasks: Task[]
  events: TrackEvent[]
  selectedDate: string
  onConfirm: (newEvents: TrackEvent[], newTasks: { title: string }[]) => void
  onExpandChange?: (expanded: boolean) => void
}

interface EntryRow {
  id: string
  title: string
  checked: boolean
  startMinutes: number
  endMinutes: number
  isNew: boolean
}

const TIME_OPTIONS: { value: number; label: string }[] = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 15, 30, 45]) {
    const totalMin = h * 60 + m
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    TIME_OPTIONS.push({ value: totalMin, label })
  }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toTimestamp(dateStr: string, minutes: number): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return new Date(y, mo - 1, d, h, m, 0, 0).getTime()
}

function buildEventsForRow(
  row: { id: string; title: string; startMinutes: number; endMinutes: number; isNew: boolean },
  selectedDate: string,
): { events: TrackEvent[]; newTask: { title: string } | null } {
  const sessionId = uid()
  const startTs = toTimestamp(selectedDate, row.startMinutes)
  const endTs = toTimestamp(selectedDate, row.endMinutes)
  const durationSec = Math.round((endTs - startTs) / 1000)

  const events: TrackEvent[] = [
    {
      id: uid(),
      type: 'session.started',
      timestamp: startTs,
      date: selectedDate,
      payload: { sessionId, taskId: row.id, taskTitle: row.title, source: 'manual' },
    } as TrackEvent,
    {
      id: uid(),
      type: 'session.ended',
      timestamp: endTs,
      date: selectedDate,
      payload: {
        sessionId,
        taskId: row.id,
        taskTitle: row.title,
        totalDurationSeconds: durationSec,
        completedMicroSteps: 0,
        endReason: 'manual_entry',
        source: 'manual',
      },
    } as TrackEvent,
  ]

  return { events, newTask: row.isNew ? { title: row.title } : null }
}

export default function ManualTimeEntry({
  tasks,
  events,
  selectedDate,
  onConfirm,
  onExpandChange,
}: ManualTimeEntryProps) {
  const [expanded, setExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const tasksWithSession = useMemo(() => {
    const set = new Set<string>()
    for (const e of events) {
      if (e.type === 'session.started' || e.type === 'session.ended') {
        const p = e.payload as { taskTitle?: string }
        if (p.taskTitle) set.add(p.taskTitle)
      }
    }
    return set
  }, [events])

  const unrecordedTasks = useMemo(
    () => tasks.filter((t) => !tasksWithSession.has(t.title)),
    [tasks, tasksWithSession],
  )

  const [rows, setRows] = useState<EntryRow[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [newStart, setNewStart] = useState(9 * 60)
  const [newEnd, setNewEnd] = useState(10 * 60)

  const handleExpand = useCallback(() => {
    const next = !expanded
    if (next) {
      setRows(
        unrecordedTasks.map((t) => ({
          id: t.id,
          title: t.title,
          checked: false,
          startMinutes: 9 * 60,
          endMinutes: 10 * 60,
          isNew: false,
        })),
      )
    }
    setExpanded(next)
    onExpandChange?.(next)
  }, [expanded, unrecordedTasks, onExpandChange])

  const toggleRow = useCallback((id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, checked: !r.checked } : r)))
  }, [])

  const updateRowTime = useCallback(
    (id: string, field: 'startMinutes' | 'endMinutes', value: number) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
    },
    [],
  )

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const addNewRow = useCallback(() => {
    const trimmed = newTitle.trim()
    if (!trimmed) return
    setRows((prev) => [
      ...prev,
      {
        id: uid(),
        title: trimmed,
        checked: true,
        startMinutes: newStart,
        endMinutes: newEnd,
        isNew: true,
      },
    ])
    setNewTitle('')
  }, [newTitle, newStart, newEnd])

  const checkedRows = rows.filter((r) => r.checked)

  // 输入框里有未添加的任务名
  const hasPendingInput = newTitle.trim().length > 0
  const pendingInputValid = hasPendingInput && newEnd > newStart

  // 所有要提交的行（已勾选的 + 输入框中的）
  const totalToSubmit = checkedRows.length + (pendingInputValid ? 1 : 0)

  const hasInvalidTime =
    checkedRows.some((r) => r.endMinutes <= r.startMinutes) ||
    (hasPendingInput && newEnd <= newStart)

  const handleConfirm = useCallback(async () => {
    // 收集所有要提交的行
    const allRows: typeof checkedRows = [...checkedRows]

    // 输入框中有内容 → 自动当作新任务一并提交
    const trimmed = newTitle.trim()
    if (trimmed && newEnd > newStart) {
      allRows.push({
        id: uid(),
        title: trimmed,
        checked: true,
        startMinutes: newStart,
        endMinutes: newEnd,
        isNew: true,
      })
    }

    if (allRows.length === 0 || hasInvalidTime) return

    setSubmitting(true)
    try {
      const allEvents: TrackEvent[] = []
      const allNewTasks: { title: string }[] = []

      for (const row of allRows) {
        const { events: rowEvents, newTask } = buildEventsForRow(row, selectedDate)
        allEvents.push(...rowEvents)
        if (newTask) allNewTasks.push(newTask)
      }

      await onConfirm(allEvents, allNewTasks)

      setExpanded(false)
      onExpandChange?.(false)
      setRows([])
      setNewTitle('')
    } catch (e) {
      console.error('[ManualTimeEntry] 补记失败:', e)
    } finally {
      setSubmitting(false)
    }
  }, [checkedRows, newTitle, newStart, newEnd, hasInvalidTime, selectedDate, onConfirm])

  const unrecordedCount = unrecordedTasks.length
  const existingRows = rows.filter((r) => !r.isNew)
  const newRows = rows.filter((r) => r.isNew)

  // 底部状态文案
  const statusText = (() => {
    if (submitting) return '正在保存...'
    if (hasInvalidTime) return `已选 ${totalToSubmit} 项，有时间错误`
    if (totalToSubmit > 0) return `已选 ${totalToSubmit} 项`
    return '勾选或添加任务后补记'
  })()

  return (
    <div className="mt-2">
      {/* ---- 收起态按钮 ---- */}
      <button
        onClick={handleExpand}
        className={`w-full text-center text-xs transition-all duration-200 rounded-lg px-3 py-2.5
          ${
            expanded
              ? 'bg-indigo-50 border border-indigo-200 text-indigo-600'
              : 'bg-gray-50 hover:bg-indigo-50 border border-dashed border-gray-300 hover:border-indigo-300 text-gray-400 hover:text-indigo-500'
          }`}
      >
        {expanded ? (
          <span className="font-medium">▾ 收起补记</span>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span>✏️ 今天还做了别的事吗？补记一下让反思更完整</span>
            {unrecordedCount > 0 && (
              <span className="text-blue-600 text-xxs">
                {unrecordedCount} 个任务没有专注记录
              </span>
            )}
          </div>
        )}
      </button>

      {/* ---- 展开态面板 ---- */}
      {expanded && (
        <div className="mt-2 bg-white border border-gray-200 rounded-lg overflow-hidden">

          {/* 已有任务区域 */}
          {existingRows.length > 0 && (
            <div className="px-3 pt-3 pb-2">
              <p className="text-xxs text-gray-400 mb-2 text-center">
                以下任务没有专注记录，勾选并填写时间即可补记
              </p>
              <div className="space-y-1">
                {existingRows.map((row) => (
                  <RowItem
                    key={row.id}
                    row={row}
                    onToggle={toggleRow}
                    onUpdateTime={updateRowTime}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 新增的任务列表 */}
          {newRows.length > 0 && (
            <div className={`px-3 pb-2 ${existingRows.length > 0 ? 'pt-1' : 'pt-3'}`}>
              <p className="text-xxs text-gray-400 mb-2 text-center">已添加的任务</p>
              <div className="space-y-1">
                {newRows.map((row) => (
                  <RowItem
                    key={row.id}
                    row={row}
                    onToggle={toggleRow}
                    onUpdateTime={updateRowTime}
                    onRemove={removeRow}
                    removable
                  />
                ))}
              </div>
            </div>
          )}

          {/* 添加新任务区域 */}
          <div className="border-t border-gray-100 px-3 py-2.5">
            <p className="text-xxs text-gray-400 mb-2 text-center">
              做了别的事？在这里添加
            </p>
            <div className="flex items-center gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNewRow()}
                placeholder="任务名称..."
                className="flex-1 text-xs border border-gray-200 rounded-md px-2.5 py-1.5
                           focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100"
              />
              <TimePicker value={newStart} onChange={setNewStart} />
              <span className="text-xs text-gray-300">→</span>
              <TimePicker value={newEnd} onChange={setNewEnd} />
              <button
                onClick={addNewRow}
                disabled={!newTitle.trim()}
                className="text-xs px-2.5 py-1.5 rounded-md bg-gray-100 text-gray-500
                           hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed
                           transition-colors whitespace-nowrap"
                title="添加到列表（也可直接点确认补记）"
              >
                +
              </button>
            </div>
            {hasPendingInput && (
              <p className="text-xxs text-indigo-400 mt-1 text-center">
                点击"确认补记"会自动包含此任务
              </p>
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 bg-gray-50/50">
            <span className="text-xxs text-gray-400">{statusText}</span>
            <button
              onClick={handleConfirm}
              disabled={totalToSubmit === 0 || hasInvalidTime || submitting}
              className="text-xs px-4 py-1.5 rounded-md bg-indigo-500 text-white
                         hover:bg-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed
                         transition-colors font-medium"
            >
              {submitting ? '保存中...' : '确认补记'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ===================== 子组件 =====================

function RowItem({
  row,
  onToggle,
  onUpdateTime,
  onRemove,
  removable,
}: {
  row: EntryRow
  onToggle: (id: string) => void
  onUpdateTime: (id: string, field: 'startMinutes' | 'endMinutes', value: number) => void
  onRemove?: (id: string) => void
  removable?: boolean
}) {
  const timeInvalid = row.checked && row.endMinutes <= row.startMinutes
  const durationMin = row.endMinutes - row.startMinutes

  return (
    <div
      className={`rounded-md text-xs transition-colors ${
        row.checked
          ? 'bg-indigo-50/60 border border-indigo-100'
          : 'bg-gray-50/60 border border-transparent hover:border-gray-200'
      } px-2.5 py-2`}
    >
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer flex-1 min-w-0">
          <input
            type="checkbox"
            checked={row.checked}
            onChange={() => onToggle(row.id)}
            className="accent-indigo-500 w-3.5 h-3.5 flex-shrink-0"
          />
          <span
            className={`truncate ${row.checked ? 'text-gray-700 font-medium' : 'text-gray-400'}`}
          >
            {row.title}
          </span>
        </label>
        {removable && onRemove && (
          <button
            onClick={() => onRemove(row.id)}
            className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
            title="移除"
          >
            ×
          </button>
        )}
      </div>

      {row.checked && (
        <div className="flex items-center gap-2 mt-1.5 pl-5">
          <TimePicker
            value={row.startMinutes}
            onChange={(v) => onUpdateTime(row.id, 'startMinutes', v)}
          />
          <span className="text-xs text-gray-300">→</span>
          <TimePicker
            value={row.endMinutes}
            onChange={(v) => onUpdateTime(row.id, 'endMinutes', v)}
          />
          <span className="text-xxs text-gray-400 ml-auto">
            {timeInvalid ? (
              <span className="text-red-400">结束需晚于开始</span>
            ) : (
              `${durationMin} 分钟`
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function TimePicker({
  value,
  onChange,
}: {
  value: number
  onChange: (minutes: number) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="text-xs border border-gray-200 rounded-md px-1.5 py-1 bg-white
                 focus:outline-none focus:border-indigo-300 cursor-pointer"
    >
      {TIME_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
