/**
 * ActivityHeatmap —— 活跃度热力时间轴（单行 24 小时）
 *
 * 将一天 24 小时划分为 48 个 30 分钟格子，用一行水平条展示：
 *   - 灰色：无数据 / 空闲
 *   - 浅绿：低活跃（1%-30%）
 *   - 中绿：中等活跃（31%-70%）
 *   - 深绿：高活跃（71%-100%）
 *
 * 始终显示完整 24 小时，用户一眼看出全天活跃节奏。
 */

import { useMemo, useState } from 'react'

/** 单条活跃度采样记录（从主进程加载） */
export interface ActivityRecord {
  ts: number    // Unix 时间戳（ms）
  idle: number  // 空闲时间（秒）
  activeSamples?: number // 30 秒窗口内活跃采样次数（新版）
  totalSamples?: number  // 30 秒窗口内总采样次数（新版）
  activeRatio?: number   // 活跃时间占比 0-1（新版）
  inputs?: number        // 旧版字段（兼容）
}

/** 安全获取记录的 activeRatio，兼容新旧格式 */
export function getActiveRatio(r: ActivityRecord): number {
  // 新版：直接使用 activeRatio
  if (typeof r.activeRatio === 'number' && !isNaN(r.activeRatio)) {
    return r.activeRatio
  }
  // 旧版：从 inputs 近似推算（inputs 通常 0-5，映射到 0-1）
  if (typeof r.inputs === 'number') {
    return Math.max(0, Math.min(r.inputs / 4, 1))
  }
  // 兜底：用 idle 判断（idle ≤ 2 算活跃）
  return r.idle <= 2 ? 1 : 0
}

interface Props {
  data: ActivityRecord[]
}

/** 总共 48 个格子（每格 30 分钟） */
const TOTAL_BLOCKS = 48

/** 活跃占比 → 活跃等级 0-3 */
function ratioToLevel(activeRatio: number): number {
  if (activeRatio <= 0) return 0
  if (activeRatio <= 0.3) return 1
  if (activeRatio <= 0.7) return 2
  return 3
}

/** 活跃等级 → 背景色 class */
const LEVEL_COLORS = [
  'bg-gray-100',       // 0: 无活跃
  'bg-emerald-200',    // 1: 低
  'bg-emerald-400',    // 2: 中
  'bg-emerald-600',    // 3: 高
]

const LEVEL_LABELS = ['空闲', '低活跃', '中等活跃', '高活跃']

/** 时间刻度标签（底部显示的关键时间点） */
const TIME_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

export default function ActivityHeatmap({ data }: Props) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string; activeRatio: number; level: number
  } | null>(null)

  // 把原始记录聚合到 48 个 30 分钟格子
  const blocks = useMemo(() => {
    // 按 30 分钟格子分桶
    const buckets: { totalRatio: number; count: number }[] = Array.from(
      { length: TOTAL_BLOCKS },
      () => ({ totalRatio: 0, count: 0 })
    )

    for (const r of data) {
      const d = new Date(r.ts)
      const minutesInDay = d.getHours() * 60 + d.getMinutes()
      const blockIdx = Math.min(Math.floor(minutesInDay / 30), TOTAL_BLOCKS - 1)
      buckets[blockIdx].totalRatio += getActiveRatio(r)
      buckets[blockIdx].count++
    }

    return buckets.map((b, i) => {
      const hour = Math.floor((i * 30) / 60)
      const minute = (i * 30) % 60
      const avgActiveRatio = b.count > 0 ? b.totalRatio / b.count : 0
      const endTotalMinutes = (i + 1) * 30
      const endHour = Math.floor(endTotalMinutes / 60)
      const endMinute = endTotalMinutes % 60
      return {
        index: i,
        avgActiveRatio,
        count: b.count,
        label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}–${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
      }
    })
  }, [data])

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无活跃度数据（数据采集中…）
      </div>
    )
  }

  return (
    <div className="relative">
      {/* 图例 */}
      <div className="flex items-center gap-3 mb-2.5 text-[10px] text-gray-400">
        <span>活跃占比：</span>
        {LEVEL_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* 热力条：48 格 */}
      <div className="flex gap-[1px] w-full">
        {blocks.map((block) => {
          const level = ratioToLevel(block.avgActiveRatio)
          return (
            <div
              key={block.index}
              className={`h-7 flex-1 rounded-[3px] cursor-pointer transition-all
                          hover:ring-1 hover:ring-gray-400 hover:scale-y-110
                          ${LEVEL_COLORS[level]}`}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setTooltip({
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                  label: block.label,
                  activeRatio: block.avgActiveRatio,
                  level,
                })
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          )
        })}
      </div>

      {/* 底部时间刻度 */}
      <div className="relative w-full h-4 mt-1">
        {TIME_TICKS.map((h) => {
          // h=0 对应最左，h=24 对应最右
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

      {/* 悬浮提示 */}
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
          <span>活跃占比 {Math.round(tooltip.activeRatio * 100)}%</span>
          <span className="mx-1.5 opacity-40">|</span>
          <span>{LEVEL_LABELS[tooltip.level]}</span>
        </div>
      )}
    </div>
  )
}
