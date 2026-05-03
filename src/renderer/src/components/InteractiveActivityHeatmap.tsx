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
import { computeActiveTimeRange } from '../utils/activity-time-range'

// ===================== 常量 =====================

const TOTAL_BLOCKS = 24
const EXPECTED_RECORDS_PER_BLOCK = 120
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
  taskTitle: string
}

interface Props {
  data: ActivityRecord[]
  events: TrackEvent[]
  rangeStart?: number
  rangeEnd?: number
  highlightTask?: string | null
  showAllTasks?: boolean
  taskTitles?: string[]
}

// ===================== 工具函数 =====================

function addSessionSegments(
  result: Map<number, TaskTimeSegment[]>,
  taskTitle: string,
  startMs: number,
  endMs: number,
) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return

  let cursor = startMs
  while (cursor < endMs) {
    const cursorDate = new Date(cursor)
    const hourStart = new Date(cursorDate)
    hourStart.setMinutes(0, 0, 0)

    const hourStartMs = hourStart.getTime()
    const nextHourMs = hourStartMs + 60 * 60 * 1000
    const segmentEndMs = Math.min(endMs, nextHourMs)
    const hour = cursorDate.getHours()
    const startFrac = (cursor - hourStartMs) / (60 * 60 * 1000)
    const endFrac = (segmentEndMs - hourStartMs) / (60 * 60 * 1000)

    if (endFrac > startFrac) {
      if (!result.has(hour)) result.set(hour, [])
      result.get(hour)!.push({ hour, startFrac, endFrac, taskTitle })
    }

    cursor = segmentEndMs
  }
}

/**
 * 从已结束的 session 中提取任务时间段。
 *
 * 注意：任务用时条形图使用 session.ended.totalDurationSeconds 聚合。
 * 这里也用同一个字段反推开始时间，避免未闭合 session.started 被 Date.now()
 * 拉成长时间段，导致 16 分钟任务在热力条上覆盖一整天。
 */
function buildTaskTimeSegments(
  events: TrackEvent[],
  taskTitle: string,
): Map<number, TaskTimeSegment[]> {
  const result = new Map<number, TaskTimeSegment[]>()

  for (const e of events) {
    if (e.type !== 'session.ended') continue
    const p = e.payload as { taskTitle: string; totalDurationSeconds: number }
    if (p.taskTitle !== taskTitle || p.totalDurationSeconds <= 0) continue

    const endMs = e.timestamp
    const startMs = endMs - p.totalDurationSeconds * 1000
    addSessionSegments(result, p.taskTitle, startMs, endMs)
  }

  return result
}

function buildAllTaskTimeSegments(
  events: TrackEvent[],
  taskTitles: string[],
): Map<number, TaskTimeSegment[]> {
  const result = new Map<number, TaskTimeSegment[]>()
  const allowedTitles = new Set(taskTitles)

  for (const e of events) {
    if (e.type !== 'session.ended') continue
    const p = e.payload as { taskTitle: string; totalDurationSeconds: number }
    if (!allowedTitles.has(p.taskTitle) || p.totalDurationSeconds <= 0) continue

    const endMs = e.timestamp
    const startMs = endMs - p.totalDurationSeconds * 1000
    addSessionSegments(result, p.taskTitle, startMs, endMs)
  }

  return result
}

function formatSegmentTime(hour: number, startFrac: number, endFrac: number): string {
  const format = (totalMinutes: number) => {
    const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
    const h = Math.floor(normalized / 60)
    const m = normalized % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }
  const baseMinutes = hour * 60
  return `${format(baseMinutes + Math.round(startFrac * 60))}–${format(baseMinutes + Math.round(endFrac * 60))}`
}

// ===================== 主组件 =====================

export default function InteractiveActivityHeatmap({
  data,
  events,
  rangeStart: propStart,
  rangeEnd: propEnd,
  highlightTask,
  showAllTasks = false,
  taskTitles = [],
}: Props) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string; usagePct?: number; level?: number; taskName?: string; kind?: 'activity' | 'task'
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

  const allTaskSegments = useMemo(() => {
    if (!showAllTasks || taskTitles.length === 0) return null
    return buildAllTaskTimeSegments(events, taskTitles)
  }, [events, showAllTasks, taskTitles])

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
            const isHighlighting = showAllTasks || !!highlightTask
            const segments = (showAllTasks ? allTaskSegments : highlightSegments)?.get(block.index) ?? []

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
                    className="absolute top-0 h-full bg-blue-400/85 rounded-[2px] cursor-help"
                    style={{
                      left: `${seg.startFrac * 100}%`,
                      width: `${(seg.endFrac - seg.startFrac) * 100}%`,
                    }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setTooltip({
                        x: rect.left + rect.width / 2,
                        y: rect.top,
                        label: formatSegmentTime(seg.hour, seg.startFrac, seg.endFrac),
                        taskName: seg.taskTitle,
                        kind: 'task',
                      })
                    }}
                    onMouseLeave={() => setTooltip(null)}
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
          {tooltip.kind !== 'task' && (
            <>
              <span className="mx-1.5 opacity-40">|</span>
              <span>活跃 {tooltip.usagePct}%</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
