/**
 * DayTimeline —— 一日时间轴
 *
 * 纵向时间轴，展示今天的任务执行轨迹
 * 每个节点：时间段 + 任务名 + 状态标记
 */

interface TimelineEntry {
  /** 时间字符串，如 "10:00 - 11:30" */
  time: string
  /** 任务/微任务名 */
  title: string
  /** 状态 */
  status: 'completed' | 'stuck' | 'abandoned' | 'flow'
  /** 耗时（分钟），可选 */
  durationMin?: number
}

interface DayTimelineProps {
  entries: TimelineEntry[]
}

const STATUS_CONFIG: Record<TimelineEntry['status'], { icon: string; color: string; bg: string; border: string }> = {
  completed:  { icon: '✅', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  stuck:      { icon: '🆘', color: 'text-orange-600',  bg: 'bg-orange-50',  border: 'border-orange-200'  },
  abandoned:  { icon: '❌', color: 'text-red-500',     bg: 'bg-red-50',     border: 'border-red-200'     },
  flow:       { icon: '🔥', color: 'text-violet-600',  bg: 'bg-violet-50',  border: 'border-violet-200'  },
}

export type { TimelineEntry }

export default function DayTimeline({ entries }: DayTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-300">
        <svg className="w-10 h-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm">今天还没有任务记录</p>
      </div>
    )
  }

  return (
    <div className="relative pl-6">
      {/* 纵向连接线 */}
      <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-gray-200 rounded-full" />

      <div className="flex flex-col gap-3">
        {entries.map((entry, i) => {
          const cfg = STATUS_CONFIG[entry.status]
          return (
            <div key={i} className="relative flex items-start gap-3">
              {/* 时间轴节点 */}
              <div
                className={`absolute -left-6 top-1.5 w-[22px] h-[22px] rounded-full border-2 ${cfg.border} ${cfg.bg}
                            flex items-center justify-center text-2xs z-10`}
              >
                {cfg.icon}
              </div>

              {/* 内容卡片 */}
              <div className={`flex-1 ${cfg.bg} border ${cfg.border} rounded-lg px-3 py-2`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-gray-400 font-mono flex-shrink-0">
                    {entry.time}
                  </span>
                  {entry.durationMin != null && (
                    <span className="text-2xs text-gray-300">
                      ({entry.durationMin}分钟)
                    </span>
                  )}
                </div>
                <p className={`text-sm font-medium mt-0.5 ${cfg.color} leading-snug`}>
                  {entry.title}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
