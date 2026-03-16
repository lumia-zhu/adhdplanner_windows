/**
 * InteractiveActivityHeatmap —— 交互式活动热力图 + 任务时间分布
 *
 * 上半部分：24 小时热力条（和 ActivityHeatmap 相同），支持选区交互
 * 下半部分：任务时间分布
 *   - 任务名独占一行（左对齐）
 *   - 24 格时间条紧跟其下，占满全宽，和热力条完美对齐
 *   - 色块宽度按实际活跃比例显示
 */

import { useMemo, useState, useCallback, useRef } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { TrackEvent } from '../services/tracker'

// ===================== 常量 =====================

const TOTAL_BLOCKS = 24
const EXPECTED_RECORDS_PER_BLOCK = 120

function ratioToLevel(usageRatio: number): number {
  if (usageRatio <= 0) return 0
  if (usageRatio <= 0.33) return 1
  if (usageRatio <= 0.67) return 2
  return 3
}

const LEVEL_COLORS = [
  'bg-gray-100',       // 0: 未使用
  'bg-emerald-200',    // 1: 低
  'bg-emerald-400',    // 2: 中
  'bg-emerald-600',    // 3: 高
]
const LEVEL_LABELS = ['未使用', '< 20 分钟', '20~40 分钟', '> 40 分钟']
const TIME_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

// ===================== 类型 =====================

interface Selection {
  start: number
  end: number
}

interface Props {
  data: ActivityRecord[]
  events: TrackEvent[]
}

// ===================== 工具函数 =====================

/**
 * 从事件流中提取每个任务在每个小时的活跃比例
 * 返回 Map<taskTitle, Map<hourIndex, ratio>>
 *   ratio 取值 0~1，表示该小时内任务实际活跃了多大比例
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
    const hourMap = result.get(title)!
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

function isInSelection(hour: number, sel: Selection | null): boolean {
  if (!sel) return false
  const lo = Math.min(sel.start, sel.end)
  const hi = Math.max(sel.start, sel.end)
  return hour >= lo && hour <= hi
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

/** 格式化比例为分钟文字（用于 tooltip） */
function ratioToMinuteStr(ratio: number): string {
  const min = Math.round(ratio * 60)
  return `${min} 分钟`
}

/**
 * 精确计算选区覆盖框的 left / width
 * flex gap-[2px] 布局中，24 个格子之间有 23 个 2px 间隙（共 46px）
 *   cellWidth = (100% - 46px) / 24
 *   cell[i] left = i * cellWidth + i * 2px
 *   span(lo→hi) width = count * cellWidth + (count-1) * 2px
 * padding: 在左右各多包一小段，让边框视觉上刚好贴住格子外缘
 */
function selOverlayStyle(lo: number, hi: number, pad = 0) {
  const GAP = 2          // gap-[2px]
  const TOTAL_GAP = (TOTAL_BLOCKS - 1) * GAP  // 46px
  const count = hi - lo + 1
  return {
    left:  `calc(${lo} * (100% - ${TOTAL_GAP}px) / ${TOTAL_BLOCKS} + ${lo * GAP - pad}px)`,
    width: `calc(${count} * (100% - ${TOTAL_GAP}px) / ${TOTAL_BLOCKS} + ${(count - 1) * GAP + pad * 2}px)`,
  }
}

// ===================== 主组件 =====================

