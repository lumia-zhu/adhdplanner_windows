/**
 * ActivityRhythmChart —— 每日使用节奏曲线
 *
 * PAD_L / PAD_R 与热力图共享（通过 CSS 变量 / 导出常量），
 * 确保折线图绘图区与热力图方块区完全对齐。
 */

import { useMemo, useState } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'

interface Props {
  data: ActivityRecord[]
  rangeStart?: number
  rangeEnd?: number
}

const W = 400
const H = 110
const PAD_L = 28
const PAD_R = 4
const PAD_T = 14
const PAD_B = 18
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

/** 热力图需要加的左右 padding 百分比，保证和折线图绘图区对齐 */
export const HEATMAP_PAD_LEFT_PCT = `${(PAD_L / W) * 100}%`
export const HEATMAP_PAD_RIGHT_PCT = `${(PAD_R / W) * 100}%`

export default function ActivityRhythmChart({ data, rangeStart: rs, rangeEnd: re }: Props) {
  const rangeStart = rs ?? 0
  const rangeEnd = re ?? 24
  const visibleHours = rangeEnd - rangeStart

  const EXPECTED_RECORDS_PER_HOUR = 120

  const hourlyUsage = useMemo(() => {
    const buckets: { totalRatio: number; count: number }[] = Array.from({ length: 24 }, () => ({
      totalRatio: 0,
      count: 0,
    }))
    for (const r of data) {
      const h = new Date(r.ts).getHours()
      buckets[h].totalRatio += getActiveRatio(r)
      buckets[h].count++
    }
    return buckets.map(b => Math.min((b.totalRatio / EXPECTED_RECORDS_PER_HOUR) * 100, 100))
  }, [data])

  const maxVal = 100
  const yTicks = [0, 25, 50, 75, 100]

  const points = useMemo(() => {
    const pts: { x: number; y: number; hour: number; val: number }[] = []
    for (let i = 0; i < visibleHours; i++) {
      const h = rangeStart + i
      const x = PAD_L + ((i + 0.5) / visibleHours) * CHART_W
      const y = PAD_T + CHART_H - (hourlyUsage[h] / maxVal) * CHART_H
      pts.push({ x, y, hour: h, val: hourlyUsage[h] })
    }
    return pts
  }, [hourlyUsage, maxVal, rangeStart, visibleHours])

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${PAD_T + CHART_H} L ${points[0].x} ${PAD_T + CHART_H} Z`
    : ''

  const peakHour = useMemo(() => {
    let peak = rangeStart, peakVal = 0
    for (let h = rangeStart; h < rangeEnd; h++) {
      if (hourlyUsage[h] > peakVal) { peakVal = hourlyUsage[h]; peak = h }
    }
    return { hour: peak, val: peakVal }
  }, [hourlyUsage, rangeStart, rangeEnd])

  const [hovered, setHovered] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无使用数据（数据采集中…）
      </div>
    )
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ aspectRatio: `${W}/${H}`, maxHeight: 160 }}>
        {/* y 轴网格线 + 刻度 */}
        {yTicks.map((tickVal, i) => {
          const y = PAD_T + CHART_H * (1 - tickVal / maxVal)
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                stroke="#e5e7eb" strokeWidth={0.5}
                strokeDasharray={tickVal === 0 ? undefined : '2,2'}
              />
              <text x={PAD_L - 3} y={y + 3} textAnchor="end" fontSize={7.5} fill="#6b7280" fontWeight="500">
                {tickVal}%
              </text>
            </g>
          )
        })}

        {/* x 轴标签（在小时边界，与热力图对齐） */}
        {Array.from({ length: visibleHours + 1 }, (_, i) => {
          const h = rangeStart + i
          const x = PAD_L + (i / visibleHours) * CHART_W
          return (
            <text key={h} x={x} y={H - 4} textAnchor="middle" fontSize={7.5} fill="#6b7280" fontWeight="500">
              {h}
            </text>
          )
        })}

        {/* 渐变 */}
        <defs>
          <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
          </linearGradient>
        </defs>

        {/* 面积填充 */}
        <path d={areaPath} fill="url(#usageGradient)" opacity={0.4} />

        {/* 折线 */}
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinejoin="round" />

        {/* 数据点 + 悬停 */}
        {points.map(p => {
          const isHovered = hovered === p.hour
          const isPeak = peakHour.val > 0 && p.hour === peakHour.hour
          return (
            <g key={p.hour}>
              <circle
                cx={p.x} cy={p.y}
                r={isHovered ? 4 : isPeak ? 4 : 2.5}
                fill={p.val > 0 ? '#10b981' : '#e5e7eb'}
                stroke="white" strokeWidth={isHovered ? 2 : 1}
                style={{ transition: 'r 0.15s, stroke-width 0.15s' }}
              />
              <circle
                cx={p.x} cy={p.y} r={10}
                fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(p.hour)}
                onMouseLeave={() => setHovered(null)}
              />
              {isHovered && (() => {
                const showBelow = p.y - PAD_T < 18
                const ty = showBelow ? p.y + 8 : p.y - 18
                const textY = showBelow ? p.y + 17.5 : p.y - 8.5
                const label = `${p.hour}:00–${p.hour + 1}:00 · ${Math.round(p.val)}%`
                const rectW = label.length * 4 + 8
                return (
                  <g>
                    <rect
                      x={Math.max(0, Math.min(p.x - rectW / 2, W - rectW))}
                      y={ty} width={rectW} height={13}
                      rx={3} fill="#1f2937" opacity={0.85}
                    />
                    <text
                      x={Math.max(rectW / 2, Math.min(p.x, W - rectW / 2))}
                      y={textY}
                      textAnchor="middle" fontSize={7} fill="white" fontWeight="500"
                    >
                      {label}
                    </text>
                  </g>
                )
              })()}
              {isPeak && !isHovered && (() => {
                const showBelow = p.y - PAD_T < 12
                const labelY = showBelow ? p.y + 13 : p.y - 6
                return (
                  <text x={p.x} y={labelY}
                    textAnchor="middle" fontSize={7} fill="#059669" fontWeight="bold"
                  >
                    ★ {Math.round(peakHour.val)}%
                  </text>
                )
              })()}
            </g>
          )
        })}
      </svg>

      {peakHour.val > 0 && (
        <p className="text-xxs text-gray-500 mt-1">
          🌟 今日使用高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00</span> 时段
          <span className="text-gray-400 ml-1">（{Math.round(peakHour.val)}% 活跃度）</span>
        </p>
      )}
    </div>
  )
}
