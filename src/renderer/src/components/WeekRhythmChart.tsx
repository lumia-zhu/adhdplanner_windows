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

// ===================== 常量 =====================

const W = 400
const H = 120
const PAD_L = 32
const PAD_R = 8
const PAD_T = 18
const PAD_B = 20
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

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
      {/* SVG 图表 */}
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
              <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#9ca3af">
                {tickVal}%
              </text>
            </g>
          )
        })}

        {/* x 轴标签（在小时边界处，与热力图刻度对齐） */}
        {(() => {
          const step = visibleHours <= 10 ? 2 : 3
          const labels: { hour: number; x: number }[] = []
          for (let h = rangeStart; h <= rangeEnd; h += step) {
            labels.push({ hour: h, x: PAD_L + ((h - rangeStart) / visibleHours) * CHART_W })
          }
          return labels.map(l => (
            <text key={l.hour} x={l.x} y={H - 4} textAnchor="middle" fontSize={7} fill="#9ca3af">
              {l.hour % 24}
            </text>
          ))
        })()}

        {/* 周平均面积填充（只在没有对比线时显示，有对比线时隐藏，保持清晰） */}
        {!hasCompare && (
          <path d={avgAreaPath} fill="url(#weekAvgGradient)" opacity={0.3} />
        )}

        {/* 周平均折线 */}
        <path
          d={avgLinePath}
          fill="none"
          stroke={hasCompare ? '#9ca3af' : '#10b981'}
          strokeWidth={hasCompare ? 1 : 1.5}
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
            strokeWidth={1.5}
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
                r={isHovered ? 3 : p.val > 0 ? 2 : 1.5}
                fill={hasCompare ? '#9ca3af' : (p.val > 0 ? '#10b981' : '#d1d5db')}
                stroke="white" strokeWidth={isHovered ? 1.5 : 0.8}
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
                // 计算 tooltip 内容
                const lines: string[] = [`均值 ${Math.round(p.val)}%`]
                for (const cl of compareLines) {
                  lines.push(`${cl.label} ${Math.round(cl.hourly[p.hour])}%`)
                }
                const text = `${p.hour}:00 · ${lines.join(' | ')}`
                const textWidth = Math.min(text.length * 3.5, 160)
                const ty = showBelow ? p.y + 10 : p.y - 20
                const textY = showBelow ? p.y + 19.5 : p.y - 10.5

                return (
                  <g>
                    <rect
                      x={Math.max(PAD_L, Math.min(p.x - textWidth / 2, W - PAD_R - textWidth))}
                      y={ty}
                      width={textWidth}
                      height={14}
                      rx={3} fill="#1f2937" opacity={0.85}
                    />
                    <text
                      x={p.x} y={textY}
                      textAnchor="middle" fontSize={6} fill="white" fontWeight="500"
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
              cx={x} cy={y} r={3}
              fill={cl.color} stroke="white" strokeWidth={1.5}
            />
          )
        })}
      </svg>

      {/* 图例 */}
      <div className="flex items-center justify-between mt-1">
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
            <div className="absolute right-0 bottom-full mb-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]">
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
