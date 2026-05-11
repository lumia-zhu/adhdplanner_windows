/**
 * NoteEditor —— 记事本风格的任务编辑器
 *
 * 核心交互：
 *   Enter       → 在当前行下方新建一行（子任务行则新建子任务；空子任务行则"升级"为新任务）
 *   Tab         → 把当前任务缩进为上一个任务的子任务
 *   Shift+Tab   → 把子任务"升级"为独立任务
 *   Backspace   → 空行时删除该行
 *   ↑ / ↓       → 在行之间上下移动光标
 *   点击圆圈     → 切换完成状态（附带庆祝特效）
 *   点击优先级点  → 循环切换 低→中→高
 *   拖拽把手     → 拖动整个任务块重新排序
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { tracker } from '../services/tracker'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, arrayMove, useSortable,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import type { DailyMoodRecord, Task, Subtask } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { triggerEffect } from '../effects'
import MiniCalendar from './MiniCalendar'
import CarryOverBanner from './CarryOverBanner'
import type { CarryOverGroup } from './CarryOverBanner'

// ===================== 类型 =====================

interface NoteEditorProps {
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  onFocusTask: (id: string) => void
  onResumePaused: (taskId: string) => void
  /** hover ▶ 按钮时预加载 AI 建议（可选） */
  onPrefetchTask?: (taskId: string) => void
  /** 创建新任务并立即开始专注（底部输入框 ▶ 按钮） */
  onCreateAndFocus?: (title: string) => void
  /** 可搬迁的任务分组（显示在任务列表底部） */
  carryOverGroups?: CarryOverGroup[]
  /** 确认搬迁（传入 { fromDate → taskIds[] } 映射） */
  onCarryOver?: (dateTaskMap: Record<string, string[]>) => void
  /** 忽略搬迁 */
  onDismissCarryOver?: () => void
  /** 是否是今天（历史日期时隐藏新建输入框和专注按钮） */
  isToday?: boolean
  /** 当前显示的日期（YYYY-MM-DD），用于日期区域显示 */
  currentDate?: string
  /** 切换到前一天 */
  onPrevDate?: () => void
  /** 切换到后一天 */
  onNextDate?: () => void
  /** 跳回今天 */
  onGoToday?: () => void
  /** 跳转到指定日期（YYYY-MM-DD） */
  onJumpToDate?: (date: string) => void
}

/** 扁平化的"行"，用于键盘导航和聚焦管理 */
interface FlatLine {
  id: string
  type: 'task' | 'subtask'
  taskIndex: number       // 在 tasks[] 中的位置
  subtaskIndex?: number   // 在 task.subtasks[] 中的位置
}

// ===================== 工具函数 =====================

/** 把嵌套的 tasks 展平为一维行列表，方便 ↑↓ 键导航 */
function flattenTasks(tasks: Task[]): FlatLine[] {
  const lines: FlatLine[] = []
  tasks.forEach((task, ti) => {
    lines.push({ id: task.id, type: 'task', taskIndex: ti })
    ;(task.subtasks ?? []).forEach((sub, si) => {
      lines.push({ id: sub.id, type: 'subtask', taskIndex: ti, subtaskIndex: si })
    })
  })
  return lines
}

/** 生成唯一 ID */
const uid = (prefix = 't') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

// ===================== 日期 & 心情记录 =====================

type MoodValue = DailyMoodRecord['mood']

