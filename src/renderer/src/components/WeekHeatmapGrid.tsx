/**
 * WeekHeatmapGrid —— 7×24 活动分布热力网格（周视图核心）
 *
 * 7 行（每天一行）× 24 列（每小时一格），颜色沿用日视图的 4 级配色。
 * 点击某行 → 展开该天的任务时间分布详情。
 * 顶部一句话洞察：统计"稳定高效时段"。
 */

import { useMemo, useState, useRef, useCallback } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import { getEffectiveMoodForWeekDayIndex } from './WeekCompletionBars'
import { WEEK_PAD_LEFT_PCT, WEEK_PAD_RIGHT_PCT } from './WeekRhythmChart'
import { MOOD_LABELS } from '../utils/mood'

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
const GRID_LEFT_PCT = parseFloat(WEEK_PAD_LEFT_PCT)
const GRID_RIGHT_PCT = parseFloat(WEEK_PAD_RIGHT_PCT)
const GRID_WIDTH_PCT = 100 - GRID_LEFT_PCT - GRID_RIGHT_PCT
const MOOD_EMOJI: Record<number, string> = {
  1: '😭',
  2: '😟',
  3: '😶',
  4: '😃',
  5: '🤩',
}

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

/** 每小时真实活跃度百分比（0~100） */
function aggregateToHourlyPercent(data: ActivityRecord[]): number[] {
  const buckets = Array(TOTAL_HOURS).fill(0)
  for (const r of data) {
    const h = new Date(r.ts).getHours()
    buckets[h] += getActiveRatio(r)
  }
  return buckets.map(total => Math.min(Math.round((total / EXPECTED_RECORDS_PER_HOUR) * 100), 100))
}

/* buildTaskHourRatioMap 暂时隐藏，展开功能恢复时再启用 */

function fmtHour(h: number): string {
  return `${String(h % 24).padStart(2, '0')}:00`
}

function getMoodLabel(mood: number): string {
  return MOOD_LABELS.find(item => item.value === mood)?.label ?? '未记录'
}

/* ratioToPercentStr 暂时隐藏 */

/**
 * 根据一周多天的活动数据计算自适应的可见时间范围。
 * 被周热力图和周节奏曲线共用，确保横轴一致。
 */
