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
const H = 120
const PAD_L = 28
const PAD_R = 4
const PAD_T = 18
const PAD_B = 20
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

/** 周热力图需要加的左右 padding 百分比，保证和折线图绘图区对齐 */
export const WEEK_PAD_LEFT_PCT = `${(PAD_L / W) * 100}%`
export const WEEK_PAD_RIGHT_PCT = `${(PAD_R / W) * 100}%`

const MAX_VAL = 100
const Y_TICKS = [0, 25, 50, 75, 100]

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
  return buckets.map(total => Math.min((total / EXPECTED_RECORDS_PER_HOUR) * 100, 100))
}

/** 可见范围内的折线 path d（点在每个小时区间的中点） */
function toLinePath(hourly: number[], start: number, count: number): string {
  const pts: string[] = []
  for (let i = 0; i < count; i++) {
    const h = start + i
    const x = PAD_L + ((i + 0.5) / count) * CHART_W
    const y = PAD_T + CHART_H - (hourly[h] / MAX_VAL) * CHART_H
    pts.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`)
  }
  return pts.join(' ')
}

/** 折线 path → 闭合面积 path */
function toAreaPath(linePath: string, start: number, count: number): string {
  if (count === 0) return ''
  const firstX = PAD_L + (0.5 / count) * CHART_W
  const lastX = PAD_L + ((count - 0.5) / count) * CHART_W
  const bottom = PAD_T + CHART_H
  return `${linePath} L ${lastX} ${bottom} L ${firstX} ${bottom} Z`
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

  // ---- 周平均 ----
  const avgHourly = useMemo(() => {
    const sums = Array(24).fill(0)
    const counts = Array(24).fill(0)
    for (const d of dayHourly) {
      if (!d.hasData) continue
      d.hourly.forEach((v, h) => {
        sums[h] += v
        counts[h]++
      })
    }
    return sums.map((s, h) => (counts[h] > 0 ? s / counts[h] : 0))
  }, [dayHourly])

  // ---- 是否有对比线 ----
  const hasCompare = selectedDates.length > 0

  // ---- 周平均折线 path ----
  const avgLinePath = toLinePath(avgHourly, rangeStart, visibleHours)
  const avgAreaPath = toAreaPath(avgLinePath, rangeStart, visibleHours)

  // ---- 对比线 paths ----
  const compareLines = useMemo(() => {
    return selectedDates.map((date, idx) => {
      const dh = dayHourly.find(d => d.date === date)
      if (!dh) return null
      return {
        date,
        label: `${dh.dateLabel} ${dh.weekdayShort}`,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        hourly: dh.hourly,
        path: toLinePath(dh.hourly, rangeStart, visibleHours),
      }
    }).filter(Boolean) as { date: string; label: string; color: string; hourly: number[]; path: string }[]
  }, [selectedDates, dayHourly, rangeStart, visibleHours])

  // ---- 对比线上的卡顿点 ----
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

  // ---- 高峰时段（限定在可见范围内） ----
  const peakHour = useMemo(() => {
    let peak = rangeStart, peakVal = 0
    for (let h = rangeStart; h < rangeEnd; h++) {
      if (avgHourly[h] > peakVal) { peakVal = avgHourly[h]; peak = h }
    }
    return { hour: peak, val: peakVal }
  }, [avgHourly, rangeStart, rangeEnd])

  // ---- 切换选中日期 ----
  const toggleDate = (date: string) => {
    setSelectedDates(prev => {
      if (prev.includes(date)) return prev.filter(d => d !== date)
      if (prev.length >= MAX_COMPARE) return prev // 超出限制
      return [...prev, date]
    })
  }

  // ---- 可见范围内的点坐标（点在每个小时区间的中点） ----
  const avgPoints = useMemo(() => {
    const pts: { x: number; y: number; hour: number; val: number }[] = []
    for (let i = 0; i < visibleHours; i++) {
      const h = rangeStart + i
      const x = PAD_L + ((i + 0.5) / visibleHours) * CHART_W
      const y = PAD_T + CHART_H - (avgHourly[h] / MAX_VAL) * CHART_H
      pts.push({ x, y, hour: h, val: avgHourly[h] })
    }
    return pts
  }, [avgHourly, rangeStart, visibleHours])

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
      {/* SVG 图表（左侧占位与热力图日期标签对齐） */}
      <div className="flex items-center gap-1">
        <span className="w-[38px] flex-shrink-0" />
        <div className="flex-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {/* 渐变定义 */}
        <defs>
          <linearGradient id="weekAvgGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* 背景网格线 */}
        {Y_TICKS.map((tickVal, i) => {
          const ratio = tickVal / MAX_VAL
          const y = PAD_T + CHART_H * (1 - ratio)
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray={i === 0 ? undefined : '2,2'}
              />
              <text x={PAD_L - 3} y={y + 3} textAnchor="end" fontSize={9} fill="#6b7280" fontWeight="500">
                {tickVal}%
              </text>
            </g>
          )
        })}

        {/* x 轴标签（每小时边界处） */}
        {Array.from({ length: visibleHours + 1 }, (_, i) => {
          const h = rangeStart + i
          const x = PAD_L + (i / visibleHours) * CHART_W
          return (
            <text key={h} x={x} y={H - 4} textAnchor="middle" fontSize={9} fill="#6b7280">
              {h % 24}
            </text>
          )
        })}

        {/* 周平均面积填充（只在没有对比线时显示，有对比线时隐藏，保持清晰） */}
        {!hasCompare && (
          <path d={avgAreaPath} fill="url(#weekAvgGradient)" opacity={0.3} />
        )}

        {/* 周平均折线 */}
        <path
          d={avgLinePath}
          fill="none"
          stroke={hasCompare ? '#9ca3af' : '#10b981'}
          strokeWidth={hasCompare ? 1.2 : 1.8}
          strokeLinejoin="round"
          strokeDasharray={hasCompare ? '4,3' : undefined}
        />

        {/* 对比线 */}
        {compareLines.map(cl => (
          <path
            key={cl.date}
            d={cl.path}
            fill="none"
            stroke={cl.color}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
        ))}

        {/* 数据点 + 悬停区域（只给周平均线，避免太杂） */}
        {avgPoints.map(p => {
          const isHovered = hovered === p.hour
          return (
            <g key={p.hour}>
              {/* 周平均点 */}
              <circle
                cx={p.x} cy={p.y}
                r={isHovered ? 4.5 : p.val > 0 ? 3 : 2.5}
                fill={hasCompare ? '#9ca3af' : (p.val > 0 ? '#10b981' : '#d1d5db')}
                stroke="white" strokeWidth={isHovered ? 1.8 : 1}
              />
              {/* 悬停热区 */}
              <circle
                cx={p.x} cy={p.y} r={8} fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(p.hour)}
                onMouseLeave={() => setHovered(null)}
              />
              {/* tooltip */}
              {isHovered && (() => {
                const showBelow = p.y - PAD_T < 20
                const nextHour = (p.hour + 1) % 24
                const lines: string[] = [`${Math.round(p.val)}%`]
                for (const cl of compareLines) {
                  lines.push(`${cl.label} ${Math.round(cl.hourly[p.hour])}%`)
                }
                const text = `${p.hour}:00~${nextHour}:00 · ${lines.join(' | ')}`
                const textWidth = Math.min(text.length * 4.5, 240)
                const boxH = 18
                const ty = showBelow ? p.y + 10 : p.y - 24
                const textY = showBelow ? p.y + 21.5 : p.y - 12.5

                return (
                  <g>
                    <rect
                      x={Math.max(PAD_L, Math.min(p.x - textWidth / 2, W - PAD_R - textWidth))}
                      y={ty}
                      width={textWidth}
                      height={boxH}
                      rx={4} fill="#1f2937" opacity={0.88}
                    />
                    <text
                      x={p.x} y={textY}
                      textAnchor="middle" fontSize={8} fill="white" fontWeight="500"
                    >
                      {text}
                    </text>
                  </g>
                )
              })()}
            </g>
          )
        })}

        {/* 对比线的数据点（悬停时显示） */}
        {hovered !== null && compareLines.map(cl => {
          const val = cl.hourly[hovered]
          const idx = hovered - rangeStart
          const x = PAD_L + ((idx + 0.5) / visibleHours) * CHART_W
          const y = PAD_T + CHART_H - (val / MAX_VAL) * CHART_H
          return (
            <circle
              key={cl.date}
              cx={x} cy={y} r={4}
              fill={cl.color} stroke="white" strokeWidth={1.8}
            />
          )
        })}

        {/* 对比线上的卡顿红色圆点标记 */}
        {compareStuckPoints.map((sp, idx) => {
          const isHov = hoveredStuck === idx
          const cl = compareLines.find(c => c.date === sp.date)
          if (!cl) return null

          // 在对比线的相邻两点间线性插值得到精确 y
          let lineY = PAD_T + CHART_H
          const linePoints = cl.hourly.slice(rangeStart, rangeStart + visibleHours).map((val, i) => ({
            x: PAD_L + ((i + 0.5) / visibleHours) * CHART_W,
            y: PAD_T + CHART_H - (val / MAX_VAL) * CHART_H,
          }))
          const leftPt = linePoints.filter(p => p.x <= sp.x).at(-1)
          const rightPt = linePoints.find(p => p.x > sp.x)
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
                cx={sp.x} cy={lineY}
                r={dotR}
                fill="#ef4444" stroke="white" strokeWidth={1}
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
      </svg>
        </div>
      </div>

      {/* 对比按钮（左） + 图例（右） */}
      <div className="flex items-center justify-between mt-1">
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
            <div className="absolute left-0 bottom-full mb-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]">
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
          <span className="flex items-center gap-1 text-2xs text-gray-400">
            <span className={`inline-block w-4 h-[2px] ${hasCompare ? 'border-t border-dashed border-gray-400' : 'bg-emerald-500 rounded'}`} />
            周平均
          </span>
          {compareLines.map(cl => (
            <span key={cl.date} className="flex items-center gap-1 text-2xs text-gray-500">
              <span className="inline-block w-4 h-[2px] rounded" style={{ backgroundColor: cl.color }} />
              {cl.label}
            </span>
          ))}
        </div>
      </div>

      {/* 高峰信息 */}
      {peakHour.val > 0 && (
        <p className="text-xxs text-gray-500 mt-1">
          🌟 周平均使用高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00</span>
          <span className="text-gray-400 ml-1">（{Math.round(peakHour.val)}% 活跃度）</span>
        </p>
      )}
    </div>
  )
}
