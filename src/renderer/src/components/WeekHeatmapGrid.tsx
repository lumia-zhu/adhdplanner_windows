/**
 * WeekHeatmapGrid —— 7×24 活动分布热力网格（周视图核心）
 *
 * 7 行（每天一行）× 24 列（每小时一格），颜色沿用日视图的 4 级配色。
 * 点击某行 → 展开该天的任务时间分布详情。
 * 顶部一句话洞察：统计"稳定高效时段"。
 */

import { useMemo, useState } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { TrackEvent } from '../services/tracker'
import type { WeekDayData } from './WeekView'

// ===================== 常量 =====================

const TOTAL_HOURS = 24
const EXPECTED_RECORDS_PER_HOUR = 120  // 每小时 120 条（每 30 秒一条）
const MIN_SPAN = 12
const DEFAULT_START = 7
const DEFAULT_END = 23

function ratioToLevel(usageRatio: number): number {
  if (usageRatio <= 0) return 0
  if (usageRatio <= 0.25) return 1
  if (usageRatio <= 0.50) return 2
  if (usageRatio <= 0.75) return 3
  return 4
}

const LEVEL_BG = [
  'bg-gray-100',        // 0: 未使用
  'bg-emerald-100',     // 1: < 25%
  'bg-emerald-300',     // 2: 25%~50%
  'bg-emerald-500',     // 3: 50%~75%
  'bg-emerald-700',     // 4: > 75%
]
const LEVEL_LABELS = ['未使用', '< 25%', '25%~50%', '50%~75%', '> 75%']

// ===================== 工具函数 =====================

/** 将一天的 ActivityRecord 聚合为 24 个 level */
function aggregateToHourlyLevels(data: ActivityRecord[]): number[] {
  const buckets: { totalRatio: number }[] = Array.from({ length: TOTAL_HOURS }, () => ({ totalRatio: 0 }))
  for (const r of data) {
    const h = new Date(r.ts).getHours()
    buckets[h].totalRatio += getActiveRatio(r)
  }
  return buckets.map(b => ratioToLevel(b.totalRatio / EXPECTED_RECORDS_PER_HOUR))
}

/** 从事件流提取任务→小时比例 */
function buildTaskHourRatioMap(events: TrackEvent[]): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>()
  const starts: { timestamp: number; taskTitle: string; sessionId: string }[] = []
  const ends: { timestamp: number; taskTitle: string; sessionId: string }[] = []

  for (const e of events) {
    if (e.type === 'session.started') {
      const p = e.payload as { sessionId: string; taskTitle: string }
      if (p.taskTitle) starts.push({ timestamp: e.timestamp, taskTitle: p.taskTitle, sessionId: p.sessionId })
    } else if (e.type === 'session.ended') {
      const p = e.payload as { sessionId: string; taskTitle: string }
      if (p.taskTitle) ends.push({ timestamp: e.timestamp, taskTitle: p.taskTitle, sessionId: p.sessionId })
    }
  }

  function addMinutes(title: string, hour: number, minutes: number) {
    if (!result.has(title)) result.set(title, new Map())
    const hourMap = result.get(title) ?? new Map()
    const cur = hourMap.get(hour) || 0
    hourMap.set(hour, Math.min(cur + minutes / 60, 1))
  }

  for (const start of starts) {
    const end = ends.find(e => e.sessionId === start.sessionId)
    const startTs = start.timestamp
    const endTs = end ? end.timestamp : Date.now()
    const title = end ? end.taskTitle : start.taskTitle
    if (!title) continue

    const startDate = new Date(startTs)
    const endDate = new Date(endTs)
    const startHour = startDate.getHours()
    const endHour = endDate.getHours()

    if (startHour === endHour) {
      addMinutes(title, startHour, (endTs - startTs) / 60000)
    } else {
      addMinutes(title, startHour, 60 - startDate.getMinutes() - startDate.getSeconds() / 60)
      if (startHour < endHour) {
        for (let h = startHour + 1; h < endHour; h++) addMinutes(title, h, 60)
      } else {
        for (let h = startHour + 1; h < 24; h++) addMinutes(title, h, 60)
        for (let h = 0; h < endHour; h++) addMinutes(title, h, 60)
      }
      const endMin = endDate.getMinutes() + endDate.getSeconds() / 60
      if (endMin > 0) addMinutes(title, endHour, endMin)
    }
  }
  return result
}

