/**
 * TaskDurationChart —— 任务用时横向条形图
 *
 * 展示今日每个任务实际花费的时间（分钟），
 * 帮助用户直观感受"时间都花在哪了"。
 *
 * 点击某条可展开详情：显示该任务中卡顿的时间位置和原因。
 *
 * 数据来源：session.ended 事件的 totalDurationSeconds，按 taskTitle 聚合。
 */

import { useState } from 'react'

/** 卡顿标记：表示任务时长条上某个时间点发生的卡顿 */
interface StuckMark {
  /** 卡顿发生时，距离任务开始已过的秒数 */
  offsetSeconds: number
  /** 卡在哪个微任务上 */
  microAction: string
  /** 卡顿原因（用户填写 / AI 预测 / 常见标签） */
  reason: string
  /** 卡顿是否已解决（后续有继续执行或选择了绕路方案） */
  resolved: boolean
}

interface TaskDurationItem {
  title: string
  durationMin: number
  durationSec: number      // 秒级精度的实际用时（用于短时长任务精确展示）
  completed: boolean       // 任务是否已完成（用于区分颜色）
  /** 该任务中所有的卡顿标记 */
  stuckMarks?: StuckMark[]
}

interface TaskDurationChartProps {
  data: TaskDurationItem[]
}

export type { TaskDurationItem, StuckMark }

export default function TaskDurationChart({ data }: TaskDurationChartProps) {
  // 当前展开详情的任务索引（-1 表示全部收起）
  const [expandedIdx, setExpandedIdx] = useState<number>(-1)

  // 没有数据时不渲染
  if (data.length === 0) return null

  // 找到最长的条作为 100% 基准（用秒级精度，保证短时长任务也能正确计算宽度）
  const maxSec = Math.max(...data.map(d => d.durationSec), 1)

  return (
    <div className="space-y-2.5">
      {data.map((item, i) => {
        const hasStuck = item.stuckMarks && item.stuckMarks.length > 0
        const isExpanded = expandedIdx === i
        // 用秒级精度计算条形宽度，最小 4% 保证短时长任务也能看到
        const barWidthPct = Math.max((item.durationSec / maxSec) * 100, 4)
        const totalSec = item.durationSec

        return (
          <div key={i}>
            {/* 主行：任务名 + 条形 + 时长 */}
            <div
              className={`flex items-center gap-2.5 ${hasStuck ? 'cursor-pointer' : ''}`}
              onClick={() => hasStuck && setExpandedIdx(isExpanded ? -1 : i)}
            >
              {/* 左侧：任务名（允许折行，不截断） */}
              <span
                className="text-xxs text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words"
              >
                {item.title}
              </span>

              {/* 中间：条形 + 卡顿标记段（与条形融为一体） */}
              <div className="flex-1 h-[22px] rounded-lg overflow-hidden relative">
                {/* 彩色条形 */}
                <div
                  className="h-full rounded-lg transition-all duration-700 ease-out relative overflow-hidden bg-blue-400/80"
                  style={{ width: `${barWidthPct}%` }}
                >
                  {/* 卡顿段：和条形一样高，像条形中间的一小截变了色 */}
                  {hasStuck && item.stuckMarks!.map((mark, mi) => {
                    const pct = totalSec > 0
                      ? Math.min(Math.max((mark.offsetSeconds / totalSec) * 100, 1), 97)
                      : 50
                    return (
                      <span
                        key={mi}
                        className="absolute top-0 h-full w-[8px] z-10 bg-red-400/90"
                        style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
                        title={`卡在：${mark.microAction}\n原因：${mark.reason}`}
                      />
                    )
                  })}
                </div>

                {/* 有卡顿时显示展开箭头提示 */}
                {hasStuck && (
                  <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-3xs text-gray-400 select-none">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                )}
              </div>

              {/* 右侧：时长标注（≥60秒显示分钟，<60秒显示秒数） */}
              <span className="text-xxs text-gray-500 w-[44px] flex-shrink-0 text-right font-mono">
                {item.durationSec >= 60
                  ? `${item.durationMin} min`
                  : `${item.durationSec}s`
                }
              </span>
            </div>

            {/* 展开区域：卡顿详情列表 */}
            {isExpanded && hasStuck && (
              <div className="ml-[112px] mt-1.5 mb-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                {item.stuckMarks!.map((mark, mi) => (
                  <div
                    key={mi}
                    className="flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xxs bg-red-50/60"
                  >
                    <span className="font-mono flex-shrink-0 mt-px text-red-400">
                      {formatOffset(mark.offsetSeconds)}
                    </span>
                    {/* 详情 */}
                    <div className="leading-snug">
                      <span className="text-gray-600">
                        卡在 <b className="text-gray-700">{mark.microAction}</b>
                      </span>
                      {mark.reason && (
                        <span className="text-gray-400 ml-1">— {mark.reason}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* 图例：仅在有卡顿时显示 */}
      {data.some(d => d.stuckMarks && d.stuckMarks.length > 0) && (
        <div className="flex items-center gap-4 pt-1">
          <span className="flex items-center gap-1.5 text-2xs text-gray-400">
            <span className="w-[8px] h-3 rounded-[2px] bg-red-400/90" /> 卡顿
          </span>
          <span className="text-2xs text-gray-300">（点击条形查看）</span>
        </div>
      )}
    </div>
  )
}

/** 将秒数格式化为"第Xm Ys"，明确表示卡顿发生的时间点 */
function formatOffset(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `第${s}秒`
  return s > 0 ? `第${m}分${s}秒` : `第${m}分钟`
}
