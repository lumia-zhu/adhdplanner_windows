/**
 * WeekRhythmChart —— 周平均节奏曲线 + 多天对比
 *
 * 默认显示 7 天每小时取平均的曲线（绿色实线 + 面积填充）。
 * 右上角"选择对比日"下拉按钮，选中某天后用彩色线叠加，周平均线变灰色虚线。
 * 最多同时选 3 天。
 */

import { useMemo, useState, useRef, useEffect } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { WeekDayData } from './WeekView'
import type { TrackEvent } from '../services/tracker/types'

// ===================== 常量 =====================

const W = 400
const H = 104
const PAD_L = 40
const PAD_R = 4
const PAD_T = 14
const PAD_B = 12
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

/** 周热力图需要加的左右 padding 百分比，保证和折线图绘图区对齐 */
export const WEEK_PAD_LEFT_PCT = `${(PAD_L / W) * 100}%`
export const WEEK_PAD_RIGHT_PCT = `${(PAD_R / W) * 100}%`

const EXPECTED_RECORDS_PER_HOUR = 120
const MAX_COMPARE = 3

/** 7 种预设颜色（用于对比线） */
const LINE_COLORS = [
  '#3b82f6', // 蓝
  '#f97316', // 橙
  '#8b5cf6', // 紫
  '#ef4444', // 红
  '#06b6d4', // 青
  '#ec4899', // 粉
  '#84cc16', // 黄绿
]

// ===================== 工具函数 =====================

/** 将一天的 ActivityRecord 聚合为 24 小时各自的活跃占比（0~100%） */
function toHourlyUsage(data: ActivityRecord[]): number[] {
  const buckets = Array.from({ length: 24 }, () => 0)
  for (const r of data) {
    const h = new Date(r.ts).getHours()
    buckets[h] += getActiveRatio(r)
  }
  return buckets.map(total => Math.min((total / EXPECTED_RECORDS_PER_HOUR) * 60, 60))
}

/** 将小时数据转为坐标点数组（支持动态 maxVal） */
function toPoints(hourly: number[], start: number, count: number, maxVal: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const h = start + i
    const x = PAD_L + ((i + 0.5) / count) * CHART_W
    const y = PAD_T + CHART_H - ((hourly[h] ?? 0) / maxVal) * CHART_H
    pts.push({ x, y })
  }
  return pts
}

/** Catmull-Rom → cubic bezier 平滑曲线（控制点 clamp 防过冲） */
function toSmoothLinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  const tension = 0.3
  const yMin = PAD_T
  const yMax = PAD_T + CHART_H
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y))
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(i + 2, pts.length - 1)]
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = clampY(p1.y + (p2.y - p0.y) * tension)
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = clampY(p2.y - (p3.y - p1.y) * tension)
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** 两条边界线之间的闭合堆叠面积 path */
function toStackedAreaPath(
  upperPts: { x: number; y: number }[],
  lowerPts: { x: number; y: number }[],
): string {
  if (upperPts.length < 2) return ''
  const upper = toSmoothLinePath(upperPts)
  const lowerReversed = [...lowerPts].reverse()
  const lower = toSmoothLinePath(lowerReversed)
  return `${upper} L${lower.substring(1)} Z`
}

/** 平滑曲线 → 闭合到基线的面积 path（无选中时用） */
function toBaseAreaPath(linePath: string, pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  const bottom = PAD_T + CHART_H
  return `${linePath} L ${pts[pts.length - 1].x} ${bottom} L ${pts[0].x} ${bottom} Z`
}

/** 根据最大值计算合适的 y 轴刻度 */
function computeYAxis(maxTotal: number): { maxVal: number; yTicks: number[] } {
  if (maxTotal <= 0) return { maxVal: 60, yTicks: [0, 15, 30, 45, 60] }
  const candidates = [30, 60, 90, 120, 150, 180, 240, 300, 360, 420]
  const maxVal = candidates.find(c => c >= maxTotal * 1.1) ?? Math.ceil(maxTotal / 60) * 60
  const step = maxVal <= 60 ? 15 : maxVal <= 120 ? 30 : 60
  const ticks: number[] = []
  for (let v = 0; v <= maxVal; v += step) ticks.push(v)
  return { maxVal, yTicks: ticks }
}

// ===================== 卡顿点 =====================

interface CompareStuckPoint {
  date: string
  color: string
  x: number
  timestamp: number
  timeLabel: string
  taskTitle: string
  microAction: string
  reason: string
  resolved: boolean
}

