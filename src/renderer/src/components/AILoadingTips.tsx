import { useEffect, useMemo, useState } from 'react'

interface AILoadingTipsProps {
  variant: 'start' | 'stuck'
  title: string
  compact?: boolean
}

const START_TIPS = [
  '先把任务写成一个动作',
  '先定下一步，不定全部',
  '先做 30 秒能完成的事',
  '先打开工具，再想内容',
  '先写一个最粗的版本',
  '先把第一步说具体',
]

const STUCK_TIPS = [
  '先把卡点说成一句话',
  '先找卡住的是哪一步',
  '先缩小下一步的范围',
  '先分清是没思路还是没信息',
  '先换一个更小的入口',
  '先问现在还能做哪一点',
]

function shuffle<T>(items: T[]): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

export default function AILoadingTips({ variant, title, compact = false }: AILoadingTipsProps) {
  const tips = useMemo(
    () => shuffle(variant === 'start' ? START_TIPS : STUCK_TIPS),
    [variant],
  )
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    setTipIndex(0)
  }, [tips])

  useEffect(() => {
    if (tips.length <= 1) return
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length)
    }, 2600)
    return () => window.clearInterval(timer)
  }, [tips])

  const currentTip = tips[tipIndex] ?? ''
  const isStart = variant === 'start'

  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'gap-2 py-4' : 'gap-3 py-3'}`}>
      <div className={`flex items-center gap-2 ${isStart ? 'text-emerald-500' : 'text-amber-500'}`}>
        <span
          className={`rounded-full animate-spin border-2 ${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${
            isStart ? 'border-emerald-200 border-t-emerald-500' : 'border-amber-200 border-t-amber-500'
          }`}
        />
        <span className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}>{title}</span>
      </div>

      <div className={`flex flex-col items-center ${compact ? 'min-h-[28px]' : 'min-h-[34px]'}`}>
        <p
          key={`${variant}-${tipIndex}`}
          className={`${compact ? 'text-[12px]' : 'text-[13px]'} leading-relaxed
                     ${isStart ? 'text-emerald-400/85' : 'text-amber-400/85'}
                     animate-in fade-in duration-300`}
        >
          {currentTip}
        </p>
      </div>
    </div>
  )
}
