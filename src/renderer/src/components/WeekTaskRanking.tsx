/**
 * WeekTaskRanking —— 周任务用时排行（Top 10 + 展开全部）
 *
 * 把 7 天所有任务平铺，按时长降序排列，不做跨天聚合。
 * 默认只展示 Top 10，底部 "展开剩余 N 项" 按钮。
 * 每条右侧标注日期（M/d），hover 显示完整日期 + 周几。
 */

import { useState, useMemo } from 'react'
import { formatTaskDuration, type TaskDurationItem } from './TaskDurationChart'
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

export default function WeekTaskRanking({ days }: Props) {
  const [showAll, setShowAll] = useState(false)

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
        const barWidthPct = Math.max((item.durationSec / maxSec) * 100, 4)

        return (
          <div key={`${item.date}-${item.title}-${i}`}>
            <div className="flex items-center gap-2.5">
              <span className="text-xxs text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words truncate"
                title={item.title}
              >
                {item.title}
              </span>

              <div className="flex-1 h-[22px] rounded-lg overflow-hidden relative">
                <div
                  className="h-full rounded-lg transition-all duration-700 ease-out bg-blue-400/80"
                  style={{ width: `${barWidthPct}%` }}
                />
              </div>

              <span className="text-xxs text-gray-500 w-[56px] flex-shrink-0 text-right font-mono">
                {formatTaskDuration(item.durationSec)}
              </span>

              <span
                className="text-3xs text-gray-400 bg-gray-100 rounded px-1 py-0.5 flex-shrink-0 cursor-default"
                title={item.dateFull}
              >
                {item.dateLabel}
              </span>
            </div>
          </div>
        )
      })}

      {/* 展开/收起按钮 */}
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full py-1.5 text-xxs text-blue-600 hover:text-blue-700
                     hover:bg-blue-50 rounded-lg transition-colors"
        >
          {showAll ? '收起' : `展开剩余 ${hiddenCount} 项`}
        </button>
      )}
    </div>
  )
}
