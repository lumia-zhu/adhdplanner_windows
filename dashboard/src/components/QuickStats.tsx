'use client'

import type { QuickStatsResult } from '@/lib/stats'

interface Props {
  stats: QuickStatsResult
  onStatClick: (statKey: string) => void
}

const STAT_DEFS = [
  { key: 'aiSuggestionRate', label: 'AI建议使用率', format: 'percent', tab: 'behavior', filter: 'plan.first_micro' },
  { key: 'aiCompletionRate', label: 'AI建议完成率', format: 'percent', tab: 'behavior', filter: 'session.macro_completed' },
  { key: 'reflectionRate', label: '反思完成率', format: 'percent', tab: 'behavior', filter: 'reflect.' },
  { key: 'totalFocusMinutes', label: '专注总时长', format: 'minutes', tab: 'behavior', filter: 'session.ended' },
  { key: 'taskCompletionRate', label: '任务完成率', format: 'percent', tab: 'tasks', filter: '' },
  { key: 'stuckCount', label: '卡住次数', format: 'count', tab: 'behavior', filter: 'stuck.' },
  { key: 'focusToComputerRatio', label: '专注/电脑比', format: 'ratio', tab: 'tasks', filter: '' },
] as const

function formatValue(value: number | null, fmt: string): string {
  if (value === null) return '-'
  switch (fmt) {
    case 'percent': return `${Math.round(value * 100)}%`
    case 'minutes': return `${value} 分钟`
    case 'count': return String(value)
    case 'ratio': return value.toFixed(2)
    default: return String(value)
  }
}

export default function QuickStats({ stats, onStatClick }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 p-6 pb-2">
      {STAT_DEFS.map(def => {
        const value = stats[def.key as keyof QuickStatsResult] as number | null
        return (
          <button
            key={def.key}
            onClick={() => onStatClick(def.key)}
            className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all text-left group"
          >
            <p className="text-xs text-gray-500 mb-1 group-hover:text-blue-600">{def.label}</p>
            <p className="text-xl font-bold text-gray-800 group-hover:text-blue-700">
              {formatValue(value, def.format)}
            </p>
          </button>
        )
      })}
    </div>
  )
}

export { STAT_DEFS }
