/**
 * ActivityRhythmChart —— 每日使用节奏阶梯图
 *
 * 每小时一个台阶，高度 = 该小时活跃分钟数。
 * PAD_L / PAD_R 与热力图共享，确保绘图区与热力图方块区完全对齐。
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
  highlightHour?: number | null
  highlightHourRange?: { startHour: number; endHour: number } | null
  highlightPulseKey?: string
}

const W = 400
const H = 110
const PAD_L = 40
const PAD_R = 4
const PAD_T = 14
const PAD_B = 16
const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

/** 热力图需要加的左右 padding 百分比，保证和折线图绘图区对齐 */
export const HEATMAP_PAD_LEFT_PCT = `${(PAD_L / W) * 100}%`
export const HEATMAP_PAD_RIGHT_PCT = `${(PAD_R / W) * 100}%`

export default function ActivityRhythmChart({ data, events, rangeStart: rs, rangeEnd: re, highlightHour, highlightHourRange, highlightPulseKey }: Props) {
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
    return buckets.map(b => Math.min((b.totalRatio / EXPECTED_RECORDS_PER_HOUR) * 60, 60))
  }, [data])

  const maxVal = 60
  const yTicks = [0, 15, 30, 45, 60]

  const steps = useMemo(() => {
    const s: { leftX: number; rightX: number; y: number; hour: number; val: number }[] = []
    for (let i = 0; i < visibleHours; i++) {
      const h = rangeStart + i
      const leftX = PAD_L + (i / visibleHours) * CHART_W
      const rightX = PAD_L + ((i + 1) / visibleHours) * CHART_W
      const y = PAD_T + CHART_H - (hourlyUsage[h] / maxVal) * CHART_H
      s.push({ leftX, rightX, y, hour: h, val: hourlyUsage[h] })
    }
    return s
  }, [hourlyUsage, maxVal, rangeStart, visibleHours])

  const highlightFrame = useMemo(() => {
    let startHour: number | null = null
    let endHour: number | null = null

    if (highlightHourRange) {
      startHour = highlightHourRange.startHour
      endHour = highlightHourRange.endHour
    } else if (Number.isInteger(highlightHour)) {
      startHour = highlightHour
      endHour = highlightHour + 1
    }

    if (startHour == null || endHour == null) return null

    const clippedStart = Math.max(startHour, rangeStart)
    const clippedEnd = Math.min(endHour, rangeEnd)
    if (clippedEnd <= clippedStart || visibleHours <= 0) return null

    const leftX = PAD_L + ((clippedStart - rangeStart) / visibleHours) * CHART_W
    const rightX = PAD_L + ((clippedEnd - rangeStart) / visibleHours) * CHART_W

    return {
      x: leftX + 1,
      width: Math.max(rightX - leftX - 2, 1),
    }
  }, [highlightHour, highlightHourRange, rangeEnd, rangeStart, visibleHours])

  const stepLinePath = useMemo(() => {
    if (steps.length === 0) return ''
    let d = `M ${steps[0].leftX} ${steps[0].y}`
    for (let i = 0; i < steps.length; i++) {
      d += ` H ${steps[i].rightX}`
      if (i < steps.length - 1) {
        d += ` V ${steps[i + 1].y}`
      }
    }
    return d
  }, [steps])

  const stepAreaPath = useMemo(() => {
    if (steps.length === 0) return ''
    const baseline = PAD_T + CHART_H
    return `${stepLinePath} V ${baseline} H ${steps[0].leftX} Z`
  }, [stepLinePath, steps])

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
      if (e.type !== 'stuck.reason') continue
      const p = e.payload as { sessionId: string; reason: string }
      const taskTitle = sessionTaskMap.get(p.sessionId) || '未知任务'

      // 找对应的 stuck.triggered 获取 microAction 和精确时间
      const trigger = events.find(
        t => t.type === 'stuck.triggered' &&
          (t.payload as { sessionId: string }).sessionId === p.sessionId &&
          t.timestamp <= e.timestamp
      )
      const ts = trigger?.timestamp ?? e.timestamp
      const microAction = trigger
        ? (trigger.payload as { microAction: string }).microAction
        : ''

      const d = new Date(ts)
      const hourFraction = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
      if (hourFraction < rangeStart || hourFraction >= rangeEnd) continue

      const x = PAD_L + ((hourFraction - rangeStart) / visibleHours) * CHART_W
      const timeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

      // 判断是否已解决
      const resolves = resolveEvents.get(p.sessionId) || []
      const resolved = resolves.some(rts => rts > ts)

      pts.push({ x, timestamp: ts, timeLabel, taskTitle, microAction, reason: p.reason, resolved })
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
      {peakHour.val > 0 && (
        <p className="text-xxs text-gray-500 mb-1.5 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          今日使用高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00~{peakHour.hour + 1}:00</span>
          <span className="text-gray-400 ml-1">（活跃 {Math.round(peakHour.val)} 分钟）</span>
        </p>
      )}
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
                {tickVal === 0 ? '0' : `${tickVal}分钟`}
              </text>
            </g>
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
        <path d={stepAreaPath} fill="url(#usageGradient)" opacity={0.4} />

        {/* AI 重点小时/小时段定位：只给遮罩留洞，不额外绘制彩色框 */}
        {highlightFrame && (
          <g key={`ai-highlight-${highlightPulseKey ?? 'pulse'}`} pointerEvents="none">
            <rect
              x={highlightFrame.x}
              y={PAD_T}
              width={highlightFrame.width}
              height={CHART_H}
              rx={2}
              fill="transparent"
              className="ai-focus-target"
            />
          </g>
        )}

        {/* 阶梯轮廓线 */}
        <path d={stepLinePath} fill="none" stroke="#10b981" strokeWidth={1.8} />

        {/* 每小时段 hover 交互（垂直高亮带 + tooltip） */}
        {steps.map(s => {
          const isHovered = hovered === s.hour
          return (
            <g key={s.hour}>
              <rect
                x={s.leftX} y={PAD_T} width={s.rightX - s.leftX} height={CHART_H}
                fill="transparent" style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(s.hour)}
                onMouseLeave={() => setHovered(null)}
              />
              {isHovered && (
                <g pointerEvents="none">
                  <rect
                    x={s.leftX} y={PAD_T} width={s.rightX - s.leftX} height={CHART_H}
                    fill="#10b981" opacity={0.07} rx={1}
                  />
                  {(() => {
                    const nextHour = (s.hour + 1) % 24
                    const headerText = `${s.hour}:00~${nextHour}:00`
                    const valText = `${Math.round(s.val)} 分钟`
                    const lineH = 14
                    const boxH = lineH * 2 + 8
                    const measureW = (str: string) => [...str].reduce((w, c) => w + (/[\u4e00-\u9fff]/.test(c) ? 6 : 4), 0)
                    const rectW = Math.max(measureW(headerText), measureW(valText)) + 20
                    const midX = (s.leftX + s.rightX) / 2
                    const tipX = Math.max(0, Math.min(midX - rectW / 2, W - rectW))
                    const showBelow = s.y - PAD_T < boxH + 4
                    const tipY = showBelow ? s.y + 8 : s.y - boxH - 4
                    return (
                      <g>
                        <rect x={tipX} y={tipY} width={rectW} height={boxH}
                          rx={4} fill="#1f2937" opacity={0.92} />
                        <text x={tipX + 8} y={tipY + 12}
                          fontSize={8.5} fill="white" fontWeight="500" opacity={0.85}>
                          {headerText}
                        </text>
                        <text x={tipX + 8} y={tipY + 12 + lineH}
                          fontSize={9.5} fill="white" fontWeight="700">
                          {valText}
                        </text>
                      </g>
                    )
                  })()}
                </g>
              )}
            </g>
          )
        })}
        {/* 卡顿标记（红色圆点，画在台阶顶边上） */}
        {stuckPoints.map((sp, idx) => {
          const isHov = hoveredStuck === idx
          const step = steps.find(s => sp.x >= s.leftX && sp.x < s.rightX)
          const lineY = step ? step.y : PAD_T + CHART_H

          // 日视图卡顿点缩小一档，和周视图保持一致
          const dotR = isHov ? 4 : 2.8
          return (
            <g key={`stuck-${idx}`}>
              <circle
                cx={sp.x} cy={lineY}
                r={dotR}
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
        {/* x 轴标签（最后渲染，显示在最上层） */}
        {Array.from({ length: visibleHours + 1 }, (_, i) => {
          const h = rangeStart + i
          const x = PAD_L + (i / visibleHours) * CHART_W
          return (
            <text key={h} x={x} y={PAD_T + CHART_H + 11} textAnchor="middle" fontSize={9} fill="#6b7280" fontWeight="500">
              {h}
            </text>
          )
        })}
      </svg>

    </div>
  )
}
