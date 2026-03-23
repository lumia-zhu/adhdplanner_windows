/**
 * WeekView —— 周视图容器
 *
 * 加载「含今天在内的前 7 天」的 tracker 事件 + 活跃度数据，
 * 聚合后交给子图表组件渲染。
 *
 * 周范围 = 滚动窗口（不按自然周），weekEndDate 默认为今天。
 */

import { useState, useEffect, useMemo } from 'react'
import type { TrackEvent, DailySummary } from '../services/tracker'
import { buildDailySummary } from '../services/tracker'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { TaskDurationItem, StuckMark } from './TaskDurationChart'
import WeekCompletionBars from './WeekCompletionBars'
import WeekMetricCards from './WeekMetricCards'
import WeekTaskRanking from './WeekTaskRanking'
import WeekHeatmapGrid from './WeekHeatmapGrid'
import WeekRhythmChart from './WeekRhythmChart'
import { tracker } from '../services/tracker'

// ===================== 类型 =====================

/** 周视图中每一天的数据包 */
export interface WeekDayData {
  date: string               // 'YYYY-MM-DD'
  weekday: string            // '周一' … '周日'
  weekdayShort: string       // '一' … '日'
  dateLabel: string           // 'M/d' 如 '3/19'
  dateFull: string            // '3月19日 周四'
  events: TrackEvent[]
  activity: ActivityRecord[]
  summary: DailySummary
  /** 该天的使用总时长（分钟） */
  totalUsageMinutes: number
  /** 该天是否有实际数据（events 或 activity 有记录） */
  hasData: boolean
  /** 该天的任务用时列表（带日期标签） */
  taskDurations: (TaskDurationItem & { date: string; weekday: string; dateLabel: string; dateFull: string })[]
}

// ===================== 常量 =====================

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六']

// ===================== 工具函数 =====================

/** 日期加减 n 天，返回 YYYY-MM-DD */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 获取含 endDate 在内的前 7 天日期数组（从旧到新） */
export function getWeekDates(endDate: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDate(endDate, -(6 - i)))
}

/** YYYY-MM-DD → 'M/d' */
function toShortLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** YYYY-MM-DD → '3月19日 周四' */
function toFullLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

/** YYYY-MM-DD → 周几 */
function toWeekday(dateStr: string): string {
  return WEEKDAYS[new Date(dateStr + 'T00:00:00').getDay()]
}

/** YYYY-MM-DD → 周几短（一个字） */
function toWeekdayShort(dateStr: string): string {
  return WEEKDAYS_SHORT[new Date(dateStr + 'T00:00:00').getDay()]
}

/** 从事件流构建任务用时列表（和 ReflectionView 中相同逻辑） */
function buildTaskDurationsFromEvents(
  events: TrackEvent[],
  date: string,
): (TaskDurationItem & { date: string; weekday: string; dateLabel: string; dateFull: string })[] {
  const durationMap = new Map<string, number>()
  const everTaskDone = new Set<string>()
  const macroCompleted = new Set<string>()
  const sessionStartMap = new Map<string, { timestamp: number; taskTitle: string }>()
  const sessionOrderByTask = new Map<string, { sessionId: string; durationSec: number }[]>()

  for (const e of events) {
    if (e.type === 'session.started') {
      const p = e.payload as { sessionId: string; taskTitle: string }
      sessionStartMap.set(p.sessionId, { timestamp: e.timestamp, taskTitle: p.taskTitle })
    }
    if (e.type === 'session.ended') {
      const p = e.payload as { sessionId: string; taskTitle: string; totalDurationSeconds: number; endReason: string }
      durationMap.set(p.taskTitle, (durationMap.get(p.taskTitle) || 0) + p.totalDurationSeconds)
      if (!sessionOrderByTask.has(p.taskTitle)) sessionOrderByTask.set(p.taskTitle, [])
      sessionOrderByTask.get(p.taskTitle)?.push({ sessionId: p.sessionId, durationSec: p.totalDurationSeconds })
      if (p.endReason === 'task_done') everTaskDone.add(p.taskTitle)
    }
    if (e.type === 'session.macro_completed') {
      const p = e.payload as { taskTitle: string }
      macroCompleted.add(p.taskTitle)
    }
  }

  // 收集卡顿标记
  const stuckMarksByTask = new Map<string, StuckMark[]>()
  for (const e of events) {
    if (e.type === 'stuck.triggered') {
      const p = e.payload as { sessionId: string; microAction: string; elapsedSeconds: number }
      const sessionInfo = sessionStartMap.get(p.sessionId)
      if (!sessionInfo) continue
      const taskTitle = sessionInfo.taskTitle
      const sessionsOfTask = sessionOrderByTask.get(taskTitle) || []
      let cumulativeBefore = 0
      for (const s of sessionsOfTask) {
        if (s.sessionId === p.sessionId) break
        cumulativeBefore += s.durationSec
      }
      const offsetSeconds = Math.round(cumulativeBefore + p.elapsedSeconds)

      let reason = ''
      for (const re of events) {
        if (re.type === 'stuck.reason') {
          const rp = re.payload as { sessionId: string; reason: string }
          if (rp.sessionId === p.sessionId && re.timestamp >= e.timestamp) {
            reason = rp.reason
            break
          }
        }
      }

      let resolved = false
      for (const re of events) {
        if (re.timestamp <= e.timestamp) continue
        const rp = re.payload as { sessionId?: string }
        if (rp.sessionId !== p.sessionId) continue
        if (['stuck.pivot_chosen', 'exec.micro_started', 'exec.micro_completed', 'exec.flow_entered'].includes(re.type)) {
          resolved = true
          break
        }
      }

      const mark: StuckMark = { offsetSeconds, microAction: p.microAction, reason, resolved }
      if (!stuckMarksByTask.has(taskTitle)) stuckMarksByTask.set(taskTitle, [])
      stuckMarksByTask.get(taskTitle)?.push(mark)
    }
  }

  const weekday = toWeekday(date)
  const dateLabel = toShortLabel(date)
  const dateFull = toFullLabel(date)

  return Array.from(durationMap.entries())
    .map(([title, sec]) => ({
      title,
      durationSec: Math.round(sec),
      durationMin: Math.round(sec / 60),
      completed: everTaskDone.has(title) || macroCompleted.has(title),
      stuckMarks: stuckMarksByTask.get(title) || [],
      date,
      weekday,
      dateLabel,
      dateFull,
    }))
    .filter(d => d.durationSec > 0)
    .sort((a, b) => b.durationSec - a.durationSec)
}

