/**
 * WeekMetricCards —— 周汇总指标卡片（日均）
 *
 * 3 张卡片：日均完成任务数、日均使用时长、日均任务时长。
 * 除以「有数据的天数」，避免无数据天拉低均值。
 */

import type { WeekDayData } from './WeekView'

interface Props {
  days: WeekDayData[]
}

export default function WeekMetricCards({ days }: Props) {
  // 只统计有实际数据的天
  const daysWithData = days.filter(d => d.hasData)
  const n = daysWithData.length || 1  // 避免除以 0

  // 日均完成任务数
  const totalCompleted = daysWithData.reduce((sum, d) => sum + d.summary.stats.completedMicroSteps, 0)
  const avgCompleted = (totalCompleted / n).toFixed(1)

  // 日均使用时长（分钟 → 显示）
  const totalUsage = daysWithData.reduce((sum, d) => sum + d.totalUsageMinutes, 0)
  const avgUsageMin = Math.round(totalUsage / n)
  const usageStr = avgUsageMin >= 60
    ? { value: (avgUsageMin / 60).toFixed(1), unit: '小时' }
    : { value: String(avgUsageMin), unit: '分钟' }

  // 日均任务时长
  const totalFocus = daysWithData.reduce((sum, d) => sum + d.summary.stats.totalFocusMinutes, 0)
  const avgFocusMin = Math.round(totalFocus / n)

  return (
    <div className="grid grid-cols-3 gap-3 w-full">
      <div className="text-center bg-emerald-50 rounded-xl py-2.5 px-2">
        <p className="text-lg font-bold text-emerald-600">
          {avgCompleted}
        </p>
        <p className="text-[10px] text-emerald-500 mt-0.5">日均完成任务</p>
      </div>
      <div className="text-center bg-blue-50 rounded-xl py-2.5 px-2">
        <p className="text-lg font-bold text-blue-600">
          {usageStr.value}
          <span className="text-xs font-normal ml-0.5">{usageStr.unit}</span>
        </p>
        <p className="text-[10px] text-blue-500 mt-0.5">日均使用时长</p>
      </div>
      <div className="text-center bg-indigo-50 rounded-xl py-2.5 px-2">
        <p className="text-lg font-bold text-indigo-600">
          {avgFocusMin}
          <span className="text-xs font-normal ml-0.5">分钟</span>
        </p>
        <p className="text-[10px] text-indigo-500 mt-0.5">日均任务时长</p>
      </div>
    </div>
  )
}
