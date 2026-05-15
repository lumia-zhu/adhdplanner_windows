/**
 * WeekCompletionBars —— 近 7 天每日完成率纵向柱状图
 *
 * X 轴：日期从左到右（M/d 周几缩写）
 * 左 Y 轴：完成率 0-100%
 * 右 Y 轴：心情 1-5，真实心情优先，缺失时按配置断开或用灰色占位延续。
 * hover 时 tooltip 显示 "完成 X/Y 步" 和当天心情。
 * 无数据天显示虚线占位 + "--"。
 */

import { useMemo, useState } from 'react'
import type { WeekDayData } from './WeekView'
import { MOOD_LABELS, type MoodValue } from '../utils/mood'

interface Props {
  days: WeekDayData[]
  /** 为 true 时只保留完成率柱状图与左轴，隐藏心情折线与右侧 1–5 刻度 */
  barsOnly?: boolean
  /** 柱子颜色模式：默认单色；moodSaturation 用 1-5 心情色阶 */
  colorMode?: 'single' | 'moodSaturation'
  /** 预览用心情序列：1-5 为模拟心情，null 为模拟未记录 */
  moodPreviewValues?: readonly (MoodValue | null)[]
  /** 折线预览用心情序列：1-5 为模拟心情，null 为模拟未记录 */
  lineMoodPreviewValues?: readonly (MoodValue | null)[]
  /** 折线遇到未记录心情时的处理方式：默认沿用示例心情补齐 */
  lineMissingMoodMode?: 'fillDemo' | 'breakOnMissing' | 'carryForwardDotted'
  /** 为 true 时只展示心情点，不绘制点之间的连线 */
  moodPointsOnly?: boolean
  /** 为 true 时隐藏完成率数字标签，避免遮挡心情点 */
  hidePctLabels?: boolean
  /** 右侧心情轴标签样式 */
  moodAxisLabelMode?: 'numeric' | 'textOnly'
  /** 为 true 时即使隐藏心情趋势，也保留右侧心情轴宽度，避免图表切换时压缩 */
  reserveMoodAxisSpace?: boolean
  /** 未记录心情的视觉样式 */
  missingMoodStyle?: 'gray' | 'whiteDashed'
  /** 是否在图下方展示 1-5 心情色阶图例 */
  showMoodLegend?: boolean
}

/** 柱状图高度（px） */
const BAR_AREA_H = 100
/** 顶部留白，给标签腾出空间 */
const BAR_PAD_TOP = 18
/**
 * 从左到右 7 天的示例心情档位（1–5），与原先演示文案序列一致：
 * 很开心、还不错、一般、有点低、很低落、还不错、很开心。
 * 真实心情缺失时用于补齐 7 天折线，也用于底部「不同心情下的任务完成率」预览聚合。
 */
export const DEMO_MOOD_VALUES: readonly number[] = [5, 4, 3, 2, 1, 4, 5]

const SINGLE_BAR_COLOR = '#818cf8'
const MOOD_LINE_COLOR = '#4f46e5'
const MOOD_AXIS_LABELS = [5, 4, 3, 2, 1]
const PCT_LABEL_OFFSET_PX = 20
const PCT_LABEL_MIN_TOP_PX = -12
const MISSING_MOOD_BAR_COLOR = '#d1d5db'
const MISSING_MOOD_LINE_COLOR = '#9ca3af'
const MOOD_SATURATION_COLORS: Record<MoodValue, string> = {
  1: '#eff3ff',
  2: '#bdd7e7',
  3: '#6baed6',
  4: '#3182bd',
  5: '#08519c',
}

/** 导出供周视图其他图表使用同一套填充色 */
export function getMoodBarFillColor(_mood: number): string {
  return SINGLE_BAR_COLOR
}

/** 周序列中的第几天（0-based）：有记录用真实 mood，否则用 DEMO_MOOD_VALUES 对应位置 */
export function getEffectiveMoodForWeekDayIndex(dayIndex: number, recordedMood: number | undefined | null): number {
  const m = recordedMood != null ? Number(recordedMood) : NaN
  if (Number.isInteger(m) && m >= 1 && m <= 5) return m
  const idx = ((dayIndex % DEMO_MOOD_VALUES.length) + DEMO_MOOD_VALUES.length) % DEMO_MOOD_VALUES.length
  return DEMO_MOOD_VALUES[idx]!
}