// ===================== Props =====================

interface WeekViewProps {
  weekEndDate: string    // 周范围的末日（默认今天）
  /** 数据加载完成后通知父组件（用于 AI 反思上下文构建） */
  onDataReady?: (data: WeekDayData[]) => void
  /** AI 聊天侧边栏是否展开（影响布局宽度） */
  chatOpen?: boolean
}

// ===================== 主组件 =====================

export default function WeekView({ weekEndDate, onDataReady, chatOpen }: WeekViewProps) {
  const [weekData, setWeekData] = useState<WeekDayData[]>([])
  const [loading, setLoading] = useState(true)

  // 计算 7 天日期
  const weekDates = useMemo(() => getWeekDates(weekEndDate), [weekEndDate])

  // 并行加载 7 天数据
  useEffect(() => {
    let cancelled = false
    async function loadWeek() {
      setLoading(true)
      try {
        // 如果今天在范围内，先 flush tracker
        const today = new Date().toISOString().slice(0, 10)
        if (weekDates.includes(today)) {
          await tracker.flushAsync()
        }

        const results = await Promise.all(
          weekDates.map(async (date) => {
            const [rawEvents, rawActivity] = await Promise.all([
              window.electronAPI.loadTrackerEvents(date),
              window.electronAPI.loadActivityData(date),
            ])
            return { date, rawEvents, rawActivity }
          })
        )

        if (cancelled) return

        const days: WeekDayData[] = results.map(({ date, rawEvents, rawActivity }) => {
          const events = rawEvents as TrackEvent[]
          const activity = rawActivity as ActivityRecord[]
          const summary = buildDailySummary(date, events)
          const totalUsageMinutes = Math.round(
            activity.reduce((sum, r) => sum + getActiveRatio(r) * 0.5, 0)
          )
          const taskDurations = buildTaskDurationsFromEvents(events, date)

          return {
            date,
            weekday: toWeekday(date),
            weekdayShort: toWeekdayShort(date),
            dateLabel: toShortLabel(date),
            dateFull: toFullLabel(date),
            events,
            activity,
            summary,
            totalUsageMinutes,
            hasData: events.length > 0 || activity.length > 0,
            taskDurations,
          }
        })

        setWeekData(days)
        onDataReady?.(days)
      } catch (e) {
        console.error('[WeekView] 加载周数据失败:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadWeek()
    return () => { cancelled = true }
  }, [weekDates]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 加载中 ----
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">正在加载周数据...</p>
        </div>
      </div>
    )
  }

  // 有数据的天数
  const daysWithData = weekData.filter(d => d.hasData).length

  // ---- 全部 7 天无数据 ----
  if (daysWithData === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-8">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-sm text-gray-500 font-medium mb-1">
            这一周暂无任何数据
          </p>
          <p className="text-xs text-gray-400">
            试试切换到其他周看看？
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`p-6 space-y-6 transition-all duration-400 ${
      chatOpen ? 'w-full' : 'max-w-xl mx-auto'
    }`}>
      {/* 每日完成率条形图 */}
      <div id="chart-week-completion">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          📊 每日任务完成率
        </h3>
        <WeekCompletionBars days={weekData} />
      </div>

      {/* 周汇总指标卡片 */}
      <div id="chart-week-metrics">
        <WeekMetricCards days={weekData} />
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 周任务用时排行 Top 10 */}
      <div id="chart-week-ranking">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          🏆 周任务用时排行
        </h3>
        <WeekTaskRanking days={weekData} />
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 7×24 活动分布热力网格 */}
      <div id="chart-week-heatmap">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          🔍 活动分布热力图
        </h3>
        <WeekHeatmapGrid days={weekData} />
      </div>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 周平均节奏曲线 */}
      <div id="chart-week-rhythm">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          📈 使用节奏曲线
        </h3>
        <WeekRhythmChart days={weekData} />
      </div>
    </div>
  )
}
