/**
 * TaskDurationChart —— 任务用时横向条形图
 *
 * 展示今日每个任务实际花费的时间（分钟），
 * 帮助用户直观感受"时间都花在哪了"。
 *
 * 数据来源：session.ended 事件的 totalDurationSeconds，按 taskTitle 聚合。
 */

interface TaskDurationItem {
  title: string
  durationMin: number
  completed: boolean   // 任务是否已完成（用于区分颜色）
}

interface TaskDurationChartProps {
  data: TaskDurationItem[]
}

export type { TaskDurationItem }

export default function TaskDurationChart({ data }: TaskDurationChartProps) {
  // 没有数据时不渲染
  if (data.length === 0) return null

  // 找到最长的条作为 100% 基准
  const maxMin = Math.max(...data.map(d => d.durationMin), 1)

  return (
    <div className="space-y-2.5">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5">
          {/* 左侧：任务名（允许折行，不截断） */}
          <span
            className="text-[11px] text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words"
          >
            {item.title}
          </span>

          {/* 中间：条形（无灰色背景，仅显示蓝色/琥珀色条） */}
          <div className="flex-1 h-[22px] rounded-lg overflow-hidden relative">
            <div
              className={`h-full rounded-lg transition-all duration-700 ease-out ${
                item.completed
                  ? 'bg-blue-400/80'        // 已完成：蓝色
                  : 'bg-amber-400/70'        // 进行中：琥珀色
              }`}
              style={{
                width: `${Math.max((item.durationMin / maxMin) * 100, 4)}%`,  // 最小 4% 宽度，保证看得见
              }}
            />
          </div>

          {/* 右侧：时长标注 */}
          <span className="text-[11px] text-gray-500 w-[44px] flex-shrink-0 text-right font-mono">
            {item.durationMin} min
          </span>
        </div>
      ))}

      {/* 图例：已完成 vs 进行中 */}
      {data.some(d => d.completed) && data.some(d => !d.completed) && (
        <div className="flex items-center gap-4 pt-1">
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-400/80" /> 已完成
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-400/70" /> 进行中
          </span>
        </div>
      )}
    </div>
  )
}
