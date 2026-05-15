/**
 * WeekView —— 周视图容器
 *
 * 加载「含今天在内的前 7 天」的 tracker 事件 + 活跃度数据，
 * 聚合后交给子图表组件渲染。
 *
 * 周范围 = 滚动窗口（不按自然周），weekEndDate 默认为今天。
 */

import { useState, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TrackEvent, DailySummary } from '../services/tracker'
import { buildDailySummary } from '../services/tracker'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { TaskDurationItem, StuckMark } from './TaskDurationChart'
import WeekCompletionBars, { getEffectiveMoodForWeekDayIndex, getMoodBarFillColor } from './WeekCompletionBars'
import WeekMetricCards from './WeekMetricCards'
import WeekTaskRanking from './WeekTaskRanking'
import WeekHeatmapGrid, { computeWeekActiveTimeRange } from './WeekHeatmapGrid'
import WeekRhythmChart from './WeekRhythmChart'
import AppUsageRanking from './AppUsageRanking'
import { tracker } from '../services/tracker'
import type { DailyMoodRecord } from '../types'
import { MOOD_LABELS, parseMoodRecord, type MoodValue } from '../utils/mood'

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
  /** 该天的心情记录，缺失时为 null */
  moodRecord: DailyMoodRecord | null
}

// ===================== 常量 =====================

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_SHORT = ['日', '一', '二', '三', '四', '五', '六']
const MOOD_SATURATION_PREVIEW_VALUES: readonly (MoodValue | null)[] = [1, 3, 5, null, 4, null, 2]
const MOOD_LINE_MISSING_PREVIEW_VALUES: readonly (MoodValue | null)[] = [5, 4, null, 2, null, 4, 5]

function ChartFocusSection({
  id,
  children,
}: {
  id: string
  children: ReactNode
}) {
  return (
    <div id={id} className="relative rounded-xl transition-[filter] duration-200">
      {children}
    </div>
  )
}

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

function WeekCompletionSection({
  days,
  barsOnly,
  colorMode,
  moodPreviewValues,
  lineMoodPreviewValues,
  lineMissingMoodMode,
  moodPointsOnly,
  hidePctLabels,
  moodAxisLabelMode,
  toggleMoodTrend = false,
  initialShowMoodTrend = false,
  missingMoodStyle,
  showMoodLegend,
  heading = '📊 每日任务完成率',
}: {
  days: WeekDayData[]
  /** 为 true 时与 WeekCompletionBars 的 barsOnly 一致，仅柱状图 */
  barsOnly?: boolean
  /** 柱子颜色模式，预览用来展示心情色阶 */
  colorMode?: 'single' | 'moodSaturation'
  /** 预览用模拟心情：null 表示未记录 */
  moodPreviewValues?: readonly (MoodValue | null)[]
  /** 折线预览用模拟心情：null 表示未记录 */
  lineMoodPreviewValues?: readonly (MoodValue | null)[]
  /** 折线遇到未记录心情时的处理方式 */
  lineMissingMoodMode?: 'fillDemo' | 'breakOnMissing' | 'carryForwardDotted'
  /** 为 true 时只展示心情点，不绘制点之间的连线 */
  moodPointsOnly?: boolean
  /** 为 true 时隐藏完成率数字标签，避免遮挡心情点 */
  hidePctLabels?: boolean
  /** 右侧心情轴标签样式 */
  moodAxisLabelMode?: 'numeric' | 'textOnly'
  /** 是否显示“显示/隐藏心情趋势”切换按钮 */
  toggleMoodTrend?: boolean
  /** 切换按钮模式下是否初始显示心情趋势 */
  initialShowMoodTrend?: boolean
  /** 未记录心情的视觉样式 */
  missingMoodStyle?: 'gray' | 'whiteDashed'
  /** 是否展示心情色阶图例 */
  showMoodLegend?: boolean
  /** 区块标题（默认同上） */
  heading?: ReactNode
}) {
  const [showMoodTrend, setShowMoodTrend] = useState(initialShowMoodTrend)
  const effectiveBarsOnly = toggleMoodTrend ? !showMoodTrend : barsOnly
  const effectiveHidePctLabels = toggleMoodTrend && showMoodTrend ? true : hidePctLabels
  const effectiveMoodAxisLabelMode = toggleMoodTrend ? 'textOnly' : moodAxisLabelMode
  const reserveMoodAxisSpace = toggleMoodTrend && showMoodTrend

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {heading}
          <span className="relative group">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] leading-none cursor-help group-hover:text-gray-600 group-hover:border-gray-400 transition-colors">?</span>
          <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-[240px] bg-gray-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2.5 shadow-lg normal-case tracking-normal font-normal">
            {barsOnly ? (
              <>
                <b>每日任务完成率</b> = 当天已完成的任务数 ÷ 当天全部任务数 × 100%。<br/><span className="text-gray-300">{colorMode === 'moodSaturation' ? '本区块为心情色阶预览：柱子颜色来自模拟心情记录，灰色表示当天未记录心情。' : '本区块为仅柱状图样式预览，不含心情折线与右侧刻度，方便你对比和改版。'}</span>
              </>
            ) : (
              <>
                <b>每日任务完成率</b> = 当天已完成的任务数 ÷ 当天全部任务数 × 100%。<br/><span className="text-gray-300">{moodPointsOnly ? '本区块为心情散点预览：只显示有心情记录日期的点，不绘制点之间的连线。' : lineMissingMoodMode === 'carryForwardDotted' ? '柱子表示完成率；折线表示 1–5 级心情。未记录心情的日期会用灰色空心点沿用前一天位置，并用虚线连接；如果前面没有真实记录，则不画占位点。' : lineMissingMoodMode === 'breakOnMissing' ? '本区块为折线缺失预览：未记录心情的日期不显示心情点，折线会在缺失日期前后断开。' : '柱子表示完成率；折线表示 1–5 级心情，真实记录优先，没有记录时用示例心情补齐。右侧 1 表示很低落，5 表示很开心。'}</span>
              </>
            )}
          </span>
          </span>
        </h3>
        {toggleMoodTrend ? (
          <MoodToggleButton
            active={showMoodTrend}
            onToggle={() => setShowMoodTrend(value => !value)}
            activeLabel="隐藏心情趋势"
            inactiveLabel="显示心情趋势"
          />
        ) : null}
      </div>
      <WeekCompletionBars
        days={days}
        barsOnly={effectiveBarsOnly}
        colorMode={colorMode}
        moodPreviewValues={moodPreviewValues}
        lineMoodPreviewValues={lineMoodPreviewValues}
        lineMissingMoodMode={lineMissingMoodMode}
        moodPointsOnly={moodPointsOnly}
        hidePctLabels={effectiveHidePctLabels}
        moodAxisLabelMode={effectiveMoodAxisLabelMode}
        reserveMoodAxisSpace={reserveMoodAxisSpace}
        missingMoodStyle={missingMoodStyle}
        showMoodLegend={showMoodLegend}
      />
    </>
  )
}