export default function InteractiveActivityHeatmap({ data, events }: Props) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef<number | null>(null)

  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string; usageMinutes: number; level: number
  } | null>(null)

  // ---- 聚合热力条 ----
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
      const usageMinutes = Math.round(b.totalRatio * 0.5)
      return {
        index: i,
        avgUsageRatio,
        usageMinutes,
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
        // 计算总时长（分钟）
        let totalMinutes = 0
        hourMap.forEach(r => { totalMinutes += r * 60 })
        return { title, hourMap, totalMinutes: Math.round(totalMinutes) }
      })
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
  }, [taskHourRatioMap])

  const filteredTasks = useMemo(() => {
    if (!selection) return taskEntries
    const lo = Math.min(selection.start, selection.end)
    const hi = Math.max(selection.start, selection.end)
    return taskEntries.filter(t => {
      for (let h = lo; h <= hi; h++) {
        if (t.hourMap.has(h)) return true
      }
      return false
    })
  }, [taskEntries, selection])

  // ---- 选区交互 ----
  const handleBlockMouseDown = useCallback((hourIdx: number) => {
    if (selection && isInSelection(hourIdx, selection)) {
      setSelection(null)
      return
    }
    if (selection) {
      setSelection({
        start: Math.min(selection.start, hourIdx),
        end: Math.max(selection.end, hourIdx),
      })
      return
    }
    dragStartRef.current = hourIdx
    setIsDragging(true)
    setSelection({ start: hourIdx, end: hourIdx })
  }, [selection])

  const handleBlockMouseEnter = useCallback((hourIdx: number) => {
    if (isDragging && dragStartRef.current !== null) {
      setSelection({ start: dragStartRef.current, end: hourIdx })
    }
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    dragStartRef.current = null
  }, [])

  const clearSelection = useCallback(() => {
    setSelection(null)
  }, [])

  const selectionLabel = useMemo(() => {
    if (!selection) return null
    const lo = Math.min(selection.start, selection.end)
    const hi = Math.max(selection.start, selection.end)
    return `${fmtHour(lo)} – ${fmtHour(hi + 1 === 24 ? 0 : hi + 1)}`
  }, [selection])

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无使用数据（数据采集中…）
      </div>
    )
  }

  const selLo = selection ? Math.min(selection.start, selection.end) : -1
  const selHi = selection ? Math.max(selection.start, selection.end) : -1

  return (
    <div className="relative select-none" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>

      {/* ======== 图例 ======== */}
      <div className="flex items-center gap-3 mb-2.5 text-[10px] text-gray-400">
        <span>每小时使用时长：</span>
        {LEVEL_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* ======== 热力条：全宽 24 格 + 整体选区框 ======== */}
      <div className="relative flex gap-[2px] w-full">
        {blocks.map((block) => {
          const level = ratioToLevel(block.avgUsageRatio)
          const inSel = isInSelection(block.index, selection)

          // 有选区时，未选中的格子变淡
          const dimmed = selection && !inSel

          return (
            <div
              key={block.index}
              className={`h-7 flex-1 rounded-[3px] cursor-pointer transition-all
                          ${!isDragging ? 'hover:scale-y-110' : ''}
                          ${LEVEL_COLORS[level]}
                          ${dimmed ? 'opacity-30' : ''}`}
              onMouseDown={() => handleBlockMouseDown(block.index)}
              onMouseEnter={(e) => {
                handleBlockMouseEnter(block.index)
                if (!isDragging) {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setTooltip({
                    x: rect.left + rect.width / 2,
                    y: rect.top,
                    label: block.label,
                    usageMinutes: block.usageMinutes,
                    level,
                  })
                }
              }}
              onMouseLeave={() => { if (!isDragging) setTooltip(null) }}
            />
          )
        })}

        {/* 整体选区高亮框：精确对齐 flex gap 布局 */}
        {selection && (
          <div
            className="absolute top-0 h-full border-2 border-emerald-500/70 rounded-lg pointer-events-none"
            style={selOverlayStyle(selLo, selHi, 3)}
          />
        )}
      </div>

      {/* ======== 底部时间刻度 ======== */}
      <div className="relative w-full h-4 mt-1">
        {TIME_TICKS.map((h) => {
          const pct = (h / 24) * 100
          return (
            <span
              key={h}
              className="absolute text-[9px] text-gray-400 tabular-nums"
              style={{
                left: `${pct}%`,
                transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {h === 24 ? '24:00' : `${String(h).padStart(2, '0')}:00`}
            </span>
          )
        })}
      </div>

      {/* ======== 任务时间分布 ======== */}
      {filteredTasks.length > 0 && (
        <div className="mt-3 space-y-2">
          {filteredTasks.map((task) => {
            // 计算选区内的时长
            let selectedMinutes = 0
            if (selection) {
              const lo = Math.min(selection.start, selection.end)
              const hi = Math.max(selection.start, selection.end)
              for (let h = lo; h <= hi; h++) {
                const r = task.hourMap.get(h) || 0
                selectedMinutes += r * 60
              }
              selectedMinutes = Math.round(selectedMinutes)
            }

            return (
              <div key={task.title}>
                {/* 第一行：任务名 + 时长 */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-gray-600 font-medium truncate max-w-[60%]" title={task.title}>
                    {task.title}
                  </span>
                  <span className="text-[10px] text-gray-400 tabular-nums flex-shrink-0 ml-2">
                    {selection
                      ? `${selectedMinutes} 分钟（选区内）/ 共 ${task.totalMinutes} 分钟`
                      : `共 ${task.totalMinutes} 分钟`
                    }
                  </span>
                </div>
                {/* 第二行：24 格时间条，全宽，和热力条对齐 */}
                <div className="relative flex gap-[2px] w-full">
                  {Array.from({ length: TOTAL_BLOCKS }, (_, h) => {
                    const ratio = task.hourMap.get(h) || 0
                    const hasActivity = ratio > 0
                    const inSel = isInSelection(h, selection)

                    let barColor: string
                    if (!hasActivity) {
                      barColor = ''
                    } else if (!selection) {
                      barColor = 'bg-emerald-400'
                    } else if (inSel) {
                      barColor = 'bg-emerald-400'
                    } else {
                      barColor = 'bg-gray-200'
                    }

                    return (
                      <div
                        key={h}
                        className={`h-[14px] flex-1 rounded-[2px] overflow-hidden relative group
                                    ${selection && inSel ? 'bg-emerald-50' : 'bg-gray-50'}`}
                        title={hasActivity ? `${fmtHour(h)}–${fmtHour(h + 1 === 24 ? 0 : h + 1)}：${ratioToMinuteStr(ratio)}` : ''}
                      >
                        {hasActivity && (
                          <div
                            className={`h-full rounded-[2px] transition-all duration-300 ${barColor}`}
                            style={{
                              width: `${Math.max(ratio * 100, 10)}%`,  // 最小 10% 保证可见
                            }}
                          />
                        )}
                      </div>
                    )
                  })}

                  {/* 选区范围高亮遮罩：精确对齐 flex gap 布局 */}
                  {selection && (
                    <div
                      className="absolute top-0 h-full rounded-[3px] bg-emerald-400/10 border border-emerald-300/40 pointer-events-none"
                      style={selOverlayStyle(selLo, selHi, 1)}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ======== 选区提示（放在所有任务下方） ======== */}
      {selectionLabel && (
        <div className="flex items-center gap-2 mt-3 text-xs">
          <span className="text-emerald-600 font-medium">已选择: {selectionLabel}</span>
          <button
            className="text-gray-400 hover:text-gray-600 underline underline-offset-2 text-[11px]"
            onClick={clearSelection}
          >
            清除
          </button>
        </div>
      )}

      {/* ======== 悬浮提示 ======== */}
      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-[10px]
                     shadow-lg pointer-events-none whitespace-nowrap"
          style={{
            left: tooltip.x,
            top: tooltip.y - 36,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="font-medium">{tooltip.label}</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>使用约 {tooltip.usageMinutes} / 60 分钟</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>{LEVEL_LABELS[tooltip.level]}</span>
        </div>
      )}
    </div>
  )
}
