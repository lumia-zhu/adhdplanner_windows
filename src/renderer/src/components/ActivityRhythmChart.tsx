/**
 * ActivityRhythmChart —— 每日使用节奏曲线
 *
 * PAD_L / PAD_R 与热力图共享（通过 CSS 变量 / 导出常量），
 * 确保折线图绘图区与热力图方块区完全对齐。
 */

import { useMemo, useState } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import type { TrackEvent } from '../services/tracker'

/** 折线图上的卡顿标记 */
interface StuckPoint {
  x: number
  timestamp: number
  timeLabel: string
  taskTitle: string
  microAction: string
  reason: string
  resolved: boolean
}

interface Props {
  data: ActivityRecord[]
  events?: TrackEvent[]
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

export default function ActivityRhythmChart({ data, events, rangeStart: rs, rangeEnd: re }: Props) {
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

  // 从 events 中提取卡顿点并计算 x 坐标
  const stuckPoints = useMemo(() => {
    if (!events || events.length === 0) return []

    // session 起始信息：sessionId → taskTitle
    const sessionTaskMap = new Map<string, string>()
    for (const e of events) {
      if (e.type === 'session.started') {
        const p = e.payload as { sessionId: string; taskTitle: string }
        if (p.taskTitle) sessionTaskMap.set(p.sessionId, p.taskTitle)
      }
    }

    // 预构建"恢复事件"索引
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

    const pts: StuckPoint[] = []

    for (const e of events) {
      if (e.type !== 'stuck.triggered') continue
      const p = e.payload as { sessionId: string; microAction: string; elapsedSeconds: number }
      const taskTitle = sessionTaskMap.get(p.sessionId) || '未知任务'

      const d = new Date(e.timestamp)
      const hourFraction = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
      if (hourFraction < rangeStart || hourFraction >= rangeEnd) continue

      const x = PAD_L + ((hourFraction - rangeStart) / visibleHours) * CHART_W
      const timeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

      // 找卡顿原因
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

      // 判断是否已解决
      const resolves = resolveEvents.get(p.sessionId) || []
      const resolved = resolves.some(ts => ts > e.timestamp)

      pts.push({ x, timestamp: e.timestamp, timeLabel, taskTitle, microAction: p.microAction, reason, resolved })
    }

    return pts.sort((a, b) => a.timestamp - b.timestamp)
  }, [events, rangeStart, rangeEnd, visibleHours])

  const [hovered, setHovered] = useState<number | null>(null)
  const [hoveredStuck, setHoveredStuck] = useState<number | null>(null)

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
              <text x={PAD_L - 3} y={y + 3} textAnchor="end" fontSize={9} fill="#6b7280" fontWeight="500">
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
            <text key={h} x={x} y={H - 4} textAnchor="middle" fontSize={9} fill="#6b7280" fontWeight="500">
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
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.8} strokeLinejoin="round" />

        {/* 数据点 + 悬停 */}
        {points.map(p => {
          const isHovered = hovered === p.hour
          const isPeak = peakHour.val > 0 && p.hour === peakHour.hour
          return (
            <g key={p.hour}>
              <circle
                cx={p.x} cy={p.y}
                r={isHovered ? 4.5 : isPeak ? 4.5 : 3}
                fill={p.val > 0 ? '#10b981' : '#e5e7eb'}
                stroke="white" strokeWidth={isHovered ? 1.8 : 1}
                style={{ transition: 'r 0.15s, stroke-width 0.15s' }}
              />
              <circle
                cx={p.x} cy={p.y} r={10}
                fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(p.hour)}
                onMouseLeave={() => setHovered(null)}
              />
              {isHovered && (() => {
                const showBelow = p.y - PAD_T < 22
                const nextHour = (p.hour + 1) % 24
                const label = `${p.hour}:00~${nextHour}:00 · ${Math.round(p.val)}%`
                const rectW = Math.min(label.length * 5 + 12, 240)
                const boxH = 18
                const ty = showBelow ? p.y + 10 : p.y - 24
                const textY = showBelow ? p.y + 21.5 : p.y - 12.5
                return (
                  <g>
                    <rect
                      x={Math.max(0, Math.min(p.x - rectW / 2, W - rectW))}
                      y={ty} width={rectW} height={boxH}
                      rx={4} fill="#1f2937" opacity={0.88}
                    />
                    <text
                      x={Math.max(rectW / 2, Math.min(p.x, W - rectW / 2))}
                      y={textY}
                      textAnchor="middle" fontSize={9} fill="white" fontWeight="500"
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
        {/* 卡顿标记（小三角，在折线上） */}
        {stuckPoints.map((sp, idx) => {
          const isHov = hoveredStuck === idx
          // 在折线的相邻两个数据点之间线性插值得到精确 y
          let lineY = PAD_T + CHART_H
          const leftPt = points.filter(p => p.x <= sp.x).at(-1)
          const rightPt = points.find(p => p.x > sp.x)
          if (leftPt && rightPt) {
            const t = (sp.x - leftPt.x) / (rightPt.x - leftPt.x)
            lineY = leftPt.y + t * (rightPt.y - leftPt.y)
          } else if (leftPt) {
            lineY = leftPt.y
          } else if (rightPt) {
            lineY = rightPt.y
          }

          const triSize = isHov ? 7 : 5
          const color = sp.resolved ? '#f59e0b' : '#ef4444'
          const tipY = lineY - triSize * 1.4 - 1
          return (
            <g key={`stuck-${idx}`}>
              <polygon
                points={`${sp.x},${tipY + triSize * 1.4} ${sp.x - triSize},${tipY} ${sp.x + triSize},${tipY}`}
                fill={color} stroke="white" strokeWidth={0.8}
                opacity={isHov ? 1 : 0.85}
                style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
              />
              <circle
                cx={sp.x} cy={tipY + triSize * 0.7} r={8}
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
                const showBelow = tipY - boxH - 4 < 0
                const boxY = showBelow ? tipY + triSize * 1.4 + 4 : tipY - boxH - 4
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

      {peakHour.val > 0 && (
        <p className="text-xxs text-gray-500 mt-1 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          今日使用高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00</span> 时段
          <span className="text-gray-400 ml-1">（{Math.round(peakHour.val)}% 活跃度）</span>
        </p>
      )}
    </div>
  )
}