function MoodToggleButton({
  active,
  onToggle,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean
  onToggle: () => void
  activeLabel: string
  inactiveLabel: string
}) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none transition-colors ${active ? 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
      onClick={onToggle}
    >
      <span className={`text-base leading-none ${active ? 'text-indigo-400' : 'text-gray-300'}`} aria-hidden="true">
        {active ? '♥' : '♡'}
      </span>
      <span>{active ? activeLabel : inactiveLabel}</span>
    </button>
  )
}

function WeekMoodCompletionDemo({ days }: { days: WeekDayData[] }) {
  type Agg = { mood: number; completed: number; total: number; dayCount: number }

  const byMood = new Map<number, Agg>()
  days.forEach((day, i) => {
    const mood = getEffectiveMoodForWeekDayIndex(i, day.moodRecord?.mood)
    let row = byMood.get(mood)
    if (!row) {
      row = { mood, completed: 0, total: 0, dayCount: 0 }
      byMood.set(mood, row)
    }
    row.completed += day.summary.stats.completedMicroSteps
    row.total += day.summary.stats.totalMicroSteps
    row.dayCount += 1
  })

  const ranking = Array.from(byMood.values())
    .map(row => ({
      ...row,
      label: MOOD_LABELS.find(m => m.value === row.mood)?.label ?? `档位 ${row.mood}`,
      rate: row.total > 0 ? Math.round((row.completed / row.total) * 100) : 0,
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total)

  return (
    <div id="chart-week-mood-completion-demo" className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
          🌿 不同心情下的任务完成率
          <span className="relative group">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] leading-none cursor-help group-hover:text-gray-600 group-hover:border-gray-400 transition-colors">?</span>
            <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-[280px] bg-gray-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2.5 shadow-lg normal-case tracking-normal font-normal">
              按 5 档心情汇总本周每天的完成步数 ÷ 总步数。某天若未记心情，则用与上方柱状图相同的「从左到右示例档位」归入对应心情后再汇总。
            </span>
          </span>
        </h3>
      </div>

      <div className="space-y-2">
        {ranking.map(item => {
          const barWidthPct = Math.max(item.rate, item.rate > 0 ? 4 : 0)
          const fill = getMoodBarFillColor(item.mood)

          return (
            <div
              key={item.mood}
              className="group relative flex items-center gap-2"
            >
              <span className="flex w-[72px] flex-shrink-0 items-center gap-1.5" title={item.label}>
                <span
                  className="h-5 w-5 flex-shrink-0 rounded-full border border-black/10 shadow-inner"
                  style={{ backgroundColor: fill }}
                />
                <span className="truncate text-2xs text-gray-600">{item.label}</span>
              </span>
              <div className="h-[22px] flex-1 overflow-hidden rounded-lg bg-gray-100">
                <div
                  className="h-full rounded-lg transition-all duration-700 ease-out"
                  style={{ width: `${barWidthPct}%`, backgroundColor: fill }}
                />
              </div>
              <span className="w-9 flex-shrink-0 text-right font-mono text-xxs text-gray-500 tabular-nums">
                {item.rate}%
              </span>
              <span className="pointer-events-none absolute right-12 top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] leading-none text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                完成 {item.completed} 个 / 共 {item.total} 个 · 覆盖 {item.dayCount} 天
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===================== 主组件 =====================

export default function WeekView({ weekEndDate, onDataReady, chatOpen }: WeekViewProps) {
  const [weekData, setWeekData] = useState<WeekDayData[]>([])
  const [loading, setLoading] = useState(true)
  const [showActivityMood, setShowActivityMood] = useState(false)

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
            const [rawEvents, rawActivity, rawMood] = await Promise.all([
              window.electronAPI.loadTrackerEvents(date),
              window.electronAPI.loadActivityData(date),
              window.electronAPI.loadMoodRecord(date),
            ])
            return { date, rawEvents, rawActivity, rawMood }
          })
        )

        if (cancelled) return

        const days: WeekDayData[] = results.map(({ date, rawEvents, rawActivity, rawMood }) => {
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
            moodRecord: parseMoodRecord(rawMood),
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

  // 热力图与节奏曲线共享的动态时间范围（必须在所有早期 return 之前调用）
  const { rangeStart: weekRangeStart, rangeEnd: weekRangeEnd } = useMemo(
    () => computeWeekActiveTimeRange(weekData),
    [weekData],
  )

  // 有数据的天数
  const daysWithData = weekData.filter(d => d.hasData).length

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
    <div className="p-6 space-y-6 transition-all duration-400 max-w-xl mx-auto">
      {/* 每日完成率条形图 */}
      <ChartFocusSection id="chart-week-completion">
        <WeekCompletionSection
          days={weekData}
          toggleMoodTrend
          lineMissingMoodMode="carryForwardDotted"
        />
      </ChartFocusSection>

      {/* 周汇总指标卡片 */}
      <ChartFocusSection id="chart-week-metrics">
        <WeekMetricCards days={weekData} />
      </ChartFocusSection>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 周任务用时排行 Top 10 */}
      <ChartFocusSection id="chart-week-ranking">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          🏆 周任务用时排行
        </h3>
        <WeekTaskRanking days={weekData} />
      </ChartFocusSection>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 电脑活动分布（折线图 + 热力网格，共享 x 轴） */}
      <ChartFocusSection id="chart-week-heatmap">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
            🔍 电脑活动分布
            <span className="relative group">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] leading-none cursor-help group-hover:text-gray-600 group-hover:border-gray-400 transition-colors">?</span>
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-[280px] bg-gray-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2.5 shadow-lg normal-case tracking-normal font-normal">
                <b>每小时电脑活跃时长</b>（曲线）= 该小时内电脑被实际使用的分钟数（0~60分钟）。曲线越高，表示该时段使用电脑的时间越长。周视图中，面积为多天的活跃时长叠加。<br/><br/><b>每小时电脑活跃度</b>（色块）= 该小时内检测到的电脑使用时间 ÷ 1小时。颜色越深表示这个时段电脑使用越多。<br/><span className="text-gray-300 mt-1 inline-block">注：连续 1 分钟没有鼠标或键盘操作即视为不活跃。</span>
              </span>
            </span>
          </h3>
          <MoodToggleButton
            active={showActivityMood}
            onToggle={() => setShowActivityMood(value => !value)}
            activeLabel="隐藏心情"
            inactiveLabel="显示心情"
          />
        </div>
        <div id="chart-week-rhythm">
          <WeekRhythmChart days={weekData} rangeStart={weekRangeStart} rangeEnd={weekRangeEnd} />
        </div>
        <div className="mt-0">
          <WeekHeatmapGrid days={weekData} rangeStart={weekRangeStart} rangeEnd={weekRangeEnd} showMoodColumn={showActivityMood} />
        </div>
      </ChartFocusSection>

      {/* 分隔线 */}
      <div className="border-t border-gray-100" />

      {/* 应用使用时长排行（周聚合，默认 Top 5，可展开） */}
      <ChartFocusSection id="chart-week-app-usage">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          📱 应用使用时长（本周）
          <span className="relative group">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] leading-none cursor-help group-hover:text-gray-600 group-hover:border-gray-400 transition-colors">?</span>
            <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-[280px] bg-gray-800 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2.5 shadow-lg normal-case tracking-normal font-normal">
              本周 7 天累计的前台应用使用时长。仅在电脑处于活跃状态时统计，已自动排除 MetaPlan 自身、资源管理器、终端等非生产力应用。
            </span>
          </span>
        </h3>
        <AppUsageRanking data={weekData.flatMap((d) => d.activity)} />
      </ChartFocusSection>


    </div>
  )
}