/** 从某天的 events 中提取卡顿点信息 */
function extractStuckPoints(
  events: TrackEvent[],
  rangeStart: number,
  rangeEnd: number
): Omit<CompareStuckPoint, 'date' | 'color' | 'x'>[] {
  const sessionTaskMap = new Map<string, string>()
  for (const e of events) {
    if (e.type === 'session.started') {
      const p = e.payload as { sessionId: string; taskTitle: string }
      if (p.taskTitle) sessionTaskMap.set(p.sessionId, p.taskTitle)
    }
  }

  const resolveEvents = new Map<string, number[]>()
  for (const e of events) {
    if (
      e.type === 'stuck.pivot_chosen' ||
      e.type === 'exec.micro_started' ||
      e.type === 'exec.micro_completed' ||
      e.type === 'exec.flow_entered'
    ) {
      const p = e.payload as { sessionId?: string }
      if (p.sessionId) {
        if (!resolveEvents.has(p.sessionId)) resolveEvents.set(p.sessionId, [])
        resolveEvents.get(p.sessionId)!.push(e.timestamp)
      }
    }
  }

  const pts: Omit<CompareStuckPoint, 'date' | 'color' | 'x'>[] = []
  for (const e of events) {
    if (e.type !== 'stuck.triggered') continue
    const p = e.payload as { sessionId: string; microAction: string; elapsedSeconds: number }
    const taskTitle = sessionTaskMap.get(p.sessionId) || '未知任务'

    const d = new Date(e.timestamp)
    const hourFraction = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
    if (hourFraction < rangeStart || hourFraction >= rangeEnd) continue

    const timeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

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

    const resolves = resolveEvents.get(p.sessionId) || []
    const resolved = resolves.some(ts => ts > e.timestamp)

    pts.push({ timestamp: e.timestamp, timeLabel, taskTitle, microAction: p.microAction, reason, resolved })
  }

  return pts.sort((a, b) => a.timestamp - b.timestamp)
}

// ===================== Props =====================

interface Props {
  days: WeekDayData[]
  rangeStart?: number
  rangeEnd?: number
}

// ===================== 主组件 =====================

