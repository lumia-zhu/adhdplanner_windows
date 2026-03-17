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
}

interface TaskDurationItem {
  title: string
  durationMin: number
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

  // 找到最长的条作为 100% 基准
  const maxMin = Math.max(...data.map(d => d.durationMin), 1)

  return (
    <div className="space-y-2.5">
      {data.map((item, i) => {
        const hasStuck = item.stuckMarks && item.stuckMarks.length > 0
        const isExpanded = expandedIdx === i
        const barWidthPct = Math.max((item.durationMin / maxMin) * 100, 4)
        const totalSec = item.durationMin * 60

        return (
          <div key={i}>
            {/* 主行：任务名 + 条形 + 时长 */}
            <div
              className={`flex items-center gap-2.5 ${hasStuck ? 'cursor-pointer' : ''}`}
              onClick={() => hasStuck && setExpandedIdx(isExpanded ? -1 : i)}
            >
              {/* 左侧：任务名（允许折行，不截断） */}
              <span
                className="text-[11px] text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words"
              >
                {item.title}
              </span>

              {/* 中间：条形 + 卡顿标记点 */}
              <div className="flex-1 h-[22px] rounded-lg overflow-visible relative">
                {/* 彩色条形 */}
                <div
                  className={`h-full rounded-lg transition-all duration-700 ease-out relative ${
                    item.completed
                      ? 'bg-blue-400/80'        // 已完成：蓝色
                      : 'bg-amber-400/70'        // 进行中：琥珀色
                  }`}
                  style={{ width: `${barWidthPct}%` }}
                >
                  {/* 卡顿标记点：红色小圆点，位于条上对应的时间位置 */}
                  {hasStuck && item.stuckMarks!.map((mark, mi) => {
                    // 标记位置 = (卡顿发生时间 / 总时间) * 100%
                    const pct = totalSec > 0
                      ? Math.min(Math.max((mark.offsetSeconds / totalSec) * 100, 2), 98)
                      : 50
                    return (
                      <span
                        key={mi}
                        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-500 border border-white shadow-sm z-10"
                        style={{ left: `${pct}%`, transform: `translate(-50%, -50%)` }}
                        title={`卡在：${mark.microAction}\n原因：${mark.reason}`}
                      />
                    )
                  })}
                </div>

                {/* 有卡顿时显示展开箭头提示 */}
                {hasStuck && (
                  <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] text-gray-400 select-none">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                )}
              </div>

              {/* 右侧：时长标注 */}
              <span className="text-[11px] text-gray-500 w-[44px] flex-shrink-0 text-right font-mono">
                {item.durationMin} min
              </span>
            </div>

            {/* 展开区域：卡顿详情列表 */}
            {isExpanded && hasStuck && (
              <div className="ml-[112px] mt-1.5 mb-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                {item.stuckMarks!.map((mark, mi) => (
                  <div
                    key={mi}
                    className="flex items-start gap-2 bg-red-50/60 rounded-md px-2.5 py-1.5 text-[11px]"
                  >
                    {/* 时间标签 */}
                    <span className="text-red-400 font-mono flex-shrink-0 mt-px">
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

      {/* 图例：已完成 vs 进行中 + 卡顿标记说明 */}
      <div className="flex items-center gap-4 pt-1 flex-wrap">
        {data.some(d => d.completed) && data.some(d => !d.completed) && (
          <>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-400/80" /> 已完成
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/70" /> 进行中
            </span>
          </>
        )}
        {data.some(d => d.stuckMarks && d.stuckMarks.length > 0) && (
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="w-2 h-2 rounded-full bg-red-500" /> 卡顿点（点击条形查看）
          </span>
        )}
      </div>
    </div>
  )
}

/** 将秒数格式化为 "Xm Ys" 的形式，方便阅读 */
function formatOffset(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return s > 0 ? `${m}m${s}s` : `${m}m`
}
