/**
 * WeekTaskRanking —— 周任务用时排行（Top 10 + 展开全部）
 *
 * 把 7 天所有任务平铺，按时长降序排列，不做跨天聚合。
 * 默认只展示 Top 10，底部 "展开剩余 N 项" 按钮。
 * 每条右侧标注日期（M/d），hover 显示完整日期 + 周几。
 */

import { useState, useMemo } from 'react'
import type { TaskDurationItem, StuckMark } from './TaskDurationChart'
import type { WeekDayData } from './WeekView'

/** 带日期信息的任务条目 */
interface RankedTaskItem extends TaskDurationItem {
  date: string
  weekday: string
  dateLabel: string    // 'M/d'
  dateFull: string     // '3月19日 周四'
}

interface Props {
  days: WeekDayData[]
}

const DEFAULT_SHOW = 10

/** 将秒数格式化为"第Xm Ys"，表示卡顿发生的时间点 */
function formatOffset(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `第${s}秒`
  return s > 0 ? `第${m}分${s}秒` : `第${m}分钟`
}

export default function WeekTaskRanking({ days }: Props) {
  const [showAll, setShowAll] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number>(-1)

  // 合并 7 天任务，按时长降序
  const allTasks: RankedTaskItem[] = useMemo(() => {
    const merged: RankedTaskItem[] = []
    for (const day of days) {
      for (const t of day.taskDurations) {
        merged.push(t)
      }
    }
    return merged.sort((a, b) => b.durationSec - a.durationSec)
  }, [days])

  if (allTasks.length === 0) {
    return (
      <div className="text-center py-4 text-gray-400 text-xs">
        近 7 天暂无任务数据
      </div>
    )
  }

  const visible = showAll ? allTasks : allTasks.slice(0, DEFAULT_SHOW)
  const hiddenCount = allTasks.length - DEFAULT_SHOW
  const maxSec = Math.max(...allTasks.map(d => d.durationSec), 1)

  return (
    <div className="space-y-2">
      {visible.map((item, i) => {
        const hasStuck = item.stuckMarks && item.stuckMarks.length > 0
        const isExpanded = expandedIdx === i
        const barWidthPct = Math.max((item.durationSec / maxSec) * 100, 4)
        const totalSec = item.durationSec

        return (
          <div key={`${item.date}-${item.title}-${i}`}>
            {/* 主行 */}
            <div
              className={`flex items-center gap-2.5 ${hasStuck ? 'cursor-pointer' : ''}`}
              onClick={() => hasStuck && setExpandedIdx(isExpanded ? -1 : i)}
            >
              {/* 任务名 */}
              <span className="text-xxs text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words truncate"
                title={item.title}
              >
                {item.title}
              </span>

              {/* 条形 + 卡顿标记 */}
              <div className="flex-1 h-[22px] rounded-lg overflow-hidden relative">
                <div
                  className="h-full rounded-lg transition-all duration-700 ease-out relative overflow-hidden bg-blue-400/80"
                  style={{ width: `${barWidthPct}%` }}
                >
                  {hasStuck && (item.stuckMarks ?? []).map((mark, mi) => {
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
                {hasStuck && (
                  <span className="absolute -right-4 top-1/2 -translate-y-1/2 text-3xs text-gray-400 select-none">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                )}
              </div>

              {/* 时长 */}
              <span className="text-xxs text-gray-500 w-[44px] flex-shrink-0 text-right font-mono">
                {item.durationSec >= 60 ? `${item.durationMin} min` : `${item.durationSec}s`}
              </span>

              {/* 日期小标签 */}
              <span
                className="text-3xs text-gray-400 bg-gray-100 rounded px-1 py-0.5 flex-shrink-0 cursor-default"
                title={item.dateFull}
              >
                {item.dateLabel}
              </span>
            </div>

            {/* 展开：卡顿详情 */}
            {isExpanded && hasStuck && (
              <div className="ml-[112px] mt-1.5 mb-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
                {(item.stuckMarks ?? []).map((mark, mi) => (
                  <div
                    key={mi}
                    className="flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xxs bg-red-50/60"
                  >
                    <span className="font-mono flex-shrink-0 mt-px text-red-400">
                      {formatOffset(mark.offsetSeconds)}
                    </span>
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

      {/* 展开/收起按钮 */}
      {hiddenCount > 0 && (
        <button
          onClick={() => { setShowAll(v => !v); setExpandedIdx(-1) }}
          className="w-full py-1.5 text-xxs text-indigo-500 hover:text-indigo-700
                     hover:bg-indigo-50 rounded-lg transition-colors"
        >
          {showAll ? '收起' : `展开剩余 ${hiddenCount} 项`}
        </button>
      )}

      {/* 图例：仅在有卡顿时显示 */}
      {allTasks.some(d => d.stuckMarks && d.stuckMarks.length > 0) && (
        <div className="flex items-center gap-4 pt-0.5">
          <span className="flex items-center gap-1.5 text-2xs text-gray-400">
            <span className="w-[8px] h-3 rounded-[2px] bg-red-400/90" /> 卡顿
          </span>
          <span className="text-2xs text-gray-300">（点击条形查看）</span>
        </div>
      )}
    </div>
  )
}