function getMoodLabel(mood: number): string {
  return MOOD_LABELS.find(item => item.value === mood)?.label ?? '未记录'
}

function getMoodSaturationMeta(day: WeekDayData, dayIndex: number, moodPreviewValues?: readonly (MoodValue | null)[]) {
  const previewMood = moodPreviewValues?.[dayIndex]
  const mood = previewMood !== undefined ? previewMood : day.moodRecord?.mood ?? null

  if (mood == null) {
    return {
      color: MISSING_MOOD_BAR_COLOR,
      title: '心情：未记录',
      isMissing: true,
    }
  }

  return {
    color: MOOD_SATURATION_COLORS[mood],
    title: `心情：${getMoodLabel(mood)}（${mood}/5）`,
    isMissing: false,
  }
}

export default function WeekCompletionBars({
  days,
  barsOnly = false,
  colorMode = 'single',
  moodPreviewValues,
  lineMoodPreviewValues,
  lineMissingMoodMode = 'fillDemo',
  moodPointsOnly = false,
  hidePctLabels = false,
  moodAxisLabelMode = 'numeric',
  reserveMoodAxisSpace = false,
  missingMoodStyle = 'gray',
  showMoodLegend = false,
}: Props) {
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number | null>(null)
  const [hoveredBarRect, setHoveredBarRect] = useState<{ left: number; top: number; width: number } | null>(null)
  const dayToX = (index: number) => ((index + 0.5) / days.length) * 100
  const moodToY = (mood: number) => ((5 - mood) / 4) * 100
  const useMoodSaturation = colorMode === 'moodSaturation'
  const shouldBreakOnMissingLineMood = lineMissingMoodMode === 'breakOnMissing'
  const shouldCarryForwardMissingMood = lineMissingMoodMode === 'carryForwardDotted'

  const moodPoints = barsOnly
    ? []
    : (() => {
      let lastKnownMood: number | null = null
      return days.map((day, index) => {
        const previewMood = lineMoodPreviewValues?.[index]
        const hasPreviewMood = previewMood !== undefined
        const recordedMood = day.moodRecord?.mood
        const hasRecordedMood = recordedMood != null
        const mood = hasPreviewMood ? previewMood : (hasRecordedMood ? recordedMood : null)
        const isMissing = mood == null
        const carriedMood = shouldCarryForwardMissingMood ? lastKnownMood : null
        const fallbackMood = shouldCarryForwardMissingMood
          ? carriedMood
          : getEffectiveMoodForWeekDayIndex(index, recordedMood)
        const displayMood = isMissing ? fallbackMood : mood

        if (!isMissing && displayMood != null) {
          lastKnownMood = displayMood
        }

        if (displayMood == null) {
          return {
            x: dayToX(index),
            y: 0,
            mood: null,
            label: '未记录',
            isDemo: false,
            isMissing,
            isDrawable: false,
            isCarryForward: false,
          }
        }

        return {
          x: dayToX(index),
          y: moodToY(displayMood),
          mood: displayMood,
          label: isMissing ? '未记录' : getMoodLabel(displayMood),
          isDemo: hasPreviewMood || recordedMood == null,
          isMissing,
          isDrawable: true,
          isCarryForward: isMissing && shouldCarryForwardMissingMood,
        }
      })
    })()

  const moodLineSegments = barsOnly || moodPointsOnly
    ? []
    : moodPoints.slice(1).flatMap((point, index) => {
        const previousPoint = moodPoints[index]!
        if (!previousPoint.isDrawable || !point.isDrawable) return []
        if (shouldBreakOnMissingLineMood && (previousPoint.isMissing || point.isMissing)) return []
        return [{ from: previousPoint, to: point, isDotted: previousPoint.isMissing || point.isMissing }]
      })

  const dayStats = days.map((day, dayIndex) => {
    const total = day.summary.stats.totalMicroSteps
    const completed = day.summary.stats.completedMicroSteps
    const hasData = day.hasData && total > 0
    const pct = hasData ? Math.round((completed / total) * 100) : 0
    const moodSaturationMeta = useMoodSaturation
      ? getMoodSaturationMeta(day, dayIndex, moodPreviewValues)
      : undefined
    const moodPoint = !barsOnly ? moodPoints[dayIndex] : undefined
    const moodTitle = moodSaturationMeta?.title ?? (moodPoint
      ? `${moodPoint.isDemo ? '心情（示例）' : '心情'}：${moodPoint.label}`
      : '')
    const barHeightPct = Math.max(pct, 3)
    const labelTop = Math.max(
      PCT_LABEL_MIN_TOP_PX,
      BAR_AREA_H - (barHeightPct / 100) * BAR_AREA_H - PCT_LABEL_OFFSET_PX,
    )

    const barTitle = `完成率 ${pct}%${hasData ? ` · ${moodTitle.startsWith('心情') ? moodTitle : `心情：${moodTitle}`}` : ''}`

    return {
      day,
      total,
      completed,
      hasData,
      pct,
      moodTitle,
      barTitle,
      barColor: moodSaturationMeta?.isMissing && missingMoodStyle === 'whiteDashed'
        ? '#ffffff'
        : moodSaturationMeta?.color ?? SINGLE_BAR_COLOR,
      barBorder: moodSaturationMeta?.isMissing && missingMoodStyle === 'whiteDashed'
        ? '1px dashed #94a3b8'
        : undefined,
      barHeightPct,
      labelTop,
    }
  })

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

        {/* 柱子区域 + 心情折线：柱子、线、点共用同一个绘图区坐标 */}
        <div className="flex-1 relative" style={{ height: BAR_AREA_H + BAR_PAD_TOP, paddingTop: BAR_PAD_TOP }}>
          {/* 水平参考线 */}
          {[0, 25, 50, 75, 100].map(tick => (
            <div
              key={tick}
              className="absolute left-0 right-0 border-t border-gray-100"
              style={{ top: `calc(${BAR_PAD_TOP}px + ${(100 - tick) / 100 * BAR_AREA_H}px)` }}
            />
          ))}

          {!barsOnly ? (
            <svg
              className="pointer-events-none absolute left-0 right-0 z-30 w-full overflow-visible"
              style={{ top: BAR_PAD_TOP, height: BAR_AREA_H }}
            >
              {moodLineSegments.map((segment, i) => (
                <line
                  key={i}
                  x1={`${segment.from.x}%`}
                  y1={`${segment.from.y}%`}
                  x2={`${segment.to.x}%`}
                  y2={`${segment.to.y}%`}
                  stroke={segment.isDotted ? MISSING_MOOD_LINE_COLOR : MOOD_LINE_COLOR}
                  strokeLinecap="round"
                  strokeDasharray={segment.isDotted ? '4 4' : undefined}
                  strokeWidth={2}
                />
              ))}
              {moodPoints.map((point, i) => !point.isDrawable ? null : (
                <circle
                  key={`${days[i]?.date}-mood`}
                  cx={`${point.x}%`}
                  cy={`${point.y}%`}
                  r={point.isMissing ? 4.2 : 4.5}
                  fill={point.isMissing ? 'white' : MOOD_LINE_COLOR}
                  stroke={point.isMissing ? MISSING_MOOD_LINE_COLOR : 'white'}
                  strokeDasharray={point.isMissing ? '2 2' : undefined}
                  strokeWidth={point.isMissing ? 1.8 : 2}
                >
                  <title>
                    {point.isCarryForward
                      ? `心情：未记录，沿用前一天位置显示（${point.mood}/5）`
                      : `${point.isDemo ? '心情（示例）' : '心情'}：${point.label}（${point.mood}/5）`}
                  </title>
                </circle>
              ))}
            </svg>
          ) : null}

          {/* 7 根柱子 */}
          <div
            className="absolute left-0 right-0 grid grid-cols-7 px-1"
            style={{ top: BAR_PAD_TOP, height: BAR_AREA_H }}
          >
            {dayStats.map(({ day, hasData, barColor, barBorder, barHeightPct, barTitle }, dayIndex) => {
              return (
                <div
                  key={day.date}
                  className="relative flex h-full items-end justify-center"
                  onMouseEnter={() => setHoveredDayIndex(dayIndex)}
                  onMouseLeave={() => setHoveredDayIndex(null)}
                >
                  <div
                    className="pointer-events-none absolute inset-0 z-50"
                    title={barTitle}
                    aria-hidden="true"
                  />
                  {hasData ? (
                    <div
                      className="relative w-[60%] max-w-[36px] rounded-t-md bg-indigo-400 transition-all duration-300 hover:bg-indigo-500"
                      style={{
                        height: `${barHeightPct}%`,
                        backgroundColor: barColor,
                        border: barBorder,
                      }}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>

          {hoveredBarRect ? (() => {
            const stat = dayStats[hoveredDayIndex ?? -1]
            if (!stat) return null
            return (
              <div
                className="pointer-events-none absolute z-[60] -translate-x-1/2 -translate-y-full rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] leading-relaxed text-white shadow-lg"
                style={{
                  left: hoveredBarRect.left,
                  top: hoveredBarRect.top - 8,
                  maxWidth: Math.max(180, hoveredBarRect.width * 2),
                }}
              >
                <div className="font-medium">任务完成率：{stat.pct}%</div>
                {stat.hasData ? (
                  <div className="text-gray-200">{stat.moodTitle}</div>
                ) : (
                  <div className="text-gray-200">当天无数据</div>
                )}
              </div>
            )
          })() : null}

          <div
            className="absolute left-0 right-0 z-50 grid grid-cols-7 px-1"
            style={{ top: BAR_PAD_TOP, height: BAR_AREA_H }}
          >
            {dayStats.map(({ day, barTitle }, dayIndex) => (
              <div
                key={`${day.date}-hover`}
                className="h-full"
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setHoveredDayIndex(dayIndex)
                  setHoveredBarRect({
                    left: rect.left + rect.width / 2,
                    top: rect.top,
                    width: rect.width,
                  })
                }}
                onMouseLeave={() => {
                  setHoveredDayIndex(null)
                  setHoveredBarRect(null)
                }}
              >
                <div className="h-full w-full" aria-hidden="true" />
              </div>
            ))}
          </div>

          {!hidePctLabels ? (
            <div
              className="pointer-events-none absolute left-0 right-0 z-40 grid grid-cols-7 px-1"
              style={{ top: BAR_PAD_TOP, height: BAR_AREA_H }}
            >
              {dayStats.map(({ day, hasData, pct, labelTop }) => (
                <div key={`${day.date}-pct`} className="relative h-full">
                  {hasData ? (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 rounded bg-white/85 px-0.5 font-mono text-3xs text-gray-500 tabular-nums leading-none shadow-[0_0_4px_rgba(255,255,255,0.9)]"
                      style={{ top: labelTop }}
                    >
                      {pct}%
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {!barsOnly || reserveMoodAxisSpace ? (
          <div
            className={`relative flex-shrink-0 pl-1.5 ${moodAxisLabelMode === 'textOnly' ? 'w-[44px]' : 'w-[20px]'}`}
            style={{ height: BAR_AREA_H + BAR_PAD_TOP, paddingTop: BAR_PAD_TOP }}
            title="心情：1 很低落，5 很开心"
          >
            {!barsOnly ? MOOD_AXIS_LABELS.map(tick => (
              <span
                key={tick}
                className={`absolute left-1.5 -translate-y-1/2 text-left text-3xs leading-none text-indigo-400 ${moodAxisLabelMode === 'textOnly' ? 'w-[38px]' : 'w-[14px] tabular-nums'}`}
                style={{ top: `calc(${BAR_PAD_TOP}px + ${moodToY(tick) / 100 * BAR_AREA_H}px)` }}
              >
                {moodAxisLabelMode === 'textOnly' ? getMoodLabel(tick) : tick}
              </span>
            )) : null}
          </div>
        ) : null}
      </div>

      {/* X 轴：日期标签 */}
      <div className={`flex ml-[28px] ${barsOnly && !reserveMoodAxisSpace ? 'mr-2' : moodAxisLabelMode === 'textOnly' ? 'mr-[44px]' : 'mr-[20px]'}`}>
        {days.map((day) => (
          <div key={day.date} className="flex-1 text-center">
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

      {showMoodLegend ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-3xs text-gray-500">
          {MOOD_LABELS.map(item => (
            <span key={item.value} className="inline-flex items-center gap-1">
              <span
                className="h-3 w-3 rounded-sm border border-black/10"
                style={{ backgroundColor: MOOD_SATURATION_COLORS[item.value] }}
              />
              <span>{item.label}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span
              className="h-3 w-3 rounded-sm border border-black/10"
              style={{
                backgroundColor: missingMoodStyle === 'whiteDashed' ? '#ffffff' : MISSING_MOOD_BAR_COLOR,
                border: missingMoodStyle === 'whiteDashed' ? '1px dashed #94a3b8' : undefined,
              }}
            />
            <span>未记录</span>
          </span>
        </div>
      ) : null}
    </div>
  )
}