export default function WeekRhythmChart({ days, rangeStart: rs, rangeEnd: re }: Props) {
  const rangeStart = rs ?? 0
  const rangeEnd = re ?? 24
  const visibleHours = rangeEnd - rangeStart
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const [hoveredStuck, setHoveredStuck] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭下拉
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [dropdownOpen])

  // ---- 各天的小时数据 ----
  const dayHourly = useMemo(() => {
    return days.map(d => ({
      date: d.date,
      dateLabel: d.dateLabel,
      weekdayShort: d.weekdayShort,
      dateFull: d.dateFull,
      hasData: d.hasData,
      hourly: toHourlyUsage(d.activity),
    }))
  }, [days])

  // ---- 是否有选中天 ----
  const hasCompare = selectedDates.length > 0

  // ---- 堆叠数据计算 ----
  interface StackLayer {
    label: string
    color: string
    hourly: number[]       // 该层自身的值（0~60）
    cumulativeTop: number[] // 该层累计顶部（用于绘图）
    isRemaining: boolean
    date?: string
  }

  const stackedData = useMemo(() => {
    const withData = dayHourly.filter(d => d.hasData)
    const selected = selectedDates
      .map(date => withData.find(d => d.date === date))
      .filter(Boolean) as typeof dayHourly
    const remaining = withData.filter(d => !selectedDates.includes(d.date))

    const layers: StackLayer[] = []
    const cumulative = Array(24).fill(0)

    // 选中天在底部，每天一层
    for (const day of selected) {
      const bottom = [...cumulative]
      for (let h = 0; h < 24; h++) cumulative[h] += day.hourly[h]
      layers.push({
        label: `${day.dateLabel} ${day.weekdayShort}`,
        color: LINE_COLORS[selectedDates.indexOf(day.date) % LINE_COLORS.length],
        hourly: day.hourly,
        cumulativeTop: [...cumulative],
        isRemaining: false,
        date: day.date,
      })
    }

    // 剩余天合并为一层，放在最上面
    const remainingHourly = Array(24).fill(0) as number[]
    for (const day of remaining) {
      for (let h = 0; h < 24; h++) remainingHourly[h] += day.hourly[h]
    }
    if (remaining.length > 0) {
      for (let h = 0; h < 24; h++) cumulative[h] += remainingHourly[h]
      layers.push({
        label: hasCompare ? `其他 ${remaining.length} 天` : '周合计',
        color: hasCompare ? '#d1d5db' : '#10b981',
        hourly: remainingHourly,
        cumulativeTop: [...cumulative],
        isRemaining: true,
      })
    }

    return { layers, totalHourly: cumulative as number[] }
  }, [dayHourly, selectedDates, hasCompare])

  // ---- 动态 y 轴 ----
  const { maxVal, yTicks } = useMemo(() => {
    const maxTotal = Math.max(...stackedData.totalHourly.slice(rangeStart, rangeEnd))
    return computeYAxis(maxTotal)
  }, [stackedData, rangeStart, rangeEnd])

  // ---- 堆叠面积 paths ----
  const layerPaths = useMemo(() => {
    return stackedData.layers.map((layer, idx) => {
      const topPts = toPoints(layer.cumulativeTop, rangeStart, visibleHours, maxVal)
      if (idx === 0) {
        const linePath = toSmoothLinePath(topPts)
        return { ...layer, path: toBaseAreaPath(linePath, topPts), topPts }
      }
      const prevTop = stackedData.layers[idx - 1].cumulativeTop
      const bottomPts = toPoints(prevTop, rangeStart, visibleHours, maxVal)
      return { ...layer, path: toStackedAreaPath(topPts, bottomPts), topPts }
    })
  }, [stackedData, rangeStart, visibleHours, maxVal])

  // ---- 卡顿点（选中天上） ----
  const compareStuckPoints = useMemo(() => {
    if (selectedDates.length === 0) return []
    const result: CompareStuckPoint[] = []
    for (let idx = 0; idx < selectedDates.length; idx++) {
      const date = selectedDates[idx]
      const dayData = days.find(d => d.date === date)
      if (!dayData || !dayData.events || dayData.events.length === 0) continue
      const color = LINE_COLORS[idx % LINE_COLORS.length]
      const rawPts = extractStuckPoints(dayData.events, rangeStart, rangeEnd)
      for (const pt of rawPts) {
        const d = new Date(pt.timestamp)
        const hourFraction = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
        const x = PAD_L + ((hourFraction - rangeStart) / visibleHours) * CHART_W
        result.push({ ...pt, date, color, x })
      }
    }
    return result
  }, [selectedDates, days, rangeStart, rangeEnd, visibleHours])

  // ---- 周合计高峰（总和最高的小时段） ----
  const peakHour = useMemo(() => {
    let peak = rangeStart, peakVal = 0
    for (let h = rangeStart; h < rangeEnd; h++) {
      if (stackedData.totalHourly[h] > peakVal) {
        peakVal = stackedData.totalHourly[h]
        peak = h
      }
    }
    return { hour: peak, val: peakVal }
  }, [stackedData, rangeStart, rangeEnd])

  // ---- 切换选中日期 ----
  const toggleDate = (date: string) => {
    setSelectedDates(prev => {
      if (prev.includes(date)) return prev.filter(d => d !== date)
      if (prev.length >= MAX_COMPARE) return prev // 超出限制
      return [...prev, date]
    })
  }

  // ---- 每小时段信息（hover 用） ----
  const hourSlots = useMemo(() => {
    const slots: { hour: number; x: number; colX: number; colW: number }[] = []
    const colW = CHART_W / visibleHours
    for (let i = 0; i < visibleHours; i++) {
      const h = rangeStart + i
      const colX = PAD_L + (i / visibleHours) * CHART_W
      const x = colX + colW / 2
      slots.push({ hour: h, x, colX, colW })
    }
    return slots
  }, [rangeStart, visibleHours])

  const daysWithData = dayHourly.filter(d => d.hasData)
  if (daysWithData.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        近 7 天暂无使用数据
      </div>
    )
  }

  return (
    <div>
      {/* 对比按钮（左） + 层图例（右） — 折线图上方 */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(v => !v)}
            className={`text-2xs px-2 py-1 rounded-md border transition-colors
              ${selectedDates.length > 0
                ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
          >
            {selectedDates.length > 0 ? `对比 ${selectedDates.length} 天` : '选择对比日'}
            <svg className={`inline-block w-2.5 h-2.5 ml-0.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]">
              {dayHourly.map((d) => {
                const isSelected = selectedDates.includes(d.date)
                const isDisabled = !d.hasData || (!isSelected && selectedDates.length >= MAX_COMPARE)
                return (
                  <button
                    key={d.date}
                    onClick={() => !isDisabled && toggleDate(d.date)}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xxs text-left transition-colors
                      ${isDisabled ? 'text-gray-300 cursor-not-allowed' : 'hover:bg-gray-50'}
                      ${isSelected ? 'bg-indigo-50' : ''}`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0 border"
                      style={{
                        backgroundColor: isSelected
                          ? LINE_COLORS[selectedDates.indexOf(d.date) % LINE_COLORS.length]
                          : 'transparent',
                        borderColor: isSelected
                          ? LINE_COLORS[selectedDates.indexOf(d.date) % LINE_COLORS.length]
                          : '#d1d5db',
                      }}
                    />
                    <span className={isSelected ? 'text-gray-700 font-medium' : 'text-gray-600'}>
                      {d.dateLabel} {d.weekdayShort}
                    </span>
                    {!d.hasData && <span className="text-3xs text-gray-300 ml-auto">无数据</span>}
                  </button>
                )
              })}
              {selectedDates.length >= MAX_COMPARE && (
                <p className="text-3xs text-amber-500 px-3 py-1 border-t border-gray-100">
                  最多同时对比 {MAX_COMPARE} 天
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {layerPaths.map(lp => (
            <span key={lp.label} className="flex items-center gap-1 text-2xs text-gray-500">
              <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: lp.color, opacity: lp.isRemaining ? 0.5 : 0.7 }} />
              {lp.label}
            </span>
          ))}
        </div>
      </div>

      {/* 高峰信息 — 折线图上方 */}
      <div className="flex items-center justify-between mb-1.5 flex-wrap">
        {peakHour.val > 0 && (
          <span className="flex items-center gap-1 text-xxs text-gray-500">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            周使用高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00~{peakHour.hour + 1}:00</span>
            <span className="text-gray-400 ml-1">（周合计活跃 {Math.round(peakHour.val)} 分钟）</span>
          </span>
        )}
      </div>

      {/* SVG 图表 */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ aspectRatio: `${W}/${H}` }}>
        {/* 渐变定义 */}
        <defs>
          {layerPaths.map((lp, idx) => (
            <linearGradient key={idx} id={`weekStackGrad${idx}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lp.color} stopOpacity={lp.isRemaining ? 0.35 : 0.65} />
              <stop offset="100%" stopColor={lp.color} stopOpacity={lp.isRemaining ? 0.08 : 0.15} />
            </linearGradient>
          ))}
        </defs>

        {/* 背景网格线 + y 轴标签 */}
        {yTicks.map((tickVal, i) => {
          const ratio = tickVal / maxVal
          const y = PAD_T + CHART_H * (1 - ratio)
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray={i === 0 ? undefined : '2,2'}
              />
              <text x={PAD_L - 3} y={y + 3} textAnchor="end" fontSize={9} fill="#6b7280" fontWeight="500">
                {tickVal === 0 ? '0' : `${tickVal}分钟`}
              </text>
            </g>
          )
        })}

        {/* 堆叠面积层（从底层到顶层渲染） */}
        {layerPaths.map((lp, idx) => (
          <path
            key={idx}
            d={lp.path}
            fill={`url(#weekStackGrad${idx})`}
            stroke={lp.color}
            strokeWidth={idx === layerPaths.length - 1 ? 1.5 : 0.8}
            strokeOpacity={0.6}
            strokeLinejoin="round"
          />
        ))}

        {/* 每小时段 hover 交互（垂直高亮带 + tooltip） */}
        {hourSlots.map(slot => {
          const isHovered = hovered === slot.hour
          return (
            <g key={slot.hour}>
              <rect
                x={slot.colX} y={PAD_T} width={slot.colW} height={CHART_H}
                fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(slot.hour)}
                onMouseLeave={() => setHovered(null)}
              />
              {isHovered && (
                <g pointerEvents="none">
                  <rect
                    x={slot.colX} y={PAD_T} width={slot.colW} height={CHART_H}
                    fill="#6b7280" opacity={0.06} rx={1}
                  />
                  {(() => {
                    const nextHour = (slot.hour + 1) % 24
                    const header = `${slot.hour}:00~${nextHour}:00`
                    const nonZeroLayers = layerPaths.filter(lp => lp.hourly[slot.hour] > 0)
                    const details = nonZeroLayers
                      .filter(lp => !lp.isRemaining || hasCompare)
                      .map(lp => `${lp.label}: ${Math.round(lp.hourly[slot.hour])}分钟`)
                    const total = Math.round(stackedData.totalHourly[slot.hour])
                    const allLines = hasCompare
                      ? [header, ...details, `合计: ${total}分钟`]
                      : [header, `合计: ${total}分钟`]
                    const measureTextW = (s: string) => [...s].reduce((w, c) => w + (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c) ? 5.5 : 3.5), 0)
                    const boxW = Math.max(...allLines.map(l => measureTextW(l) + 16), 80)
                    const lineH = 13
                    const boxH = allLines.length * lineH + 8
                    const tipX = Math.max(PAD_L, Math.min(slot.x - boxW / 2, W - PAD_R - boxW))
                    const tipY = Math.max(0, PAD_T - boxH - 2)
                    return (
                      <g>
                        <rect x={tipX} y={tipY} width={boxW} height={boxH}
                          rx={4} fill="#1f2937" opacity={0.92} />
                        {allLines.map((line, li) => {
                          const isHeader = li === 0
                          const isTotal = li === allLines.length - 1
                          return (
                            <text key={li}
                              x={tipX + 8} y={tipY + 12 + li * lineH}
                              fontSize={isHeader ? 8.5 : isTotal ? 9.5 : 7.5} fill="white"
                              fontWeight={isHeader || isTotal ? '700' : '400'}
                              opacity={1}
                            >
                              {line}
                            </text>
                          )
                        })}
                      </g>
                    )
                  })()}
                </g>
              )}
            </g>
          )
        })}

        {/* 选中天上的卡顿红色圆点标记 */}
        {compareStuckPoints.map((sp, idx) => {
          const isHov = hoveredStuck === idx
          const layerIdx = selectedDates.indexOf(sp.date)
          if (layerIdx < 0) return null
          const layer = stackedData.layers[layerIdx]
          if (!layer) return null

          const layerTopPts = toPoints(layer.cumulativeTop, rangeStart, visibleHours, maxVal)
          let lineY = PAD_T + CHART_H
          const leftPt = layerTopPts.filter(p => p.x <= sp.x).at(-1)
          const rightPt = layerTopPts.find(p => p.x > sp.x)
          if (leftPt && rightPt) {
            const t = (sp.x - leftPt.x) / (rightPt.x - leftPt.x)
            lineY = leftPt.y + t * (rightPt.y - leftPt.y)
          } else if (leftPt) {
            lineY = leftPt.y
          } else if (rightPt) {
            lineY = rightPt.y
          }

          const dotR = isHov ? 5 : 3.5
          return (
            <g key={`cstuck-${idx}`}>
              <circle
                cx={sp.x} cy={lineY} r={dotR}
                fill="white" stroke="#ef4444" strokeWidth={1.5}
                opacity={isHov ? 1 : 0.85}
                style={{ transition: 'all 0.15s', cursor: 'pointer' }}
              />
              <circle
                cx={sp.x} cy={lineY} r={8}
                fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredStuck(idx)}
                onMouseLeave={() => setHoveredStuck(null)}
              />
              {isHov && (() => {
                const lines = [
                  sp.timeLabel + ' · ' + sp.taskTitle,
                  ...(sp.reason ? ['原因：' + sp.reason] : []),
                ]
                const measureTextW = (s: string) => [...s].reduce((w, c) => w + (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c) ? 11 : 6), 0)
                const boxW = Math.max(...lines.map(l => measureTextW(l) + 20), 100)
                const boxH = lines.length * 16 + 10
                const boxX = Math.max(0, Math.min(sp.x - boxW / 2, W - boxW))
                const showBelow = lineY - dotR - boxH - 4 < 0
                const boxY = showBelow ? lineY + dotR + 4 : lineY - dotR - boxH - 4
                return (
                  <g>
                    <rect x={boxX} y={boxY} width={boxW} height={boxH}
                      rx={4} fill="#1f2937" opacity={0.92} />
                    {lines.map((line, li) => (
                      <text key={li}
                        x={boxX + 8} y={boxY + 15 + li * 16}
                        fontSize={10} fill="white"
                        fontWeight={li === 0 ? '600' : '400'}
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                )
              })()}
            </g>
          )
        })}
        {/* x 轴标签 */}
        {Array.from({ length: visibleHours + 1 }, (_, i) => {
          const h = (rangeStart + i) % 24
          const x = PAD_L + (i / visibleHours) * CHART_W
          return (
            <text
              key={i}
              x={x}
              y={PAD_T + CHART_H + 12}
              textAnchor="middle"
              fontSize={8}
              fill="#9ca3af"
              fontWeight="500"
            >
              {h}
            </text>
          )
        })}
      </svg>

    </div>
  )
}