/** 获取日期的友好显示，如 "3月8日 · 周日" */
function getDateLabel(dateStr?: string): string {
  const now = dateStr ? new Date(dateStr + 'T00:00:00') : new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${month}月${day}日 · ${weekNames[now.getDay()]}`
}

function getTodayDateStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const MOOD_OPTIONS: Array<{ value: MoodValue; label: string; emoji: string }> = [
  { value: 1, label: '很低落', emoji: '😢' },
  { value: 2, label: '低落', emoji: '😔' },
  { value: 3, label: '平静', emoji: '😐' },
  { value: 4, label: '开心', emoji: '🙂' },
  { value: 5, label: '很开心', emoji: '😄' },
]

function parseMoodRecord(value: unknown): DailyMoodRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const mood = Number(record.mood)
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) return null
  return {
    date: String(record.date || ''),
    mood: mood as MoodValue,
    note: String(record.note || ''),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
  }
}

// ===================== 主组件 =====================

export default function NoteEditor({
  tasks, setTasks, onFocusTask, onResumePaused, onPrefetchTask, onCreateAndFocus,
  carryOverGroups, onCarryOver, onDismissCarryOver,
  isToday = true, currentDate, onPrevDate, onNextDate, onGoToday, onJumpToDate,
}: NoteEditorProps) {
  const editedTaskIdsRef = useRef<Set<string>>(new Set())

  // 底部"新行"输入框文本
  const [newLineText, setNewLineText] = useState('')
  // 新行是否处于"子任务缩进"模式（先按 Tab 再打字）
  const [newLineIndented, setNewLineIndented] = useState(false)
  // 下次渲染后需要聚焦的行 ID
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  // 底部输入框是否聚焦（用于显示/隐藏快捷键提示）
  const [newLineFocused, setNewLineFocused] = useState(false)
  // 日历弹窗是否打开
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarRef = useRef<HTMLDivElement>(null)
  // 今日心情记录弹窗
  const [moodOpen, setMoodOpen] = useState(false)
  const [moodRecord, setMoodRecord] = useState<DailyMoodRecord | null>(null)
  const [draftMood, setDraftMood] = useState<MoodValue | null>(null)
  const [draftMoodNote, setDraftMoodNote] = useState('')
  const [savingMood, setSavingMood] = useState(false)
  const [moodClearedHint, setMoodClearedHint] = useState(false)
  const moodPanelRef = useRef<HTMLDivElement>(null)

  // 存储每一行 <input> 的 ref，键是行 ID
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const newLineRef = useRef<HTMLInputElement>(null)

  // 把嵌套的 Task[] 展平为一维行列表
  const lines = useMemo(() => flattenTasks(tasks), [tasks])
  const moodDate = currentDate || getTodayDateStr()
  const selectedMoodOption = moodRecord ? MOOD_OPTIONS.find(option => option.value === moodRecord.mood) : null

  useEffect(() => {
    let cancelled = false
    if (!isToday) {
      setMoodOpen(false)
      setMoodRecord(null)
      setDraftMood(null)
      setDraftMoodNote('')
      return
    }

    window.electronAPI.loadMoodRecord(moodDate)
      .then((record) => {
        if (cancelled) return
        const parsed = parseMoodRecord(record)
        setMoodRecord(parsed)
        setDraftMood(parsed?.mood ?? null)
        setDraftMoodNote(parsed?.note ?? '')
      })
      .catch((error) => {
        console.warn('[Mood] 加载心情记录失败:', error)
      })

    return () => { cancelled = true }
  }, [isToday, moodDate])

  useEffect(() => {
    if (!moodOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && moodPanelRef.current && !moodPanelRef.current.contains(target)) {
        setMoodOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [moodOpen])

  // ---- 聚焦管理：当 pendingFocusId 变化时，把光标移到对应输入框 ----
  useEffect(() => {
    if (!pendingFocusId) return
    // 用 requestAnimationFrame 确保 DOM 更新完成
    requestAnimationFrame(() => {
      if (pendingFocusId === '__new_line__') {
        newLineRef.current?.focus()
      } else {
        const el = inputRefs.current.get(pendingFocusId)
        if (el) {
          el.focus()
          el.selectionStart = el.selectionEnd = el.value.length
        }
      }
      setPendingFocusId(null)
    })
  }, [pendingFocusId])

  const handleSaveMood = useCallback(async () => {
    if (!draftMood || savingMood) return
    const record: DailyMoodRecord = {
      date: moodDate,
      mood: draftMood,
      note: draftMoodNote.trim(),
      updatedAt: Date.now(),
    }

    setSavingMood(true)
    try {
      const ok = await window.electronAPI.saveMoodRecord(record)
      if (ok) {
        setMoodRecord(record)
        setMoodOpen(false)
      }
    } catch (error) {
      console.warn('[Mood] 保存心情记录失败:', error)
    } finally {
      setSavingMood(false)
    }
  }, [draftMood, draftMoodNote, moodDate, savingMood])

  const handleDeleteMood = useCallback(async (event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation()
    if (!moodRecord || savingMood) return
    setSavingMood(true)
    try {
      const ok = await window.electronAPI.deleteMoodRecord(moodDate)
      if (ok) {
        setMoodRecord(null)
        setDraftMood(null)
        setDraftMoodNote('')
        setMoodOpen(false)
        setMoodClearedHint(true)
        setTimeout(() => setMoodClearedHint(false), 1000)
      }
    } catch (error) {
      console.warn('[Mood] 清除心情记录失败:', error)
    } finally {
      setSavingMood(false)
    }
  }, [moodDate, moodRecord, savingMood])

  // ===================== 数据变更 =====================

  /** 更新某行文字 */
  const updateText = useCallback((line: FlatLine, text: string) => {
    if (line.type === 'task') {
      const task = tasks[line.taskIndex]
      if (task && !editedTaskIdsRef.current.has(task.id)) {
        editedTaskIdsRef.current.add(task.id)
        tracker.track('task.edited', { taskId: task.id, field: 'title' })
      }
    }
    setTasks(prev => {
      const next = [...prev]
      if (line.type === 'task') {
        next[line.taskIndex] = { ...next[line.taskIndex], title: text }
      } else {
        const t = { ...next[line.taskIndex] }
        const subs = [...(t.subtasks ?? [])]
        const si = line.subtaskIndex ?? 0
        subs[si] = { ...subs[si], title: text }
        t.subtasks = subs
        next[line.taskIndex] = t
      }
      return next
    })
  }, [setTasks, tasks])

  /** 切换勾选状态（父任务 / 子任务通用） */
  const toggleLine = useCallback((line: FlatLine) => {
    if (line.type === 'task') {
      const task = tasks[line.taskIndex]
      if (task) tracker.track('task.toggled', { taskId: task.id, completed: !task.completed })
    }
    setTasks(prev => prev.map((t, i) => {
      if (i !== line.taskIndex) return t
      if (line.type === 'task') {
        const nowDone = !t.completed
        // 取消勾选父任务时，同步重置所有子任务
        if (!nowDone && t.subtasks?.length) {
          return { ...t, completed: false, subtasks: t.subtasks.map(s => ({ ...s, completed: false })) }
        }
        return { ...t, completed: nowDone }
      }
      // 子任务勾选
      const sub = (t.subtasks ?? [])[line.subtaskIndex ?? 0]
      if (sub) {
        tracker.track('task.subtask_toggled', {
          taskId: t.id, subtaskId: sub.id, subtaskTitle: sub.title, completed: !sub.completed,
        })
      }
      const subs = (t.subtasks ?? []).map((s, si) =>
        si === line.subtaskIndex ? { ...s, completed: !s.completed } : s
      )
      const allDone = subs.length > 0 && subs.every(s => s.completed)
      return { ...t, subtasks: subs, completed: allDone ? true : t.completed }
    }))
  }, [setTasks])

  /** 在列表末尾添加新任务 */
  const addTaskAtEnd = useCallback((title: string) => {
    const newId = uid('t')
    tracker.track('task.created', { taskId: newId, title, source: 'editor' })
    setTasks(prev => [...prev, {
      id: newId, title, note: '', priority: 'medium', completed: false, createdAt: Date.now(),
    }])
  }, [setTasks])

  /**
   * 把文字作为「最后一条未完成任务」的子任务添加。
   * 之所以要找"未完成"而不是数组末尾：拖拽规范化会把已完成任务排到数组末尾，
   * 直接取末尾会让子任务挂到已完成任务下，与用户直觉不符。
   * 返回 true 表示挂载成功，false 表示找不到合适父任务（应回退为创建独立任务）。
   */
  const addSubtaskToLast = useCallback((title: string): boolean => {
    let targetIdx = -1
    for (let i = tasks.length - 1; i >= 0; i--) {
      if (!tasks[i].completed) { targetIdx = i; break }
    }
    if (targetIdx === -1) return false
    tracker.track('task.subtask_created', { taskId: tasks[targetIdx].id, subtaskTitle: title })
    setTasks(prev => {
      let idx = -1
      for (let i = prev.length - 1; i >= 0; i--) {
        if (!prev[i].completed) { idx = i; break }
      }
      if (idx === -1) return prev
      const next = [...prev]
      const parent = { ...next[idx] }
      parent.subtasks = [...(parent.subtasks ?? []), { id: uid('s'), title, completed: false }]
      next[idx] = parent
      return next
    })
    return true
  }, [setTasks, tasks])

  /** 删除一行，返回应该聚焦的前一行 ID（或 null 表示聚焦底部新行） */
  const deleteLine = useCallback((line: FlatLine): string | null => {
    const lineIdx = lines.findIndex(l => l.id === line.id)
    const prevLineId = lineIdx > 0 ? lines[lineIdx - 1].id : null

    if (line.type === 'task') {
      const task = tasks[line.taskIndex]
      if (task) tracker.track('task.deleted', { taskId: task.id })
      setTasks(prev => prev.filter((_, i) => i !== line.taskIndex))
    } else {
      const task = tasks[line.taskIndex]
      const sub = (task?.subtasks ?? [])[line.subtaskIndex ?? 0]
      if (task && sub) {
        tracker.track('task.subtask_deleted', {
          taskId: task.id, subtaskId: sub.id, subtaskTitle: sub.title,
        })
      }
      setTasks(prev => {
        const next = [...prev]
        const t = { ...next[line.taskIndex] }
        const subs = (t.subtasks ?? []).filter((_, si) => si !== line.subtaskIndex)
        t.subtasks = subs.length > 0 ? subs : undefined
        next[line.taskIndex] = t
        return next
      })
    }
    return prevLineId
  }, [lines, setTasks, tasks])

  /** 删除一个空子任务（用于 Enter 空子任务 → 升级为新任务） */
  const deleteSubtaskRaw = useCallback((taskIndex: number, subtaskIndex: number) => {
    const task = tasks[taskIndex]
    const sub = (task?.subtasks ?? [])[subtaskIndex]
    if (task && sub) {
      tracker.track('task.subtask_deleted', {
        taskId: task.id, subtaskId: sub.id, subtaskTitle: sub.title,
      })
    }
    setTasks(prev => {
      const next = [...prev]
      const t = { ...next[taskIndex] }
      const subs = (t.subtasks ?? []).filter((_, si) => si !== subtaskIndex)
      t.subtasks = subs.length > 0 ? subs : undefined
      next[taskIndex] = t
      return next
    })
  }, [setTasks])

  /** Tab: 把一个独立任务变成上面那个任务的子任务 */
  const convertToSubtask = useCallback((line: FlatLine): string | null => {
    if (line.type !== 'task' || line.taskIndex === 0) return null
    const task = tasks[line.taskIndex]
    if ((task.subtasks ?? []).length > 0) return null

    const parentTask = tasks[line.taskIndex - 1]
    if (parentTask) {
      tracker.track('task.subtask_created', { taskId: parentTask.id, subtaskTitle: task.title })
    }

    setTasks(prev => {
      const next = prev.filter((_, i) => i !== line.taskIndex)
      const parentIdx = line.taskIndex - 1
      const parent = { ...next[parentIdx] }
      parent.subtasks = [
        ...(parent.subtasks ?? []),
        { id: task.id, title: task.title, completed: task.completed },
      ]
      next[parentIdx] = parent
      return next
    })
    return task.id // ID 不变，聚焦同一个元素
  }, [tasks, setTasks])

  /** Shift+Tab: 把子任务提升为独立任务 */
  const convertToTask = useCallback((line: FlatLine): string | null => {
    if (line.type !== 'subtask') return null
    const task = tasks[line.taskIndex]
    const sub = (task.subtasks ?? [])[line.subtaskIndex ?? 0]
    if (!sub) return null

    setTasks(prev => {
      const next = [...prev]
      // 从父任务中移除
      const parent = { ...next[line.taskIndex] }
      const subs = (parent.subtasks ?? []).filter((_, si) => si !== line.subtaskIndex)
      parent.subtasks = subs.length > 0 ? subs : undefined
      next[line.taskIndex] = parent
      // 插入为独立任务（位于父任务之后）
      next.splice(line.taskIndex + 1, 0, {
        id: sub.id, title: sub.title, note: '',
        priority: task.priority, completed: sub.completed, createdAt: Date.now(),
      })
      return next
    })
    return sub.id
  }, [tasks, setTasks])

  /** 切换优先级：低→中→高→低 */
  const cyclePriority = useCallback((taskIndex: number) => {
    const order: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']
    const task = tasks[taskIndex]
    if (task) {
      const from = task.priority
      const to = order[(order.indexOf(from) + 1) % order.length]
      tracker.track('task.priority_changed', { taskId: task.id, from, to })
    }
    setTasks(prev => {
      const next = [...prev]
      const t = { ...next[taskIndex] }
      t.priority = order[(order.indexOf(t.priority) + 1) % order.length]
      next[taskIndex] = t
      return next
    })
  }, [setTasks, tasks])

  // ===================== 键盘事件 =====================

  const handleLineKeyDown = useCallback((e: React.KeyboardEvent, line: FlatLine) => {
    const input = e.currentTarget as HTMLInputElement
    const lineIdx = lines.findIndex(l => l.id === line.id)

    // ----- Enter：跳到底部输入框（不创建空任务） -----
    if (e.key === 'Enter') {
      e.preventDefault()
      if (line.type === 'subtask' && input.value === '') {
        // 空子任务按 Enter → 删除空子任务，跳到底部输入
        deleteSubtaskRaw(line.taskIndex, line.subtaskIndex ?? 0)
      }
      // 所有情况都跳到底部新行输入框
      setPendingFocusId('__new_line__')
      return
    }

    // ----- Tab：缩进 -----
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      if (line.type === 'task') {
        const focusId = convertToSubtask(line)
        if (focusId) setPendingFocusId(focusId)
      }
      return
    }

    // ----- Shift+Tab：取消缩进 -----
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      if (line.type === 'subtask') {
        const focusId = convertToTask(line)
        if (focusId) setPendingFocusId(focusId)
      }
      return
    }

    // ----- Backspace 空行：删除 -----
    if (e.key === 'Backspace' && input.value === '') {
      e.preventDefault()
      // 有子任务的空任务不允许通过 Backspace 删除
      if (line.type === 'task' && (tasks[line.taskIndex]?.subtasks ?? []).length > 0) return
      const focusId = deleteLine(line)
      if (focusId) setPendingFocusId(focusId)
      else setPendingFocusId('__new_line__')
      return
    }

    // ----- 上下键导航 -----
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (lineIdx > 0) setPendingFocusId(lines[lineIdx - 1].id)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (lineIdx < lines.length - 1) setPendingFocusId(lines[lineIdx + 1].id)
      else setPendingFocusId('__new_line__')
      return
    }
  }, [lines, tasks, deleteSubtaskRaw,
      convertToSubtask, convertToTask, deleteLine])

  /** 底部新行输入框键盘事件 */
  const handleNewLineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (newLineText.trim()) {
        if (newLineIndented && tasks.length > 0) {
          const ok = addSubtaskToLast(newLineText.trim())
          if (!ok) {
            addTaskAtEnd(newLineText.trim())
            setNewLineIndented(false)
          }
        } else {
          addTaskAtEnd(newLineText.trim())
        }
        setNewLineText('')
      } else if (newLineIndented) {
        // 空行 + 子任务模式 → 取消缩进，变为新任务模式（类似"连按两次 Enter"）
        setNewLineIndented(false)
      }
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      // 至少要有一条"未完成"任务才允许进入缩进模式：
      // 否则按下 Tab 后没有合适的父任务，新文字会被回退创建为独立任务，缩进态没有意义。
      if (tasks.some(t => !t.completed)) {
        setNewLineIndented(true)
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      // 取消缩进
      setNewLineIndented(false)
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (lines.length > 0) setPendingFocusId(lines[lines.length - 1].id)
    }
    if (e.key === 'Backspace' && newLineText === '') {
      e.preventDefault()
      if (newLineIndented) {
        // 先取消缩进
        setNewLineIndented(false)
      } else if (lines.length > 0) {
        setPendingFocusId(lines[lines.length - 1].id)
      }
    }
  }

  // ===================== 拖拽排序 =====================

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )
  // 把任务分为 未完成 / 已完成 两组（拖拽只发生在未完成任务之间）
  const pendingTasks = tasks.filter(t => !t.completed)
  const completedTasks = tasks.filter(t => t.completed)
  const pendingIds = pendingTasks.map(t => t.id)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const pending = tasks.filter(t => !t.completed)
    const oldIdx = pending.findIndex(t => t.id === active.id)
    const newIdx = pending.findIndex(t => t.id === over.id)
    if (oldIdx !== -1 && newIdx !== -1) {
      tracker.track('task.reordered', { taskId: String(active.id), fromIndex: oldIdx, toIndex: newIdx })
    }
    setTasks(prev => {
      const p = prev.filter(t => !t.completed)
      const completed = prev.filter(t => t.completed)
      const oi = p.findIndex(t => t.id === active.id)
      const ni = p.findIndex(t => t.id === over.id)
      if (oi === -1 || ni === -1) return prev
      return [...arrayMove(p, oi, ni), ...completed]
    })
  }

  // ===================== 渲染 =====================

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={pendingIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-3">
            {/* 日期行 + 时段问候语 + 左右切换 + 日历弹窗 */}
            <div className="text-center select-none pt-2 pb-2 relative">
              <div className="flex items-center justify-center gap-1">
                {/* ◀ 前一天 */}
                {onPrevDate && (
                  <button
                    onClick={onPrevDate}
                    className="w-6 h-6 rounded-full flex items-center justify-center
                               text-gray-300 hover:text-indigo-500 hover:bg-indigo-50
                               transition-all"
                    title="前一天"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                {/* 日期文字（点击弹出日历） */}
                <button
                  onClick={() => setCalendarOpen(v => !v)}
                  className={`text-s font-semibold tracking-wide px-2 py-0.5 rounded-lg
                              transition-all hover:bg-indigo-50 active:scale-95 ${
                    isToday ? 'text-gray-600' : 'text-indigo-500'
                  }`}
                  title="点击选择日期"
                >
                  {getDateLabel(currentDate)}
                  <svg className={`inline-block w-3 h-3 ml-1 transition-transform ${calendarOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* ▶ 后一天 */}
                {onNextDate && (
                  <button
                    onClick={onNextDate}
                    className="w-6 h-6 rounded-full flex items-center justify-center
                               text-gray-300 hover:text-indigo-500 hover:bg-indigo-50
                               transition-all"
                    title="后一天"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>

              {/* 日历弹窗 */}
              {calendarOpen && (
                <MiniCalendar
                  ref={calendarRef}
                  selectedDate={currentDate || new Date().toISOString().slice(0, 10)}
                  onSelect={(date) => {
                    if (onJumpToDate) onJumpToDate(date)
                    setCalendarOpen(false)
                  }}
                  onClose={() => setCalendarOpen(false)}
                />
              )}

              {/* 今日心情入口 / 历史日期提示 */}
              <div className="mt-2 flex items-center justify-center gap-2">
                {isToday ? (
                  <div ref={moodPanelRef} className="relative">
                    <button
                      onClick={() => {
                        setDraftMood(moodRecord?.mood ?? null)
                        setDraftMoodNote(moodRecord?.note ?? '')
                        setMoodClearedHint(false)
                        setMoodOpen(v => !v)
                      }}
                      className={`no-drag group inline-flex items-center rounded-full px-2.5 py-1 text-xs transition-all ${
                        selectedMoodOption
                          ? 'bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-500'
                          : 'bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-500'
                      }`}
                    >
                      {moodClearedHint ? (
                        '已清除'
                      ) : selectedMoodOption ? (
                        <>
                          <span className="mr-1.5">{selectedMoodOption.emoji}</span>
                          <span>{selectedMoodOption.label}</span>
                        </>
                      ) : (
                        <>
                          <span className="mr-1.5 text-indigo-300">＋</span>
                          <span>今天心情怎么样？</span>
                        </>
                      )}
                      {selectedMoodOption && !moodClearedHint && (
                        <span
                          onClick={handleDeleteMood}
                          className="ml-0 flex h-4 w-0 items-center justify-center overflow-hidden rounded-full text-gray-300 opacity-0 transition-all duration-150 hover:bg-white/80 hover:text-gray-500 group-hover:ml-1 group-hover:w-4 group-hover:opacity-100"
                          title="清除心情记录"
                        >
                          ×
                        </span>
                      )}
                    </button>

                    {moodOpen && (
                      <div className="no-drag absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 rounded-2xl border border-gray-100 bg-white/95 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.12)] backdrop-blur">
                        <p className="text-sm font-semibold text-gray-800 text-center">今天心情怎么样？</p>
                        <div className="mt-3 grid grid-cols-5 gap-1.5">
                          {MOOD_OPTIONS.map(option => {
                            const selected = draftMood === option.value
                            return (
                              <button
                                key={option.value}
                                onClick={() => setDraftMood(option.value)}
                                className={`no-drag flex flex-col items-center gap-1 rounded-xl px-1.5 py-2 transition-all ${
                                  selected
                                    ? 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200 scale-105'
                                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                                }`}
                                title={option.label}
                              >
                                <span className="text-xl leading-none">{option.emoji}</span>
                                <span className="text-2xs whitespace-nowrap">{option.label}</span>
                              </button>
                            )
                          })}
                        </div>

                        <textarea
                          value={draftMoodNote}
                          onChange={(e) => setDraftMoodNote(e.target.value)}
                          placeholder="（可选）发生了什么？可以简单记一两句"
                          maxLength={240}
                          className="mt-3 h-20 w-full resize-none rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-200 focus:bg-white"
                        />

                        <div className="mt-3 flex items-center justify-between gap-2">
                          {moodRecord ? (
                            <button
                              onClick={handleDeleteMood}
                              className="no-drag rounded-full px-2 py-1.5 text-xs text-gray-400 transition-colors hover:text-red-400"
                            >
                              清除记录
                            </button>
                          ) : <span />}
                          <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setMoodOpen(false)}
                            className="no-drag rounded-full px-3 py-1.5 text-xs text-gray-400 transition-colors hover:text-gray-600"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveMood}
                            disabled={!draftMood || savingMood}
                            className="no-drag rounded-full bg-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-all hover:bg-indigo-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                          >
                            {savingMood ? '保存中' : moodRecord ? '保存修改' : '保存'}
                          </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={onGoToday}
                    className="text-xs text-indigo-400 hover:text-indigo-600 transition-colors"
                  >
                    ← 回到今天
                  </button>
                )}
              </div>
            </div>

            {/* ===== 搬迁轻提示（固定在问候语下方、任务列表上方）===== */}
            {isToday && carryOverGroups && carryOverGroups.length > 0 && onCarryOver && onDismissCarryOver && (
              <CarryOverBanner
                groups={carryOverGroups}
                onCarryOver={onCarryOver}
                onDismiss={onDismissCarryOver}
              />
            )}

            {/* ===== 未完成任务（可拖拽排序）===== */}
            {pendingTasks.map((task) => {
              const taskIndex = tasks.findIndex(t => t.id === task.id)
              return (
                <TaskBlock
                  key={task.id}
                  task={task}
                  taskIndex={taskIndex}
                  lines={lines}
                  inputRefs={inputRefs}
                  onTextChange={updateText}
                  onKeyDown={handleLineKeyDown}
                  onToggle={toggleLine}
                  onCyclePriority={() => cyclePriority(taskIndex)}
                  onFocusTask={onFocusTask}
                  onPrefetchTask={onPrefetchTask}
                  onDeleteLine={(line) => {
                    const focusId = deleteLine(line)
                    if (focusId) setPendingFocusId(focusId)
                    else setPendingFocusId('__new_line__')
                  }}
                  onResumePaused={onResumePaused}
                  isToday={isToday}
                />
              )
            })}

            {/* ===== 新行输入（空状态时紧跟问候语） ===== */}
            {(
              <div className={`${tasks.length > 0 ? 'mt-4' : 'mt-1'} transition-all ${
                newLineIndented ? 'ml-[74px]' : 'ml-[52px]'
              }`}>
                <div className="flex items-center py-[5px] gap-2">
                  <input
                    ref={newLineRef}
                    type="text"
                    value={newLineText}
                    onChange={(e) => setNewLineText(e.target.value)}
                    onKeyDown={handleNewLineKeyDown}
                    onFocus={() => setNewLineFocused(true)}
                    onBlur={() => {
                      setNewLineFocused(false)
                      // ★ 自动保存：失焦时如果有文字，自动创建任务
                      //   避免用户忘按 Enter 导致输入内容丢失
                      const trimmed = newLineText.trim()
                      if (trimmed) {
                        if (newLineIndented && tasks.length > 0) {
                          const ok = addSubtaskToLast(trimmed)
                          if (!ok) {
                            addTaskAtEnd(trimmed)
                            setNewLineIndented(false)
                          }
                        } else {
                          addTaskAtEnd(trimmed)
                        }
                        setNewLineText('')
                      }
                    }}
                    placeholder={
                      tasks.length === 0
                        ? '输入第一个任务…'
                        : newLineIndented
                          ? '子任务…'
                          : '新任务…'
                    }
                    className={`flex-1 bg-transparent outline-none placeholder-gray-300/70 ${
                      newLineIndented
                        ? 'text-s text-gray-600'
                        : 'text-md font-medium text-gray-800'
                    }`}
                  />
                  {/* ★ ▶ 一键开始按钮：输入文字后出现，仅今天显示，点击 = 创建任务 + 立即进入专注 */}
                  {isToday && !newLineIndented && newLineText.trim() && onCreateAndFocus && (
                    <>
                      <button
                        onMouseDown={(e) => e.preventDefault()}  /* 阻止输入框失焦，避免 onBlur 重复创建 */
                        onClick={() => {
                          const trimmed = newLineText.trim()
                          if (trimmed) {
                            onCreateAndFocus(trimmed)
                            setNewLineText('')
                            setNewLineIndented(false)
                          }
                        }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center
                                   bg-emerald-50 text-emerald-500 border border-emerald-200
                                   hover:bg-emerald-500 hover:text-white hover:border-emerald-500
                                   hover:shadow-sm hover:shadow-emerald-200/50
                                   active:scale-90 transition-all flex-shrink-0"
                        title="创建并立即专注"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                      {/* 占位：与 LineRow 中的删除按钮宽度一致，保证 ▶ 按钮水平对齐 */}
                      <div className="w-8 flex-shrink-0" />
                    </>
                  )}
                </div>
                {/* 快捷键提示：仅在聚焦且输入为空时显示 */}
                <div className={`overflow-hidden transition-all duration-200 ${
                  newLineFocused && !newLineText
                    ? 'max-h-6 opacity-100'
                    : 'max-h-0 opacity-0'
                }`}>
                  <p className="text-xxs text-gray-300 pl-7 pb-1">
                    {tasks.length === 0
                      ? 'Enter 添加'
                      : newLineIndented
                        ? 'Enter 添加 · 再按 Enter 退出子任务 · Shift+Tab 取消缩进'
                        : 'Enter 添加 · Tab 变子任务'
                    }
                  </p>
                </div>
              </div>
            )}

            {/* ===== 已完成任务（沉底，不可拖拽）===== */}
            {completedTasks.length > 0 && (
              <>
                {/* 分隔线 */}
                <div className="flex items-center gap-3 my-3 select-none">
                  <div className="flex-1 h-px bg-gray-200/70" />
                  <span className="text-xxs text-gray-300 whitespace-nowrap">
                    ✅ 已完成 {completedTasks.length} 项
                  </span>
                  <div className="flex-1 h-px bg-gray-200/70" />
                </div>

                {completedTasks.map((task) => {
                  const taskIndex = tasks.findIndex(t => t.id === task.id)
                  return (
                    <TaskBlock
                      key={task.id}
                      task={task}
                      taskIndex={taskIndex}
                      lines={lines}
                      inputRefs={inputRefs}
                      onTextChange={updateText}
                      onKeyDown={handleLineKeyDown}
                      onToggle={toggleLine}
                      onCyclePriority={() => cyclePriority(taskIndex)}
                      onFocusTask={onFocusTask}
                      onPrefetchTask={onPrefetchTask}
                      onDeleteLine={(line) => {
                        const focusId = deleteLine(line)
                        if (focusId) setPendingFocusId(focusId)
                        else setPendingFocusId('__new_line__')
                      }}
                      onResumePaused={onResumePaused}
                      isToday={isToday}
                    />
                  )
                })}
              </>
            )}

            {/* 底部留白 */}
            <div className="h-8" />
          </div>
        </div>
      </SortableContext>
    </DndContext>
  )
}

// ===================== TaskBlock：可拖拽的任务块 =====================

interface TaskBlockProps {
  task: Task
  taskIndex: number
  lines: FlatLine[]
  inputRefs: React.RefObject<Map<string, HTMLInputElement>>
  onTextChange: (line: FlatLine, text: string) => void
  onKeyDown: (e: React.KeyboardEvent, line: FlatLine) => void
  onToggle: (line: FlatLine) => void
  onCyclePriority: () => void
  onFocusTask: (id: string) => void
  onPrefetchTask?: (taskId: string) => void
  onDeleteLine: (line: FlatLine) => void
  onResumePaused: (taskId: string) => void
  /** 是否是今天（历史日期时隐藏专注和恢复按钮） */
  isToday?: boolean
}

function TaskBlock({
  task, taskIndex, lines, inputRefs,
  onTextChange, onKeyDown, onToggle, onCyclePriority, onFocusTask, onPrefetchTask, onDeleteLine, onResumePaused,
  isToday = true,
}: TaskBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const taskLine: FlatLine = { id: task.id, type: 'task', taskIndex }
  const subtaskLines: FlatLine[] = (task.subtasks ?? []).map((_, si) => ({
    id: (task.subtasks ?? [])[si].id,
    type: 'subtask' as const,
    taskIndex,
    subtaskIndex: si,
  }))

  const hasSubtasks = subtaskLines.length > 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      // ★ 整行 hover 预加载：鼠标进入任务行区域就触发，比只 hover ▶ 按钮更早
      onMouseEnter={!task.completed && onPrefetchTask ? () => onPrefetchTask(task.id) : undefined}
      className={`rounded-lg mb-2.5 transition-all ${
        isDragging
          ? 'opacity-40 scale-[1.02]'
          : task.completed
            ? 'opacity-60'
            : 'hover:bg-gray-50/80'
      }`}
    >
      {/* 父任务行 */}
      <LineRow
        line={taskLine}
        task={task}
        inputRefs={inputRefs}
        dragAttrs={attributes}
        dragListeners={listeners}
        onTextChange={onTextChange}
        onKeyDown={onKeyDown}
        onToggle={onToggle}
        onCyclePriority={onCyclePriority}
        onFocus={isToday && !task.completed ? () => onFocusTask(task.id) : undefined}
        onHoverFocus={isToday && !task.completed && onPrefetchTask ? () => onPrefetchTask(task.id) : undefined}
        onDelete={() => onDeleteLine(taskLine)}
      />
      {/* 备注 */}
      {task.note && (
        <div className="ml-[52px] -mt-1 mb-0.5 pb-1">
          <span className="text-xxs text-gray-400 italic leading-tight">{task.note}</span>
        </div>
      )}
      {/* 暂停态：点击恢复 */}
      {task.pausedSession && !task.completed && isToday && (
        <div className="ml-[52px] mb-1.5">
          <button
            onClick={() => onResumePaused(task.id)}
            className="group flex items-center gap-1 px-2 py-[3px] rounded-full
                       bg-blue-50 hover:bg-blue-500
                       active:scale-95 transition-all duration-200 cursor-pointer"
          >
            <svg className="w-3 h-3 text-blue-400 group-hover:text-white transition-colors" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
            <span className="text-xxs text-blue-500 group-hover:text-white transition-colors">继续</span>
          </button>
        </div>
      )}
      {/* 子任务区域 */}
      {hasSubtasks && (
        <div className="ml-[38px] pl-3.5 border-l-[1.5px] border-gray-200/80 mb-1">
          {subtaskLines.map(sl => (
            <LineRow
              key={sl.id}
              line={sl}
              task={task}
              inputRefs={inputRefs}
              onTextChange={onTextChange}
              onKeyDown={onKeyDown}
              onToggle={onToggle}
              onDelete={() => onDeleteLine(sl)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ===================== LineRow：单行 =====================

interface LineRowProps {
  line: FlatLine
  task: Task
  inputRefs: React.RefObject<Map<string, HTMLInputElement>>
  dragAttrs?: Record<string, unknown>
  dragListeners?: Record<string, unknown>
  onTextChange: (line: FlatLine, text: string) => void
  onKeyDown: (e: React.KeyboardEvent, line: FlatLine) => void
  onToggle: (line: FlatLine) => void
  onCyclePriority?: () => void
  onFocus?: () => void
  /** hover ▶ 按钮时预加载 AI 建议 */
  onHoverFocus?: () => void
  onDelete: () => void
}

function LineRow({
  line, task, inputRefs, dragAttrs, dragListeners,
  onTextChange, onKeyDown, onToggle, onCyclePriority, onFocus, onHoverFocus, onDelete,
}: LineRowProps) {
  const isSub = line.type === 'subtask'
  const sub = isSub ? (task.subtasks ?? [])[line.subtaskIndex ?? 0] : null
  const text = isSub ? (sub?.title ?? '') : task.title
  const completed = isSub ? (sub?.completed ?? false) : task.completed
  const dotColor = PRIORITY_CONFIG[task.priority].dot

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // 3 秒后自动取消删除确认
  useEffect(() => {
    if (!showDeleteConfirm) return
    const timer = setTimeout(() => setShowDeleteConfirm(false), 3000)
    return () => clearTimeout(timer)
  }, [showDeleteConfirm])

  return (
    <div className={`flex items-center gap-2 group rounded-md px-1 -mx-1 transition-colors ${
      isSub ? 'py-1.5' : 'py-2.5'
    }`}>

      {/* ---- 拖拽把手（仅父任务，hover 时显示） ---- */}
      {!isSub ? (
        <div
          {...dragAttrs}
          {...dragListeners}
          className="w-5 h-5 flex items-center justify-center cursor-grab active:cursor-grabbing
                     text-transparent group-hover:text-gray-300 transition-colors flex-shrink-0 touch-none"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="5" cy="4" r="1.2" /><circle cx="11" cy="4" r="1.2" />
            <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="12" r="1.2" /><circle cx="11" cy="12" r="1.2" />
          </svg>
        </div>
      ) : null}

      {/* ---- 勾选按钮：父任务圆圈先隐藏；子任务勾选保持不变 ---- */}
      {isSub ? (
        <button
          onClick={(e) => {
            onToggle(line)
            if (!completed) triggerEffect(e.currentTarget)
          }}
          className={`w-[14px] h-[14px] rounded-[3px] border-[1.5px] flex-shrink-0 flex items-center justify-center transition-all duration-200 ${
            completed
              ? 'bg-emerald-400 border-emerald-400 shadow-sm shadow-emerald-200'
              : 'border-gray-300 hover:border-indigo-400 hover:shadow-sm hover:shadow-indigo-100'
          }`}
        >
          {completed && (
            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      ) : (
        <div className="w-[18px] h-[18px] flex-shrink-0" aria-hidden="true" />
      )}

      {/* ---- 文本输入 ---- */}
      <input
        ref={(el) => {
          if (el) inputRefs.current.set(line.id, el)
          else inputRefs.current.delete(line.id)
        }}
        type="text"
        value={text}
        onChange={(e) => onTextChange(line, e.target.value)}
        onKeyDown={(e) => onKeyDown(e, line)}
        placeholder={isSub ? '子任务…' : '新任务…'}
        className={`flex-1 bg-transparent outline-none min-w-0 ${
          isSub
            ? 'text-s leading-snug'
            : 'text-md font-medium leading-snug'
        } ${
          completed
            ? 'line-through text-gray-400 decoration-gray-300'
            : isSub
              ? 'text-gray-500 placeholder-gray-300'
              : 'text-gray-800 placeholder-gray-300'
        }`}
      />

      {/* ---- 专注按钮（常驻显示，醒目入口；hover 时预加载 AI 建议） ---- */}
      {onFocus && (
        <button
          onClick={onFocus}
          onMouseEnter={onHoverFocus}
          className="w-7 h-7 rounded-lg flex items-center justify-center
                     bg-emerald-50 text-emerald-500 border border-emerald-200
                     hover:bg-emerald-500 hover:text-white hover:border-emerald-500
                     hover:shadow-sm hover:shadow-emerald-200/50
                     active:scale-90 transition-all flex-shrink-0"
          title="专注此任务"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}

      {/* ---- 删除按钮 ---- */}
      {showDeleteConfirm ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-2xs text-red-400 mr-0.5">确定?</span>
          <button
            onClick={onDelete}
            className="w-5 h-5 rounded-md bg-red-500 flex items-center justify-center text-white transition-colors hover:bg-red-600"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center text-gray-500 transition-colors hover:bg-gray-200"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            if (!text.trim() && (line.type !== 'task' || !(task.subtasks ?? []).length)) {
              onDelete()
            } else {
              setShowDeleteConfirm(true)
            }
          }}
          className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-lg flex items-center justify-center
                     text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
          title="删除"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

