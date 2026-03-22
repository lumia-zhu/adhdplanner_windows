/**
 * ActivityRhythmChart —— 每日使用节奏曲线
 *
 * 用 SVG 折线图展示一天中每小时的使用时长变化趋势。
 * X 轴：小时（0-23）
 * Y 轴：每小时使用时长（0-60 分钟）
 *
 * 面积填充 + 折线，直观呈现"什么时候在用电脑"。
 * 使用"1 分钟无操作 → 未使用"的判定模型。
 */

import { useMemo, useState } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'

interface Props {
  data: ActivityRecord[]
}

/** 图表尺寸常量 */
const W = 400      // SVG viewBox 宽度
const H = 120      // SVG viewBox 高度
const PAD_L = 32   // 左侧留白（y 轴标签）
const PAD_R = 8    // 右侧留白
const PAD_T = 18   // 顶部留白（需容纳高峰标记和 tooltip）
const PAD_B = 20   // 底部留白（x 轴标签）

const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

export default function ActivityRhythmChart({ data }: Props) {
  /**
   * 每小时理论记录数。
   * 采样 2 秒一次 → 聚合 30 秒 → 每分钟 2 条 → 1 小时 = 120 条。
   * 用固定分母代替"实际记录数"，避免 app 中途启动 / 休眠恢复时使用时长虚高。
   */
  const EXPECTED_RECORDS_PER_HOUR = 120

  // 按小时聚合使用占比，并转换为"使用分钟数"
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

    // 用固定分母：totalRatio / 120 → 0~1 的活跃占比，再乘 100 转为百分比
    return buckets.map(b => Math.min((b.totalRatio / EXPECTED_RECORDS_PER_HOUR) * 100, 100))
  }, [data])

  // Y 轴用百分比表示（0-100%）
  const maxVal = 100
  const ticks = [0, 25, 50, 75, 100]

  // 固定显示 0-23 小时，生成折线路径点（24 个点）
  const points = useMemo(() => {
    const pts: { x: number; y: number; hour: number; val: number }[] = []
    for (let h = 0; h < 24; h++) {
      const x = PAD_L + (h / 23) * CHART_W
      const y = PAD_T + CHART_H - (maxVal > 0 ? (hourlyUsage[h] / maxVal) * CHART_H : 0)
      pts.push({ x, y, hour: h, val: hourlyUsage[h] })
    }
    return pts
  }, [hourlyUsage, maxVal])

  // SVG 路径
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

  // 面积路径（闭合到底部）
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${PAD_T + CHART_H} L ${points[0].x} ${PAD_T + CHART_H} Z`
    : ''

  // 找高峰小时
  const peakHour = useMemo(() => {
    let peak = 0, peakVal = 0
    for (let h = 0; h < 24; h++) {
      if (hourlyUsage[h] > peakVal) {
        peakVal = hourlyUsage[h]
        peak = h
      }
    }
    return { hour: peak, val: peakVal }
  }, [hourlyUsage])

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
      {/* 高峰提示 */}
      {peakHour.val > 0 && (
        <p className="text-xxs text-gray-500 mb-2">
          🌟 今日使用高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00</span> 时段
          <span className="text-gray-400 ml-1">（{Math.round(peakHour.val)}% 活跃度）</span>
        </p>
      )}

      {/* SVG 图表 */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {/* 背景网格线 */}
        {ticks.map((tickVal, i) => {
          const ratio = maxVal > 0 ? tickVal / maxVal : 0
          const y = PAD_T + CHART_H * (1 - ratio)
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray={i === 0 ? undefined : '2,2'}
              />
              {/* y 轴刻度 */}
              <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#9ca3af">
                {tickVal}%
              </text>
            </g>
          )
        })}

        {/* x 轴标签（每 3 小时） */}
        {points.filter(p => p.hour % 3 === 0).map(p => (
          <text
            key={p.hour}
            x={p.x} y={H - 4}
            textAnchor="middle" fontSize={7} fill="#9ca3af"
          >
            {p.hour}:00
          </text>
        ))}

        {/* 面积填充 */}
        <path d={areaPath} fill="url(#usageGradient)" opacity={0.3} />

        {/* 渐变定义 */}
        <defs>
          <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* 折线 */}
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinejoin="round" />

        {/* 数据点 + 悬停区域 */}
        {points.map(p => {
          const isHovered = hovered === p.hour
          const isPeak = peakHour.val > 0 && p.hour === peakHour.hour
          return (
            <g key={p.hour}>
              {/* 可见数据点 */}
              <circle
                cx={p.x} cy={p.y}
                r={isHovered ? 3.5 : isPeak ? 4 : p.val > 0 ? 2.5 : 1.5}
                fill={p.val > 0 ? '#10b981' : '#d1d5db'}
                stroke="white" strokeWidth={isHovered ? 2 : 1}
                style={{ transition: 'r 0.15s, stroke-width 0.15s' }}
              />
              {/* 放大的透明悬停热区 */}
              <circle
                cx={p.x} cy={p.y} r={8}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(p.hour)}
                onMouseLeave={() => setHovered(null)}
              />
              {/* 悬停 tooltip —— 靠近顶部时显示在点下方 */}
              {isHovered && !isPeak && (() => {
                const showBelow = p.y - PAD_T < 20
                const ty = showBelow ? p.y + 10 : p.y - 20
                const textY = showBelow ? p.y + 19.5 : p.y - 10.5
                return (
                  <g>
                    <rect
                      x={p.x - 24} y={ty} width={48} height={14}
                      rx={3} fill="#1f2937" opacity={0.85}
                    />
                    <text
                      x={p.x} y={textY}
                      textAnchor="middle" fontSize={7} fill="white" fontWeight="500"
                    >
                      {p.hour}:00 · {Math.round(p.val)}%
                    </text>
                  </g>
                )
              })()}
              {/* 高峰标记 —— 靠近顶部时显示在点下方 */}
              {isPeak && (() => {
                const showBelow = p.y - PAD_T < 14
                const labelY = showBelow ? p.y + 14 : p.y - 7
                return (
                  <text
                    x={p.x} y={labelY}
                    textAnchor="middle" fontSize={7} fill="#059669" fontWeight="bold"
                  >
                    {isHovered ? `${p.hour}:00 · ${Math.round(p.val)}%` : `★ ${Math.round(peakHour.val)}%`}
                  </text>
                )
              })()}
            </g>
          )
        })}
      </svg>

      {/* y 轴说明 */}
      <p className="text-2xs text-gray-400 mt-1 text-center">
        纵轴：每小时活跃占比 · 横轴：时间
      </p>
    </div>
  )
}
