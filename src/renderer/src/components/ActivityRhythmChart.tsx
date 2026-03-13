/**
 * ActivityRhythmChart —— 每日活跃节奏曲线
 *
 * 用 SVG 折线图展示一天中每小时的平均活跃度变化趋势。
 * X 轴：小时（0-23）
 * Y 轴：平均活跃占比（0-100%）
 *
 * 面积填充 + 平滑曲线，直观呈现"什么时候状态最好"。
 */

import { useMemo } from 'react'
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
const PAD_T = 8    // 顶部留白
const PAD_B = 20   // 底部留白（x 轴标签）

const CHART_W = W - PAD_L - PAD_R
const CHART_H = H - PAD_T - PAD_B

export default function ActivityRhythmChart({ data }: Props) {
  /**
   * 每小时理论记录数。
   * 采样 2 秒一次 → 聚合 30 秒 → 每分钟 2 条 → 1 小时 = 120 条。
   * 用固定分母代替"实际记录数"，避免 app 中途启动 / 休眠恢复时活跃度虚高。
   */
  const EXPECTED_RECORDS_PER_HOUR = 120

  // 按小时聚合平均 activeRatio，并转换为百分比
  const hourlyAvg = useMemo(() => {
    const buckets: { totalRatio: number; count: number }[] = Array.from({ length: 24 }, () => ({
      totalRatio: 0,
      count: 0,
    }))

    for (const r of data) {
      const h = new Date(r.ts).getHours()
      buckets[h].totalRatio += getActiveRatio(r)
      buckets[h].count++
    }

    // 用固定分母：totalRatio / 120，再乘以 0.5 转为分钟（每条记录覆盖 30 秒）
    // 例如：totalRatio=80 → 80 × 0.5 = 40 分钟（该小时内约 40 分钟在活跃使用）
    return buckets.map(b => (b.totalRatio / EXPECTED_RECORDS_PER_HOUR) * 60)
  }, [data])

  // Y 轴用"分钟"表示（0-60），和热力图统一用"时间"让用户直观理解
  const maxVal = 60
  const ticks = [0, 15, 30, 45, 60]

  // ★ 固定显示 0-23 小时，不再裁剪
  // 生成折线路径点（24 个点）
  const points = useMemo(() => {
    const pts: { x: number; y: number; hour: number; val: number }[] = []
    for (let h = 0; h < 24; h++) {
      const x = PAD_L + (h / 23) * CHART_W
      const y = PAD_T + CHART_H - (maxVal > 0 ? (hourlyAvg[h] / maxVal) * CHART_H : 0)
      pts.push({ x, y, hour: h, val: hourlyAvg[h] })
    }
    return pts
  }, [hourlyAvg, maxVal])

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
      if (hourlyAvg[h] > peakVal) {
        peakVal = hourlyAvg[h]
        peak = h
      }
    }
    return { hour: peak, val: peakVal }
  }, [hourlyAvg])

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无活跃度数据（数据采集中…）
      </div>
    )
  }

  return (
    <div>
      {/* 高峰提示 */}
      {peakHour.val > 0 && (
        <p className="text-[11px] text-gray-500 mb-2">
          🌟 今日活跃高峰：<span className="font-semibold text-emerald-600">{peakHour.hour}:00</span> 时段
          <span className="text-gray-400 ml-1">（约 {Math.round(peakHour.val)} 分钟/小时）</span>
        </p>
      )}

      {/* SVG 图表 */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 140 }}>
        {/* 背景网格线（智能刻度） */}
        {ticks.map((tickVal, i) => {
          const ratio = maxVal > 0 ? tickVal / maxVal : 0
          const y = PAD_T + CHART_H * (1 - ratio)
          // 格式化：小数就显示一位，整数就显示整数
          const label = tickVal % 1 === 0 ? String(tickVal) : tickVal.toFixed(1)
          return (
            <g key={i}>
              <line
                x1={PAD_L} y1={y} x2={PAD_L + CHART_W} y2={y}
                stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray={i === 0 ? undefined : '2,2'}
              />
              {/* y 轴刻度 */}
              <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={7} fill="#9ca3af">
                {label}
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
        <path d={areaPath} fill="url(#activityGradient)" opacity={0.3} />

        {/* 渐变定义 */}
        <defs>
          <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
        </defs>

        {/* 折线 */}
        <path d={linePath} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinejoin="round" />

        {/* 数据点 */}
        {points.map(p => (
          <circle
            key={p.hour}
            cx={p.x} cy={p.y} r={p.val > 0 ? 2.5 : 1.5}
            fill={p.val > 0 ? '#10b981' : '#d1d5db'}
            stroke="white" strokeWidth={1}
          />
        ))}

        {/* 高峰标记 */}
        {peakHour.val > 0 && points.find(p => p.hour === peakHour.hour) && (() => {
          const peakPt = points.find(p => p.hour === peakHour.hour)!
          return (
            <g>
              <circle cx={peakPt.x} cy={peakPt.y} r={4} fill="#10b981" stroke="white" strokeWidth={1.5} />
              <text
                x={peakPt.x} y={peakPt.y - 7}
                textAnchor="middle" fontSize={7} fill="#059669" fontWeight="bold"
              >
                ★ {Math.round(peakHour.val)}min
              </text>
            </g>
          )
        })()}
      </svg>

      {/* y 轴说明 */}
      <p className="text-[10px] text-gray-400 mt-1 text-center">
        纵轴：每小时使用时长（分钟） · 横轴：时间
      </p>
    </div>
  )
}
