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

// ===================== 常量 =====================

const TOTAL_BLOCKS = 24
const EXPECTED_RECORDS_PER_BLOCK = 120
const MIN_SPAN = 12         // 最少显示 12 小时，避免活动集中时格子太宽
const DEFAULT_START = 7      // 无数据时的默认起始
const DEFAULT_END = 23       // 无数据时的默认结束

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

export default function InteractiveActivityHeatmap({ data, events }: Props) {
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

  const taskEntries = useMemo(() => {
    return Array.from(taskHourRatioMap.entries())
      .map(([title, hourMap]) => {
        let totalMinutes = 0
        hourMap.forEach(r => { totalMinutes += r * 60 })
        return { title, hourMap, totalMinutes: Math.round(totalMinutes) }
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
  }, [taskHourRatioMap])

  // ---- 自适应时间范围 ----
  const { rangeStart, rangeEnd } = useMemo(() => {
    let firstActive = 24
    let lastActive = -1

    // 从活跃度数据中找范围
    for (const b of blocks) {
      if (b.avgUsageRatio > 0) {
        firstActive = Math.min(firstActive, b.index)
        lastActive = Math.max(lastActive, b.index)
      }
    }

    // 也从任务事件中找范围（覆盖活跃度采样可能遗漏的时段）
    for (const [, hourMap] of taskHourRatioMap) {
      for (const [h, ratio] of hourMap) {
        if (ratio > 0) {
          firstActive = Math.min(firstActive, h)
          lastActive = Math.max(lastActive, h)
        }
      }
    }

    // 无活动数据 → 默认范围
    if (firstActive > lastActive) {
      return { rangeStart: DEFAULT_START, rangeEnd: DEFAULT_END }
    }

    // 前后各加 1 小时缓冲（rangeEnd 是 exclusive，所以 lastActive + 2）
    let start = Math.max(0, firstActive - 1)
    let end = Math.min(24, lastActive + 2)

    // 保证最小跨度
    const span = end - start
    if (span < MIN_SPAN) {
      const deficit = MIN_SPAN - span
      const padBefore = Math.floor(deficit / 2)
      const padAfter = deficit - padBefore
      start = Math.max(0, start - padBefore)
      end = Math.min(24, end + padAfter)
      // 边界补偿
      if (end - start < MIN_SPAN) {
        if (start === 0) end = Math.min(24, start + MIN_SPAN)
        else start = Math.max(0, end - MIN_SPAN)
      }
    }

    return { rangeStart: start, rangeEnd: end }
  }, [blocks, taskHourRatioMap])

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

      {/* ======== 热力条（动态范围） ======== */}
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

      {/* ======== 底部时间刻度（动态） ======== */}
      <div className="relative w-full h-4 mt-1">
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

      {/* ======== 任务时间分布（任务名单独一行，热力条全宽对齐上方） ======== */}
      {taskEntries.length > 0 && (
        <div className="mt-3 space-y-1">
          {taskEntries.map((task) => (
            <div key={task.title}>
              <span className="text-xxs text-gray-500 font-medium truncate block mb-0.5" title={task.title}>
                {task.title}
              </span>
              <div className="flex gap-[2px] w-full">
                {Array.from({ length: visibleSpan }, (_, i) => {
                  const h = rangeStart + i
                  const ratio = task.hourMap.get(h) || 0
                  const level = ratioToLevel(ratio)
                  return (
                    <div
                      key={h}
                      className={`h-5 flex-1 rounded-[3px] transition-all hover:scale-y-110 ${LEVEL_COLORS[level]}`}
                      onMouseEnter={(e) => {
                        if (ratio <= 0) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTooltip({
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                          label: `${fmtHour(h)}–${fmtHour(h + 1)}`,
                          usagePct: Math.min(Math.round(ratio * 100), 100),
                          level,
                          taskName: task.title,
                        })
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

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
