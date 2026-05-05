/**
 * TaskDurationChart —— 任务用时横向条形图
 *
 * 展示今日每个任务实际花费的时间（分钟），
 * 帮助用户直观感受"时间都花在哪了"。
 *
 * 数据来源：session.ended 事件的 totalDurationSeconds，按 taskTitle 聚合。
 */


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
  onTaskHover?: (taskTitle: string | null) => void
  highlightTask?: string | null
  highlightPulseKey?: string
}

export function formatTaskDuration(durationSec: number): string {
  if (durationSec < 60) return `${durationSec}s`

  const minutes = Math.floor(durationSec / 60)
  const seconds = durationSec % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export type { TaskDurationItem, StuckMark }

export default function TaskDurationChart({ data, onTaskHover, highlightTask, highlightPulseKey }: TaskDurationChartProps) {
  if (data.length === 0) return null

  const maxSec = Math.max(...data.map(d => d.durationSec), 1)

  return (
    <div className="space-y-2.5">
      {data.map((item, i) => {
        const barWidthPct = Math.max((item.durationSec / maxSec) * 100, 4)
        const isHighlighted = highlightTask === item.title

        return (
          <div
            key={`${item.title}-${i}-${isHighlighted ? highlightPulseKey ?? 'pulse' : 'idle'}`}
            className={`rounded-xl transition-all duration-200 ${
              isHighlighted ? 'ai-focus-pulse px-1.5 py-1' : ''
            }`}
          >
            <div
              className="flex items-center gap-2.5"
              onMouseEnter={() => onTaskHover?.(item.title)}
              onMouseLeave={() => onTaskHover?.(null)}
            >
              <span
                className="text-xxs text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words"
              >
                {item.title}
              </span>

              <div className="flex-1 h-[22px] rounded-lg overflow-hidden relative">
                <div
                  className={`h-full rounded-lg transition-all duration-700 ease-out ${
                    isHighlighted ? 'bg-blue-400/80 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]' : 'bg-blue-400/80'
                  }`}
                  style={{ width: `${barWidthPct}%` }}
                />
              </div>

              <span className="text-xxs text-gray-500 w-[56px] flex-shrink-0 text-right font-mono">
                {formatTaskDuration(item.durationSec)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
