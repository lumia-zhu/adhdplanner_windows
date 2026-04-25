/**
 * AppUsageRanking —— 应用使用时长排行（Top 10 + 展开全部）
 *
 * 把传入的 ActivityRecord[] 里所有 appUsage 字段累加，得到每个应用的总秒数。
 * 展示精度：≥ 60 秒按分钟整数显示（如「12 分钟」）；< 60 秒显示「< 1 分钟」。
 * 排序：按总秒数降序。
 *
 * 数据来源：每条 ActivityRecord 是一个 30 秒聚合窗口，appUsage[appName] = 该应用
 * 在窗口内被采到的次数（每 2 秒一次采样，最多 15 次 = 30 秒）。所以秒数 = 次数 × 2。
 */

import { useState, useMemo } from 'react'
import type { ActivityRecord } from './ActivityHeatmap'

interface Props {
  data: ActivityRecord[]
}

/** 每次采样间隔（秒），与主进程 ActivitySampler.SAMPLE_INTERVAL 保持一致 */
const SAMPLE_INTERVAL_SEC = 2

const DEFAULT_SHOW = 10

const EXCLUDED_APP_NAMES = new Set([
  'electron',
  'metaplan',
  'task-manager',
  '任务管理器',
  'explorer',
  'windows explorer',
  'file explorer',
  '资源管理器',
  'windows terminal',
  'terminal',
  'powershell',
  'windows powershell',
  'command prompt',
  'cmd',
  'conhost',
  'openconsole',
])

interface AppUsageItem {
  name: string
  seconds: number
}

function shouldShowAppName(name: string): boolean {
  return !EXCLUDED_APP_NAMES.has(name.trim().toLowerCase())
}

/** 把秒数格式化为展示字符串：≥60 秒按分钟整数，否则「< 1 分钟」 */
function formatUsage(seconds: number): string {
  if (seconds < 60) return '< 1 分钟'
  return `${Math.round(seconds / 60)} 分钟`
}

export default function AppUsageRanking({ data }: Props) {
  const [showAll, setShowAll] = useState(false)

  const allApps: AppUsageItem[] = useMemo(() => {
    const totals = new Map<string, number>()
    for (const rec of data) {
      if (!rec.appUsage) continue
      for (const [name, count] of Object.entries(rec.appUsage)) {
        if (typeof count !== 'number' || count <= 0) continue
        if (!shouldShowAppName(name)) continue
        totals.set(name, (totals.get(name) || 0) + count * SAMPLE_INTERVAL_SEC)
      }
    }
    return Array.from(totals.entries())
      .map(([name, seconds]) => ({ name, seconds }))
      .sort((a, b) => b.seconds - a.seconds)
  }, [data])

  if (allApps.length === 0) {
    return (
      <div className="text-center py-4 text-gray-400 text-xs">
        暂无应用使用数据
      </div>
    )
  }

  const visible = showAll ? allApps : allApps.slice(0, DEFAULT_SHOW)
  const hiddenCount = allApps.length - DEFAULT_SHOW
  const maxSec = Math.max(...allApps.map(d => d.seconds), 1)

  return (
    <div className="space-y-2">
      {visible.map((item, i) => {
        const barWidthPct = Math.max((item.seconds / maxSec) * 100, 4)
        return (
          <div key={`${item.name}-${i}`}>
            <div className="flex items-center gap-2.5">
              <span
                className="text-xxs text-gray-600 w-[100px] text-right flex-shrink-0 leading-tight break-words truncate"
                title={item.name}
              >
                {item.name}
              </span>

              <div className="flex-1 h-[22px] rounded-lg overflow-hidden relative">
                <div
                  className="h-full rounded-lg transition-all duration-700 ease-out bg-emerald-400/80"
                  style={{ width: `${barWidthPct}%` }}
                />
              </div>

              <span className="text-xxs text-gray-500 w-[60px] flex-shrink-0 text-right font-mono">
                {formatUsage(item.seconds)}
              </span>
            </div>
          </div>
        )
      })}

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
