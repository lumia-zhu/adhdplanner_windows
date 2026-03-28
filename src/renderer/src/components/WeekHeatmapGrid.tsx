/**
 * WeekHeatmapGrid —— 7×24 活动分布热力网格（周视图核心）
 *
 * 7 行（每天一行）× 24 列（每小时一格），颜色沿用日视图的 4 级配色。
 * 点击某行 → 展开该天的任务时间分布详情。
 * 顶部一句话洞察：统计"稳定高效时段"。
 */

import { useMemo } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import { WEEK_PAD_LEFT_PCT, WEEK_PAD_RIGHT_PCT } from './WeekRhythmChart'

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

/* buildTaskHourRatioMap 暂时隐藏，展开功能恢复时再启用 */

function fmtHour(h: number): string {
  return `${String(h % 24).padStart(2, '0')}:00`
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
}

// ===================== 主组件 =====================

export default function WeekHeatmapGrid({ days, rangeStart: propStart, rangeEnd: propEnd }: Props) {
  // 展开功能暂时隐藏
  // const [expandedDate, setExpandedDate] = useState<string | null>(null)

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
        {dayLevels.map((dl) => (
          <div key={dl.date}>
            <div className="flex items-center gap-1 rounded-md py-0.5 transition-colors hover:bg-gray-50">
              <span
                className="text-2xs text-gray-500 w-[38px] flex-shrink-0 text-right tabular-nums"
                title={dl.dateFull}
              >
                {dl.dateLabel} {dl.weekdayShort}
              </span>
              <div className="flex-1 flex gap-[1px]" style={{ paddingLeft: WEEK_PAD_LEFT_PCT, paddingRight: WEEK_PAD_RIGHT_PCT }}>
                {dl.levels.slice(rangeStart, rangeEnd).map((lv, i) => {
                  const h = rangeStart + i
                  return (
                    <div
                      key={h}
                      className={`h-4 flex-1 rounded-[2px] transition-all ${LEVEL_BG[lv]} hover:scale-y-125`}
                      title={`${dl.dateFull} ${fmtHour(h)}–${fmtHour(h + 1)}: ${LEVEL_LABELS[lv]}`}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