export function computeWeekActiveTimeRange(
  days: WeekDayData[],
): { rangeStart: number; rangeEnd: number } {
  let firstActive = 24
  let lastActive = -1

  for (const d of days) {
    const levels = aggregateToHourlyLevels(d.activity)
    levels.forEach((lv, h) => {
      if (lv > 0) { firstActive = Math.min(firstActive, h); lastActive = Math.max(lastActive, h) }
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
}

// ===================== Props =====================

interface Props {
  days: WeekDayData[]
  rangeStart?: number
  rangeEnd?: number
  showMoodColumn?: boolean
  highlightHour?: number | null
  highlightRange?: { startHour: number; endHour: number } | null
  highlightPulseKey?: string
}

// ===================== 主组件 =====================

export default function WeekHeatmapGrid({
  days,
  rangeStart: propStart,
  rangeEnd: propEnd,
  showMoodColumn = false,
  highlightHour = null,
  highlightRange = null,
  highlightPulseKey,
}: Props) {
  const [hoveredCell, setHoveredCell] = useState<{ date: string; hour: number } | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const gridRef = useRef<HTMLDivElement>(null)

  const handleCellEnter = useCallback((date: string, hour: number, e: React.MouseEvent) => {
    setHoveredCell({ date, hour })
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect()
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
  }, [])

  const handleCellMove = useCallback((e: React.MouseEvent) => {
    if (gridRef.current) {
      const rect = gridRef.current.getBoundingClientRect()
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
  }, [])

  // 计算每天的 24 小时 level
  const dayLevels = useMemo(() => {
    return days.map((d, index) => {
      const recordedMood = d.moodRecord?.mood
      const mood = getEffectiveMoodForWeekDayIndex(index, recordedMood)
      return {
        date: d.date,
        dateLabel: d.dateLabel,
        weekdayShort: d.weekdayShort,
        dateFull: d.dateFull,
        hasData: d.hasData,
        levels: aggregateToHourlyLevels(d.activity),
        percent: aggregateToHourlyPercent(d.activity),
        moodEmoji: MOOD_EMOJI[mood] ?? '😶',
        moodLabel: getMoodLabel(mood),
        isDemoMood: recordedMood == null,
      }
    })
  }, [days])

  // ---- 自适应时间范围（优先使用外部传入的值） ----
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (propStart != null && propEnd != null) {
      return { rangeStart: propStart, rangeEnd: propEnd }
    }
    return computeWeekActiveTimeRange(days)
  }, [propStart, propEnd, days])

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

  // 展开面板数据（暂时隐藏）

  const visibleSpan = rangeEnd - rangeStart
  const normalizedHighlightRange = highlightRange
    ? {
        startHour: Math.max(highlightRange.startHour, rangeStart),
        endHour: Math.min(highlightRange.endHour, rangeEnd),
      }
    : highlightHour != null
      ? { startHour: highlightHour, endHour: highlightHour + 1 }
      : null
  const hasVisibleHighlight = Boolean(
    normalizedHighlightRange &&
    normalizedHighlightRange.endHour > normalizedHighlightRange.startHour &&
    normalizedHighlightRange.startHour >= rangeStart &&
    normalizedHighlightRange.endHour <= rangeEnd,
  )
  const highlightGridLeftPct = normalizedHighlightRange
    ? ((normalizedHighlightRange.startHour - rangeStart) / visibleSpan) * GRID_WIDTH_PCT + GRID_LEFT_PCT
    : 0
  const highlightGridWidthPct = normalizedHighlightRange
    ? ((normalizedHighlightRange.endHour - normalizedHighlightRange.startHour) / visibleSpan) * GRID_WIDTH_PCT
    : 0

  return (
    <div ref={gridRef} className="relative">
      {hasVisibleHighlight ? (
        <div
          key={highlightPulseKey ?? `${normalizedHighlightRange?.startHour}-${normalizedHighlightRange?.endHour}`}
          className="ai-focus-target pointer-events-none absolute top-0 z-20 h-full rounded-md"
          style={{
            left: `${highlightGridLeftPct}%`,
            width: `${highlightGridWidthPct}%`,
          }}
          aria-hidden="true"
        />
      ) : null}
      {/* 7×24 网格 */}
      <div className="space-y-0.5">
        {dayLevels.map((dl) => (
          <div key={dl.date}>
            <div className="relative flex items-center rounded-md py-0.5 transition-colors hover:bg-gray-50">
              <span
                className="flex flex-shrink-0 items-center justify-end gap-1 whitespace-nowrap pr-1 text-2xs text-gray-500 tabular-nums"
                style={{ width: WEEK_PAD_LEFT_PCT }}
              >
                <span>{dl.dateLabel} {dl.weekdayShort}</span>
                <span className="relative inline-flex h-5 w-5 flex-shrink-0 items-center justify-center">
                  {showMoodColumn ? (
                    <span className="group/mood inline-flex">
                      <span
                        className="pointer-events-auto inline-flex h-5 w-5 flex-shrink-0 items-center justify-center text-base leading-none opacity-95 transition-transform hover:scale-110 hover:opacity-100"
                        aria-label={`${dl.dateLabel} ${dl.weekdayShort} ${dl.isDemoMood ? '示例心情' : '心情'}：${dl.moodLabel}`}
                      >
                        {dl.moodEmoji}
                      </span>
                      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-800 px-2 py-1 text-[10px] font-normal leading-none text-white opacity-0 shadow-lg transition-opacity group-hover/mood:opacity-100">
                        {dl.isDemoMood ? '示例心情' : '心情'}：{dl.moodLabel}
                      </span>
                    </span>
                  ) : null}
                  </span>
              </span>
              <div className="flex flex-1" style={{ marginRight: WEEK_PAD_RIGHT_PCT }}>
                {dl.levels.slice(rangeStart, rangeEnd).map((lv, i) => {
                  const h = rangeStart + i
                  return (
                    <div
                      key={h}
                      className={`h-4 flex-1 rounded-[2px] transition-all outline outline-[0.5px] outline-white ${LEVEL_BG[lv]} hover:scale-y-125`}
                      onMouseEnter={(e) => handleCellEnter(dl.date, h, e)}
                      onMouseMove={handleCellMove}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 自定义即时 tooltip */}
      {hoveredCell && (() => {
        const dl = dayLevels.find(d => d.date === hoveredCell.date)
        if (!dl) return null
        const pct = dl.percent[hoveredCell.hour]
        const text = `${dl.dateLabel} ${dl.weekdayShort} ${fmtHour(hoveredCell.hour)}–${fmtHour(hoveredCell.hour + 1)}`
        return (
          <div
            className="absolute z-50 pointer-events-none px-2.5 py-1.5 rounded-md text-white text-[11px] leading-snug shadow-lg"
            style={{
              backgroundColor: 'rgba(31,41,55,0.92)',
              left: tooltipPos.x,
              top: tooltipPos.y - 40,
              transform: 'translateX(-50%)',
              whiteSpace: 'nowrap',
            }}
          >
            <div className="text-gray-300 text-[10px]">{text}</div>
            <div className="font-bold text-[12px]">活跃度：{pct}%</div>
          </div>
        )
      })()}

      {/* 图例（底部） */}
      <div className="flex items-center gap-3 mt-1 text-2xs text-gray-400">
        <span>每小时电脑活跃度：</span>
        {LEVEL_BG.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
