/**
 * ActivityHeatmap —— 每小时使用时长热力图（单行 24 小时）
 *
 * 将一天 24 小时划分为 24 个 1 小时格子，用一行水平条展示：
 *   - 灰色：无数据 / 未使用
 *   - 浅绿：低使用（< 20 分钟/小时）
 *   - 中绿：中等使用（20-40 分钟/小时）
 *   - 深绿：高使用（> 40 分钟/小时）
 *
 * 使用"1 分钟无操作 → 未使用"的判定模型。
 * 始终显示完整 24 小时，用户一眼看出全天使用节奏。
 */

import { useMemo, useState } from 'react'

/** 单条活跃度采样记录（从主进程加载） */
export interface ActivityRecord {
  ts: number    // Unix 时间戳（ms）
  idle: number  // 空闲时间（秒）
  activeSamples?: number // 30 秒窗口内"使用中"采样次数（新版）
  totalSamples?: number  // 30 秒窗口内总采样次数（新版）
  activeRatio?: number   // 使用时间占比 0-1（新版，语义已改为 60 秒阈值）
  inputs?: number        // 旧版字段（兼容）
  // 此 30 秒窗口内每个前台应用被采到的次数（次数 × 2 ≈ 秒数）。可选以兼容老数据
  appUsage?: Record<string, number>
}

/**
 * 安全获取记录的使用占比（usageRatio），兼容新旧格式。
 * 新版数据使用 60 秒空闲阈值；旧版数据做近似映射。
 */
export function getActiveRatio(r: ActivityRecord): number {
  // 新版：直接使用 activeRatio（现在语义是"使用占比"，60 秒阈值）
  if (typeof r.activeRatio === 'number' && !isNaN(r.activeRatio)) {
    return r.activeRatio
  }
  // 旧版：从 inputs 近似推算（inputs 通常 0-5，映射到 0-1）
  if (typeof r.inputs === 'number') {
    return Math.max(0, Math.min(r.inputs / 4, 1))
  }
  // 兜底：用 idle 判断（idle ≤ 60 算使用中）
  return r.idle <= 60 ? 1 : 0
}

interface Props {
  data: ActivityRecord[]
}

/** 总共 24 个格子（每格 1 小时） */
const TOTAL_BLOCKS = 24

/**
 * 每个 1 小时格子理论上应有的记录数。
 * 采样间隔 2 秒 → 聚合窗口 30 秒 → 每分钟 2 条记录 → 1 小时 = 120 条。
 * 用固定分母代替"实际记录数"，避免 app 中途启动或休眠恢复时数据被严重高估。
 */
const EXPECTED_RECORDS_PER_BLOCK = 120

/** 使用占比 → 使用等级 0-3 */
function ratioToLevel(usageRatio: number): number {
  if (usageRatio <= 0) return 0
  if (usageRatio <= 0.33) return 1   // < 20 分钟/小时
  if (usageRatio <= 0.67) return 2   // 20-40 分钟/小时
  return 3                            // > 40 分钟/小时
}

/** 使用等级 → 背景色 class */
const LEVEL_COLORS = [
  'bg-gray-100',       // 0: 未使用
  'bg-emerald-200',    // 1: 低
  'bg-emerald-400',    // 2: 中
  'bg-emerald-600',    // 3: 高
]

const LEVEL_LABELS = ['未使用', '< 20 分钟', '20~40 分钟', '> 40 分钟']

/** 时间刻度标签（底部显示的关键时间点） */
const TIME_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

export default function ActivityHeatmap({ data }: Props) {
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; label: string; usageRatio: number; level: number; usageMinutes: number
  } | null>(null)

  // 把原始记录聚合到 24 个 1 小时格子
  const blocks = useMemo(() => {
    // 按 1 小时格子分桶
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
      // 用固定分母（理论记录数）而非实际记录数，
      // 这样 app 中途启动 / 休眠恢复后不会虚高
      const avgUsageRatio = b.totalRatio / EXPECTED_RECORDS_PER_BLOCK
      // 使用分钟数 ≈ sum(usageRatio) × 0.5（每条记录覆盖 30 秒 = 0.5 分钟）
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

  if (data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-xs">
        暂无使用数据（数据采集中…）
      </div>
    )
  }

  return (
    <div className="relative">
      {/* 图例 */}
      <div className="flex items-center gap-3 mb-2.5 text-2xs text-gray-400">
        <span>每小时使用时长：</span>
        {LEVEL_COLORS.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${c}`} />
            <span>{LEVEL_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* 热力条：24 格 */}
      <div className="flex gap-[2px] w-full">
        {blocks.map((block) => {
          const level = ratioToLevel(block.avgUsageRatio)
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
                  usageRatio: block.avgUsageRatio,
                  level,
                  usageMinutes: block.usageMinutes,
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
              className="absolute text-3xs text-gray-400 tabular-nums"
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
          className="fixed z-50 px-2.5 py-1.5 rounded-lg bg-gray-800 text-white text-2xs
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