function fmtHour(h: number): string {
  return `${String(h % 24).padStart(2, '0')}:00`
}

function ratioToPercentStr(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

// ===================== Props =====================

interface Props {
  days: WeekDayData[]
}

// ===================== 主组件 =====================

export default function WeekHeatmapGrid({ days }: Props) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null)

  // 计算每天的 24 小时 level
  const dayLevels = useMemo(() => {
    return days.map(d => ({
      date: d.date,
      dateLabel: d.dateLabel,
      weekdayShort: d.weekdayShort,
      dateFull: d.dateFull,
      hasData: d.hasData,
      levels: aggregateToHourlyLevels(d.activity),
    }))
  }, [days])

  // ---- 自适应时间范围（扫描 7 天合集） ----
  const { rangeStart, rangeEnd } = useMemo(() => {
    let firstActive = 24
    let lastActive = -1

    for (const dl of dayLevels) {
      dl.levels.forEach((lv, h) => {
        if (lv > 0) {
          firstActive = Math.min(firstActive, h)
          lastActive = Math.max(lastActive, h)
        }
      })
    }

    if (firstActive > lastActive) {
      return { rangeStart: DEFAULT_START, rangeEnd: DEFAULT_END }
    }

    let start = Math.max(0, firstActive - 1)
    let end = Math.min(24, lastActive + 2)

    const span = end - start
    if (span < MIN_SPAN) {
      const deficit = MIN_SPAN - span
      const padBefore = Math.floor(deficit / 2)
      const padAfter = deficit - padBefore
      start = Math.max(0, start - padBefore)
      end = Math.min(24, end + padAfter)
      if (end - start < MIN_SPAN) {
        if (start === 0) end = Math.min(24, start + MIN_SPAN)
        else start = Math.max(0, end - MIN_SPAN)
      }
    }

    return { rangeStart: start, rangeEnd: end }
  }, [dayLevels])

  const visibleSpan = rangeEnd - rangeStart

  // ---- 动态时间刻度 ----
  const timeTicks = useMemo(() => {
    const step = visibleSpan <= 10 ? 2 : 3
    const minGap = Math.ceil(step / 2)
    const ticks: number[] = []
    const firstTick = Math.ceil(rangeStart / step) * step
    for (let h = firstTick; h < rangeEnd; h += step) {
      ticks.push(h)
    }
    // 起始刻度：与第一个常规刻度间距足够时才显示
    if (ticks.length === 0 || (ticks[0] !== rangeStart && ticks[0] - rangeStart >= minGap)) {
      ticks.unshift(rangeStart)
    }
    // 末尾刻度：与最后一个常规刻度间距足够时才显示
    const lastTick = ticks[ticks.length - 1]
    if (lastTick !== rangeEnd && rangeEnd - lastTick >= minGap) {
      ticks.push(rangeEnd)
    }
    return ticks
  }, [rangeStart, rangeEnd, visibleSpan])

  // 稳定高效时段洞察
  const insight = useMemo(() => {
    // 对每个小时，统计 7 天中有几天 level >= 2
    const hourHighCount: number[] = Array(TOTAL_HOURS).fill(0)
    for (const dl of dayLevels) {
      dl.levels.forEach((lv, h) => {
        if (lv >= 2) hourHighCount[h]++
      })
    }
    // >= 5 天的标注为"稳定高效"
    const stableHours = hourHighCount
      .map((cnt, h) => ({ h, cnt }))
      .filter(x => x.cnt >= 5)
      .map(x => x.h)

    if (stableHours.length === 0) return null

    // 合并连续时段
    const ranges: string[] = []
    let start = stableHours[0]
    let prev = stableHours[0]
    for (let i = 1; i < stableHours.length; i++) {
      if (stableHours[i] === prev + 1) {
        prev = stableHours[i]
      } else {
        ranges.push(`${start}:00–${prev + 1}:00`)
        start = stableHours[i]
        prev = stableHours[i]
      }
    }
    ranges.push(`${start}:00–${prev + 1}:00`)
    return `稳定高效时段：${ranges.join('、')}`
  }, [dayLevels])

  // 展开面板数据（选中天的任务分布）
  const expandedTaskEntries = useMemo(() => {
    if (!expandedDate) return null
    const day = days.find(d => d.date === expandedDate)
    if (!day) return null
    const taskMap = buildTaskHourRatioMap(day.events)
    return Array.from(taskMap.entries())
      .map(([title, hourMap]) => {
        let totalMin = 0
        hourMap.forEach(r => { totalMin += r * 60 })
        return { title, hourMap, totalMinutes: Math.round(totalMin) }
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
  }, [expandedDate, days])

  return (
    <div className="space-y-2">
      {/* 图例 */}
      <div className="flex items-center gap-3 text-2xs text-gray-400">
        <span>每小时活跃占比：</span>
        {LEVEL_BG.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* 7×24 网格 */}
      <div className="space-y-0.5">
        {dayLevels.map((dl) => {
          const isExpanded = expandedDate === dl.date
          return (
            <div key={dl.date}>
              {/* 一行：日期标签 + 24 个格子 */}
              <div
                className={`flex items-center gap-1.5 cursor-pointer rounded-md px-1 py-0.5 transition-colors
                  ${isExpanded ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                onClick={() => setExpandedDate(isExpanded ? null : dl.date)}
              >
                {/* 左侧日期标签 */}
                <span
                  className="text-2xs text-gray-500 w-[80px] flex-shrink-0 text-right tabular-nums"
                  title={dl.dateFull}
                >
                  {dl.dateLabel} {dl.weekdayShort}
                </span>

                {/* 动态范围格子 */}
                <div className="flex-1 flex gap-[1px]">
                  {dl.levels.slice(rangeStart, rangeEnd).map((lv, i) => {
                    const h = rangeStart + i
                    return (
                      <div
                        key={h}
                        className={`h-4 flex-1 rounded-[2px] transition-all ${LEVEL_BG[lv]}
                          ${isExpanded ? 'opacity-90' : 'hover:scale-y-125'}`}
                        title={`${dl.dateFull} ${fmtHour(h)}–${fmtHour(h + 1)}: ${LEVEL_LABELS[lv]}`}
                      />
                    )
                  })}
                </div>

                {/* 展开箭头 */}
                <span className={`text-[8px] text-gray-400 w-3 flex-shrink-0 transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}>
                  ▼
                </span>
              </div>

              {/* 展开：该天的任务时间分布（和主行完全对齐） */}
              {isExpanded && expandedTaskEntries && (
                <div className="mt-0.5 mb-1.5 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  {expandedTaskEntries.length === 0 ? (
                    <div className="flex items-center gap-1.5 px-1 py-1">
                      <span className="w-[80px] flex-shrink-0" />
                      <p className="text-2xs text-gray-400">当天暂无任务数据</p>
                    </div>
                  ) : (
                    expandedTaskEntries.map((task) => (
                      <div key={task.title} className="flex items-center gap-1.5 px-1">
                        {/* 和主行日期标签同宽，确保格子对齐 */}
                        <span className="text-2xs text-gray-600 font-medium truncate w-[80px] flex-shrink-0 text-right" title={task.title}>
                          {task.title}
                        </span>
                        <div className="flex gap-[1px] flex-1 min-w-0">
                          {Array.from({ length: visibleSpan }, (_, i) => {
                            const h = rangeStart + i
                            const ratio = task.hourMap.get(h) || 0
                            const level = ratioToLevel(ratio)
                            return (
                              <div
                                key={h}
                                className={`h-[10px] flex-1 rounded-[2px] ${LEVEL_BG[level]}`}
                                title={ratio > 0 ? `${fmtHour(h)}–${fmtHour(h + 1)}: ${ratioToPercentStr(ratio)}` : ''}
                              />
                            )
                          })}
                        </div>
                        {/* 和主行箭头同宽的占位 */}
                        <span className="w-3 flex-shrink-0" />
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部时间刻度（与网格行使用相同的 flex 布局，确保对齐） */}
      <div className="flex items-center gap-1.5 px-1">
        <span className="w-[80px] flex-shrink-0" />
        <div className="flex-1 relative h-4">
          {timeTicks.map((h) => {
            const pct = ((h - rangeStart) / visibleSpan) * 100
            return (
              <span
                key={h}
                className="absolute text-3xs text-gray-400 tabular-nums"
                style={{
                  left: `${pct}%`,
                  transform: pct === 0 ? 'none' : pct >= 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {fmtHour(h)}
              </span>
            )
          })}
        </div>
        <span className="w-3 flex-shrink-0" />
      </div>
    </div>
  )
}
