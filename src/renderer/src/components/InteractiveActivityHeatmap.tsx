/**
 * InteractiveActivityHeatmap —— 交互式活动热力图 + 任务时间分布
 *
 * 自适应时间范围：根据当天实际活动数据动态裁剪显示区间，
 * 避免凌晨等无活动时段浪费空间，让有数据的部分占满全宽。
 *
 * 上半部分：热力条（仅显示活跃范围）
 * 下半部分：任务时间分布（和热力条对齐）
 */

import { useMemo, useState } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { TrackEvent } from '../services/tracker'
import { HEATMAP_PAD_LEFT_PCT, HEATMAP_PAD_RIGHT_PCT } from './ActivityRhythmChart'

// ===================== 常量 =====================

const TOTAL_BLOCKS = 24
const EXPECTED_RECORDS_PER_BLOCK = 120
const MIN_SPAN = 12
const DEFAULT_START = 7
const DEFAULT_END = 23

/**
 * 根据活跃度数据计算自适应的可见时间范围。
 * 被热力图和节奏曲线共用，确保横轴一致。
 */
export function computeActiveTimeRange(
  data: ActivityRecord[],
): { rangeStart: number; rangeEnd: number } {
  const buckets: number[] = Array(24).fill(0)
  for (const r of data) {
    const h = new Date(r.ts).getHours()
    buckets[h] += getActiveRatio(r)
  }

  let firstActive = 24
  let lastActive = -1
  for (let i = 0; i < 24; i++) {
    if (buckets[i] / EXPECTED_RECORDS_PER_BLOCK > 0) {
      firstActive = Math.min(firstActive, i)
      lastActive = Math.max(lastActive, i)
    }
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

function ratioToLevel(usageRatio: number): number {
  if (usageRatio <= 0) return 0
  if (usageRatio <= 0.25) return 1
  if (usageRatio <= 0.50) return 2
  if (usageRatio <= 0.75) return 3
  return 4
}

const LEVEL_COLORS = [
  'bg-gray-100',       // 0: 未使用
  'bg-emerald-100',    // 1: < 25%
  'bg-emerald-300',    // 2: 25%~50%
  'bg-emerald-500',    // 3: 50%~75%
  'bg-emerald-700',    // 4: > 75%
]
const LEVEL_LABELS = ['未使用', '< 25%', '25%~50%', '50%~75%', '> 75%']

/** 任务在某小时内的精确时间段 */
interface TaskTimeSegment {
  hour: number
  startFrac: number   // 该小时内的起始比例 0~1
  endFrac: number     // 该小时内的结束比例 0~1
}

interface Props {
  data: ActivityRecord[]
  events: TrackEvent[]
  rangeStart?: number
  rangeEnd?: number
  highlightTask?: string | null
}

// ===================== 工具函数 =====================

/**
 * 从事件流中提取指定任务的精确时间段（每个 session 拆到小时粒度）。
 * 返回 Map<hour, TaskTimeSegment[]>，同一小时可能有多段。
 */
function buildTaskTimeSegments(
  events: TrackEvent[],
  taskTitle: string,
): Map<number, TaskTimeSegment[]> {
  const result = new Map<number, TaskTimeSegment[]>()

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

  function addSegment(hour: number, startFrac: number, endFrac: number) {
    if (endFrac <= startFrac) return
    if (!result.has(hour)) result.set(hour, [])
    result.get(hour)!.push({ hour, startFrac, endFrac })
  }

  for (const start of starts) {
    const end = ends.find(e => e.sessionId === start.sessionId)
    const title = end ? end.taskTitle : start.taskTitle
    if (title !== taskTitle) continue

    const startDate = new Date(start.timestamp)
    const endDate = new Date(end ? end.timestamp : Date.now())
    const startHour = startDate.getHours()
    const endHour = endDate.getHours()
    const startMinFrac = (startDate.getMinutes() + startDate.getSeconds() / 60) / 60
    const endMinFrac = (endDate.getMinutes() + endDate.getSeconds() / 60) / 60

    if (startHour === endHour) {
      addSegment(startHour, startMinFrac, endMinFrac)
    } else {
      addSegment(startHour, startMinFrac, 1)
      const lo = startHour < endHour ? startHour + 1 : startHour + 1
      const hi = startHour < endHour ? endHour : endHour + 24
      for (let h = lo; h < hi; h++) addSegment(h % 24, 0, 1)
      if (endMinFrac > 0) addSegment(endHour, 0, endMinFrac)
    }
  }

  return result
}

// ===================== 主组件 =====================

export default function InteractiveActivityHeatmap({ data, events, rangeStart: propStart, rangeEnd: propEnd, highlightTask }: Props) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string; usagePct: number; level: number; taskName?: string
  } | null>(null)

  // ---- 聚合热力条（全 24 小时） ----
  const blocks = useMemo(() => {
    const buckets: { totalRatio: number; count: number }[] = Array.from(
      { length: TOTAL_BLOCKS },
      () => ({ totalRatio: 0, count: 0 })
    )
    for (const r of data) {
      const d = new Date(r.ts)
      const blockIdx = Math.min(d.getHours(), TOTAL_BLOCKS - 1)
      buckets[blockIdx].totalRatio += getActiveRatio(r)
      buckets[blockIdx].count++
    }
    return buckets.map((b, i) => {
      const avgUsageRatio = b.totalRatio / EXPECTED_RECORDS_PER_BLOCK
      return {
        index: i,
        avgUsageRatio,
        count: b.count,
        label: `${String(i).padStart(2, '0')}:00–${String(i + 1 === 24 ? 0 : i + 1).padStart(2, '0')}:00`,
      }
    })
  }, [data])

  // ---- 自适应时间范围（优先使用外部传入的值） ----
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (propStart != null && propEnd != null) {
      return { rangeStart: propStart, rangeEnd: propEnd }
    }
    return computeActiveTimeRange(data)
  }, [propStart, propEnd, data])

  const visibleSpan = rangeEnd - rangeStart

  // ---- 每小时刻度 ----
  const timeTicks = useMemo(() => {
    const ticks: number[] = []
    for (let h = rangeStart; h <= rangeEnd; h++) {
      ticks.push(h)
    }
    return ticks
  }, [rangeStart, rangeEnd])

  // ---- 裁剪后的热力块 ----
  const visibleBlocks = blocks.slice(rangeStart, rangeEnd)

  // ---- hover 高亮：计算指定任务的精确时间段 ----
  const highlightSegments = useMemo(() => {
    if (!highlightTask) return null
    return buildTaskTimeSegments(events, highlightTask)
  }, [events, highlightTask])

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无使用数据（数据采集中…）
      </div>
    )
  }

  return (
    <div className="relative select-none">

      {/* ======== 热力条（动态范围，左右 padding 与折线图对齐） ======== */}
      <div style={{ paddingLeft: HEATMAP_PAD_LEFT_PCT, paddingRight: HEATMAP_PAD_RIGHT_PCT }}>
        <div className="relative flex w-full">
          {visibleBlocks.map((block) => {
            const level = ratioToLevel(block.avgUsageRatio)
            const isHighlighting = !!highlightTask
            const segments = highlightSegments?.get(block.index) ?? []

            return (
              <div
                key={block.index}
                className={`h-7 flex-1 rounded-[3px] transition-colors duration-200 relative overflow-hidden outline outline-1 outline-white ${
                  isHighlighting ? 'bg-gray-100' : LEVEL_COLORS[level]
                }`}
                onMouseEnter={(e) => {
                  if (isHighlighting) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  setTooltip({
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                    label: block.label,
                    usagePct: Math.min(Math.round(block.avgUsageRatio * 100), 100),
                    level,
                  })
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                {isHighlighting && segments.map((seg, si) => (
                  <span
                    key={si}
                    className="absolute top-0 h-full bg-blue-400/85 rounded-[2px]"
                    style={{
                      left: `${seg.startFrac * 100}%`,
                      width: `${(seg.endFrac - seg.startFrac) * 100}%`,
                    }}
                  />
                ))}
              </div>
            )
          })}
        </div>

      </div>

      {/* ======== 图例（热力条下方） ======== */}
      <div className="flex items-center gap-3 mt-1 text-2xs text-gray-400">
        <span>每小时电脑活跃度：</span>
        {LEVEL_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* ======== 悬浮提示 ======== */}
      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-2xs
                     shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y - 36,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltip.taskName && (
            <>
              <span className="font-medium">{tooltip.taskName}</span>
              <span className="mx-1.5 opacity-40">|</span>
            </>
          )}
          <span className="font-medium">{tooltip.label}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>活跃 {tooltip.usagePct}%</span>
        </div>
      )}
    </div>
  )
}
