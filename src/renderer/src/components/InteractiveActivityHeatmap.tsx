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

interface Props {
  data: ActivityRecord[]
  events: TrackEvent[]
  rangeStart?: number
  rangeEnd?: number
}

// ===================== 工具函数 =====================

/**
 * 从事件流中提取每个任务在每个小时的活跃比例
 * 返回 Map<taskTitle, Map<hourIndex, ratio>>
 */
function buildTaskHourRatioMap(events: TrackEvent[]): Map<string, Map<number, number>> {
  const result = new Map<string, Map<number, number>>()

  const starts: { timestamp: number; taskTitle: string; sessionId: string }[] = []
  const ends: { timestamp: number; taskTitle: string; sessionId: string }[] = []

  for (const e of events) {
    if (e.type === 'session.started') {
      const p = e.payload as { sessionId: string; taskTitle: string }
      if (p.taskTitle) {
        starts.push({ timestamp: e.timestamp, taskTitle: p.taskTitle, sessionId: p.sessionId })
      }
    } else if (e.type === 'session.ended') {
      const p = e.payload as { sessionId: string; taskTitle: string }
      if (p.taskTitle) {
        ends.push({ timestamp: e.timestamp, taskTitle: p.taskTitle, sessionId: p.sessionId })
      }
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
      const minutes = (endTs - startTs) / 60000
      addMinutes(title, startHour, minutes)
    } else {
      const startMin = startDate.getMinutes() + startDate.getSeconds() / 60
      addMinutes(title, startHour, 60 - startMin)

      if (startHour < endHour) {
        for (let h = startHour + 1; h < endHour; h++) {
          addMinutes(title, h, 60)
        }
      } else {
        for (let h = startHour + 1; h < 24; h++) addMinutes(title, h, 60)
        for (let h = 0; h < endHour; h++) addMinutes(title, h, 60)
      }

      const endMin = endDate.getMinutes() + endDate.getSeconds() / 60
      if (endMin > 0) {
        addMinutes(title, endHour, endMin)
      }
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

// ===================== 主组件 =====================

export default function InteractiveActivityHeatmap({ data, events, rangeStart: propStart, rangeEnd: propEnd }: Props) {
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

  // ---- 任务小时比例 ----
  const taskHourRatioMap = useMemo(() => buildTaskHourRatioMap(events), [events])

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

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无使用数据（数据采集中…）
      </div>
    )
  }

  return (
    <div className="relative select-none">

      {/* ======== 图例 ======== */}
      <div className="flex items-center gap-3 mb-2.5 text-2xs text-gray-400">
        <span>每小时活跃占比：</span>
        {LEVEL_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* ======== 热力条（动态范围，左右 padding 与折线图对齐） ======== */}
      <div style={{ paddingLeft: HEATMAP_PAD_LEFT_PCT, paddingRight: HEATMAP_PAD_RIGHT_PCT }}>
        <div className="relative flex gap-[2px] w-full">
          {visibleBlocks.map((block) => {
            const level = ratioToLevel(block.avgUsageRatio)
            return (
              <div
                key={block.index}
                className={`h-7 flex-1 rounded-[3px] transition-all hover:scale-y-110 ${LEVEL_COLORS[level]}`}
                onMouseEnter={(e) => {
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
              />
            )
          })}
        </div>

        {/* ======== 底部时间刻度 ======== */}
        <div className="relative w-full h-3.5 mt-0.5">
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
                {h}
              </span>
            )
          })}
        </div>
      </div>

      {/* ======== 任务时间分布（暂时隐藏） ======== */}

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
