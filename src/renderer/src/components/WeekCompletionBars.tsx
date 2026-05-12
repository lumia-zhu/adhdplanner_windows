/**
 * WeekCompletionBars —— 近 7 天每日完成率纵向柱状图
 *
 * X 轴：日期从左到右（M/d 周几缩写）
 * Y 轴：完成率 0-100%
 * hover 时 tooltip 显示 "完成 X/Y 步"。
 * 无数据天显示虚线占位 + "--"。
 */

import type { WeekDayData } from './WeekView'

interface Props {
  days: WeekDayData[]
  /** 临时演示用：在日期上方展示 7 天心情头像，后续删掉调用处即可隐藏 */
  showMoodDemo?: boolean
}

/** 柱状图高度（px） */
const BAR_AREA_H = 100
/** 顶部留白，给标签腾出空间 */
const BAR_PAD_TOP = 18
export const DEMO_MOOD_EMOJIS = ['😊', '🙂', '😐', '🙁', '😔', '🙂', '😊']
export const DEMO_MOOD_LABELS = ['很开心', '还不错', '一般', '有点低', '很低落', '还不错', '很开心']

export default function WeekCompletionBars({ days, showMoodDemo = false }: Props) {

  return (
    <div>
      {/* Y 轴刻度 + 柱子区域 */}
      <div className="flex">
        {/* Y 轴刻度标签 */}
        <div
          className="flex flex-col justify-between flex-shrink-0 pr-1.5"
          style={{ height: BAR_AREA_H + BAR_PAD_TOP, paddingTop: BAR_PAD_TOP }}
        >
          {[100, 75, 50, 25, 0].map(tick => (
            <span key={tick} className="text-3xs text-gray-400 tabular-nums leading-none text-right w-[24px]">
              {tick}%
            </span>
          ))}
        </div>

        {/* 柱子区域 */}
        <div className="flex-1 relative" style={{ height: BAR_AREA_H + BAR_PAD_TOP, paddingTop: BAR_PAD_TOP }}>
          {/* 水平参考线 */}
          {[0, 25, 50, 75, 100].map(tick => (
            <div
              key={tick}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ bottom: `${tick}%` }}
            />
          ))}

          {/* 7 根柱子 */}
          <div className="relative flex items-end justify-around h-full px-1">
            {days.map((day, i) => {
              const total = day.summary.stats.totalMicroSteps
              const completed = day.summary.stats.completedMicroSteps
              const hasData = day.hasData && total > 0
              const pct = hasData ? Math.round((completed / total) * 100) : 0

              return (
                <div
                  key={day.date}
                  className="flex flex-col items-center flex-1 relative"
                  style={{ height: '100%' }}
                  
                >
                  {/* 柱子容器（底部对齐） */}
                  <div className="flex-1 flex items-end justify-center w-full">
                    {hasData ? (
                      <div
                        className="w-[60%] max-w-[36px] rounded-t-md bg-indigo-400 hover:bg-indigo-500 transition-all duration-300 relative"
                        style={{ height: `${Math.max(pct, 3)}%` }}
                      >
                        {/* 柱顶百分比（hover 或 > 0 时显示） */}
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-3xs text-gray-500 font-mono tabular-nums whitespace-nowrap">
                          {pct}%
                        </span>
                      </div>
                    ) : (
                      <div className="w-[60%] max-w-[36px] flex items-center justify-center h-full">
                        <div className="w-px h-[60%] border-l border-dashed border-gray-200" />
                      </div>
                    )}
                  </div>

                  
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* X 轴：日期标签 */}
      <div className="flex ml-[28px]">
        {days.map((day, i) => (
          <div key={day.date} className="flex-1 text-center">
            {showMoodDemo && (
              <span
                className="mb-1 inline-flex h-6 w-6 items-center justify-center text-sm"
                title={`模拟心情：${DEMO_MOOD_LABELS[i % DEMO_MOOD_LABELS.length]}`}
              >
                {DEMO_MOOD_EMOJIS[i % DEMO_MOOD_EMOJIS.length]}
              </span>
            )}
            {showMoodDemo && <br />}
            <span className="text-2xs text-gray-500 tabular-nums leading-tight">
              {day.dateLabel}
            </span>
            <br />
            <span className="text-3xs text-gray-400">
              {day.weekdayShort}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
