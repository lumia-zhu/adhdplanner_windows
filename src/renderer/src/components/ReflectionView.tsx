/**
 * ReflectionView —— 每日反思主页面
 *
 * 默认：数据可视化全屏居中，右下角 AI 浮标引导
 * 点击浮标：窗口变宽 + 对话侧边栏从右侧滑入
 * 中间可拖拽分隔条调整比例
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { DailyMoodRecord, Task, UserProfile } from '../types'
import type { AIConfig, ReflectionStyle, VisualTarget } from '../services/ai'
import { buildReflectionSystemPrompt, buildWeeklyReflectionSystemPrompt, extractMemoryFromChat } from '../services/ai'
import type { TrackEvent, DailySummary } from '../services/tracker'
import { buildDailySummary, summaryToLLMContext, buildWeeklyLLMContext } from '../services/tracker'
import DonutChart from './DonutChart'
import TaskDurationChart from './TaskDurationChart'
import type { TaskDurationItem, StuckMark } from './TaskDurationChart'
import DayTimeline from './DayTimeline'
import type { TimelineEntry } from './DayTimeline'
import ActivityHeatmap from './ActivityHeatmap'
import type { ActivityRecord } from './ActivityHeatmap'
import { getActiveRatio } from './ActivityHeatmap'
import ActivityRhythmChart from './ActivityRhythmChart'
import InteractiveActivityHeatmap from './InteractiveActivityHeatmap'
import { computeActiveTimeRange } from '../utils/activity-time-range'
import AppUsageRanking from './AppUsageRanking'
import ChartInfoTooltip from './ChartInfoTooltip'
import ReflectionChat from './ReflectionChat'
import type { ReflectionChatHandle, VisualFocusType, VisualRef } from './ReflectionChat'
import { buildReflectionMemoryCapsule, expireOldCommitments, recordReflectionMemory } from '../services/memory-manager'
import ManualTimeEntry from './ManualTimeEntry'
import MiniCalendar from './MiniCalendar'
import WeekView from './WeekView'
import type { WeekDayData } from './WeekView'
import { getWeekDates } from './WeekView'
import { computeWeekActiveTimeRange } from './WeekHeatmapGrid'
import { tracker } from '../services/tracker'
import { getMoodOptionForDate, parseMoodRecord } from '../utils/mood'

interface ReflectionViewProps {
  tasks: Task[]
  aiConfig: AIConfig
  userProfile: UserProfile
  onClose: () => void
}

// ===================== 常量 =====================

/** AI 浮标随机引导语 —— 今天 */
const BUBBLE_HINTS_TODAY = [
  '今天过得怎么样？来聊聊~',
  '回顾一下今天，发现你的亮点 💡',
  '嘿，有什么想聊的吗？',
  '数据已准备好，一起来看看吧！',
  '花 2 分钟回顾，明天更高效 🚀',
  '今天的你，值得被看见 🌟',
]

/** AI 浮标随机引导语 —— 历史日期 */
const BUBBLE_HINTS_HISTORY = [
  '回头看看这一天，会有新发现 🔍',
  '历史数据也值得反思哦~',
  '来复盘这天的表现吧 📊',
  '看看过去的自己，聊聊感受？',
  '翻翻老数据，找找规律 💡',
]

/** AI 浮标随机引导语 —— 周视图 */
const BUBBLE_HINTS_WEEK = [
  '一起看看这周的节奏吧 📊',
  '周复盘比日复盘更能发现规律~',
  '哪天状态最好？来聊聊 💡',
  '这周有什么发现？点我~',
  '找找跨天的规律，下周更高效 🚀',
]

/** 主窗口默认尺寸（和 src/main/window.ts 里的 MAIN_WIDTH / MAIN_HEIGHT 一致） */
const MAIN_WIDTH = 480
const MAIN_HEIGHT = 760
/** 侧边栏展开时窗口总宽度 */
const EXPANDED_WIDTH = 880
/** 反思页大窗口模式：尽量接近屏幕尺寸，但图表内容仍用 max-width 防止变形 */
const REFLECTION_FULLSCREEN_MAX_WIDTH = 1320
const REFLECTION_FULLSCREEN_MAX_HEIGHT = 900
/** 侧边栏最小宽度 */
const MIN_CHAT_WIDTH = 320
/** 侧边栏最大宽度占比 */
const MAX_CHAT_RATIO = 0.65
/** 数据区最小宽度 */
const MIN_DATA_WIDTH = 300

function getReflectionFullscreenSize(): { width: number; height: number } {
  const screenWidth = window.screen?.availWidth || REFLECTION_FULLSCREEN_MAX_WIDTH
  const screenHeight = window.screen?.availHeight || REFLECTION_FULLSCREEN_MAX_HEIGHT
  return {
    width: Math.max(EXPANDED_WIDTH, Math.min(REFLECTION_FULLSCREEN_MAX_WIDTH, screenWidth - 48)),
    height: Math.max(MAIN_HEIGHT, Math.min(REFLECTION_FULLSCREEN_MAX_HEIGHT, screenHeight - 48)),
  }
}

// ===================== 辅助函数 =====================

/** 从 tracker 事件流构建时间轴条目 */
function buildTimelineEntries(events: TrackEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const event of events) {
    const ts = new Date(event.timestamp)
    const timeStr = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`

    if (event.type === 'exec.micro_completed') {
      const p = event.payload
      entries.push({
        time: timeStr,
        title: p.microAction,
        status: 'completed',
        durationMin: Math.round(p.actualSeconds / 60),
      })
    } else if (event.type === 'exec.flow_entered') {
      entries.push({
        time: timeStr,
        title: `🔥 心流：${event.payload.taskTitle}`,
        status: 'flow',
      })
    } else if (event.type === 'exec.flow_ended') {
      entries.push({
        time: timeStr,
        title: `心流结束`,
        status: 'flow',
        durationMin: Math.round(event.payload.flowDurationSeconds / 60),
      })
    } else if (event.type === 'stuck.triggered') {
      entries.push({
        time: timeStr,
        title: `卡住：${event.payload.microAction}`,
        status: 'stuck',
        durationMin: Math.round(event.payload.elapsedSeconds / 60),
      })
    } else if (event.type === 'abandon.exit') {
      entries.push({
        time: timeStr,
        title: `放弃：${event.payload.microAction}`,
        status: 'abandoned',
        durationMin: Math.round(event.payload.elapsedSeconds / 60),
      })
    }
  }

  return entries
}

/** 获取今日日期字符串 YYYY-MM-DD */
function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 日期加减 n 天，返回 YYYY-MM-DD */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function normalizeTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[0-9０-９]+/g, ' ')
    .replace(/[（(].*?[）)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compareLevel(current: number, average: number): 'higher' | 'lower' | 'similar' {
  if (average <= 0) return 'similar'
  if (current >= average * 1.25) return 'higher'
  if (current <= average * 0.75) return 'lower'
  return 'similar'
}

function buildProfileContext(profile: UserProfile): string {
  const lines: string[] = []
  if (profile.preferredName) {
    lines.push(`- 用户希望被称呼为：${profile.preferredName}`)
  }
  if (profile.major || profile.grade) {
    lines.push(`- 背景：${[profile.grade, profile.major].filter(Boolean).join('，')}`)
  }
  if (profile.challenges.length > 0) {
    lines.push(`- 用户自述挑战：${profile.challenges.join('、')}`)
  }
  if (profile.workplaces.length > 0) {
    lines.push(`- 常用学习/工作场景：${profile.workplaces.join('、')}`)
  }
  if (lines.length === 0) return ''
  return [
    '## 用户画像（只作温和理解，不要贴标签）',
    ...lines,
    '- 使用原则：只有和当前数据自然相关时才提，不要说“你就是……”。',
  ].join('\n')
}

/** 把 YYYY-MM-DD 格式化为友好显示，如 "3月12日 周四" */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function formatDateFriendly(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

const APP_USAGE_SAMPLE_INTERVAL_SEC = 2
const PROMPT_EXCLUDED_APP_NAMES = new Set([
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

const HIGHLIGHT_DURATION_MS = 3500
const HIGHLIGHT_START_DELAY_MS = 160
const SPOTLIGHT_FADE_OUT_MS = 500
const SPOTLIGHT_WAIT_VISIBLE_MS = 2200
const SPOTLIGHT_TARGET_LOOKUP_MS = 300
const SPOTLIGHT_SCROLL_STABLE_FRAMES = 6
const SPOTLIGHT_SCROLL_EPSILON_PX = 0.5
// const REFLECTION_STYLE_STORAGE_KEY = 'reflectionStyle'

const FOCUS_FALLBACK_CHARTS: Record<VisualFocusType, string> = {
  'activity-hour': 'chart-activity-heatmap',
  'activity-range': 'chart-activity-heatmap',
  'task-duration': 'chart-task-duration',
  metric: 'chart-key-metrics',
  'app-usage': 'chart-app-usage',
}

const WEEK_FOCUS_FALLBACK_CHARTS: Record<VisualFocusType, string> = {
  'activity-hour': 'chart-week-heatmap',
  'activity-range': 'chart-week-heatmap',
  'task-duration': 'chart-week-ranking',
  metric: 'chart-week-metrics',
  'app-usage': 'chart-week-app-usage',
}

const CHART_FOCUS_ROOTS: Record<string, string> = {
  'chart-rhythm': 'chart-activity-heatmap',
  'chart-week-rhythm': 'chart-week-heatmap',
}

const METRIC_KEYS = new Set(['completed-tasks', 'computer-usage', 'focus-minutes'])

interface ActiveHighlight {
  id: string
  type: VisualFocusType
  value: string
  label: string
  startHour?: number
  endHour?: number
  /** 并列多个应用（方案 A） */
  appNames?: string[]
}

interface SpotlightRect {
  top: number
  left: number
  right: number
  bottom: number
  panelTop: number
  panelLeft: number
  panelRight: number
  panelBottom: number
  panelWidth: number
  panelHeight: number
}

function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatDurationForPrompt(seconds: number): string {
  if (seconds < 60) return `${Math.max(Math.round(seconds), 1)}秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}分钟`
  return `${(minutes / 60).toFixed(1)}小时`
}

function shouldIncludePromptAppName(name: string): boolean {
  return !PROMPT_EXCLUDED_APP_NAMES.has(name.trim().toLowerCase())
}

function normalizeRefText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9０-９]+/g, ' ')
    .replace(/[（(].*?[）)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findBestTaskTitleMatch(value: string, items: TaskDurationItem[]): string | null {
  const target = normalizeRefText(value)
  if (!target) return null

  const exact = items.find(item => normalizeRefText(item.title) === target)
  if (exact) return exact.title

  const partial = items
    .filter(item => {
      const title = normalizeRefText(item.title)
      return title.includes(target) || target.includes(title)
    })
    .sort((a, b) => b.durationSec - a.durationSec)

  return partial[0]?.title ?? null
}

function getVisibleAppUsageNames(records: ActivityRecord[], limit = 5): string[] {
  const totals = new Map<string, number>()
  for (const rec of records) {
    if (!rec.appUsage) continue
    for (const [name, count] of Object.entries(rec.appUsage)) {
      if (typeof count !== 'number' || count <= 0) continue
      if (!shouldIncludePromptAppName(name)) continue
      totals.set(name, (totals.get(name) ?? 0) + count)
    }
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name)
}

function findBestAppNameMatch(value: string, records: ActivityRecord[]): string | null {
  const target = value.trim().toLowerCase()
  if (!target) return null

  const visibleNames = getVisibleAppUsageNames(records)
  const exact = visibleNames.find(name => name.trim().toLowerCase() === target)
  if (exact) return exact

  return visibleNames.find(name => {
    const normalized = name.trim().toLowerCase()
    return normalized.includes(target) || target.includes(normalized)
  }) ?? null
}

function getWeekTaskDurations(days: WeekDayData[]): TaskDurationItem[] {
  return days
    .flatMap(day => day.taskDurations)
    .filter(task => task.durationSec > 0)
    .sort((a, b) => b.durationSec - a.durationSec)
}

function buildActivityTargets(records: ActivityRecord[], chartId: string, rangeStart: number, rangeEnd: number): VisualTarget[] {
  const targets: VisualTarget[] = []
  const hourBuckets = Array.from({ length: 24 }, () => 0)
  for (const record of records) {
    const hour = new Date(record.ts).getHours()
    hourBuckets[hour] += getActiveRatio(record)
  }

  for (let hour = rangeStart; hour < rangeEnd; hour++) {
    if (hourBuckets[hour] <= 0) continue
    targets.push({
      targetId: `activity:hour:${hour}`,
      type: 'activity_hour',
      chartId,
      label: `${hour}:00-${hour + 1}:00 电脑活动`,
      value: String(hour),
      startHour: hour,
      endHour: hour + 1,
    })
  }

  let activeRangeStart: number | null = null
  for (let hour = rangeStart; hour <= rangeEnd; hour++) {
    const isActive = hour < rangeEnd && hourBuckets[hour] > 0
    if (isActive && activeRangeStart == null) activeRangeStart = hour
    if ((!isActive || hour === rangeEnd) && activeRangeStart != null) {
      const activeRangeEnd = hour
      if (activeRangeEnd - activeRangeStart >= 2) {
        targets.push({
          targetId: `activity:range:${activeRangeStart}-${activeRangeEnd}`,
          type: 'activity_range',
          chartId,
          label: `${activeRangeStart}:00-${activeRangeEnd}:00 电脑活动`,
          value: `${activeRangeStart}-${activeRangeEnd}`,
          startHour: activeRangeStart,
          endHour: activeRangeEnd,
        })
      }
      activeRangeStart = null
    }
  }

  return targets
}

function buildVisualMarkerPromptContext(visualTargets: VisualTarget[]): string {
  if (visualTargets.length === 0) {
    return [
      '流式同步高亮可用整图 chartId：',
      '- chart-key-metrics：核心指标卡片',
      '- chart-task-duration：任务实际用时条形图',
      '- chart-activity-heatmap：电脑活动分布',
      '- chart-rhythm：电脑活动图',
      '- chart-app-usage：应用使用时长',
      '没有明确局部证据时，只输出整图 chartId。',
    ].join('\n')
  }

  return [
    '流式同步高亮可用局部 targetId（只能从这里选，禁止编造）：',
    JSON.stringify(visualTargets.slice(0, 40)),
    '如果只确定整张图而不确定局部位置，可用对应 chartId。',
  ].join('\n')
}

function buildTaskSessionPromptContext(events: TrackEvent[]): string {
  const lines: string[] = []

  for (const event of events) {
    if (event.type !== 'session.ended') continue
    const payload = event.payload as {
      taskTitle?: string
      totalDurationSeconds?: number
      endReason?: string
      source?: string
    }
    if (!payload.taskTitle || !payload.totalDurationSeconds || payload.totalDurationSeconds <= 0) continue

    const endTs = event.timestamp
    const startTs = endTs - payload.totalDurationSeconds * 1000
    const sourceLabel = payload.source === 'manual' ? '补记' : '实时记录'
    const statusLabel = payload.endReason === 'task_done'
      ? '完成'
      : payload.endReason === 'manual_entry'
        ? '补记'
        : payload.endReason === 'pause'
          ? '暂停'
          : '结束'

    lines.push(
      `- ${payload.taskTitle}：${formatClockTime(startTs)}-${formatClockTime(endTs)}，${formatDurationForPrompt(payload.totalDurationSeconds)}，${statusLabel}（${sourceLabel}）`
    )
  }

  if (lines.length === 0) return ''

  return [
    '任务真实发生时间段（严格来自 session.ended 的结束时间和用时反推；不要用电脑活跃高峰推断任务完成时间）：',
    ...lines.slice(-12),
  ].join('\n')
}

function buildAppUsagePromptContext(records: ActivityRecord[]): string {
  const totalByApp = new Map<string, number>()
  const hourlyByApp = new Map<number, Map<string, number>>()

  for (const record of records) {
    if (!record.appUsage) continue
    const hour = new Date(record.ts).getHours()
    let hourMap = hourlyByApp.get(hour)
    if (!hourMap) {
      hourMap = new Map<string, number>()
      hourlyByApp.set(hour, hourMap)
    }

    for (const [appName, count] of Object.entries(record.appUsage)) {
      if (typeof count !== 'number' || count <= 0) continue
      if (!shouldIncludePromptAppName(appName)) continue

      const seconds = count * APP_USAGE_SAMPLE_INTERVAL_SEC
      totalByApp.set(appName, (totalByApp.get(appName) || 0) + seconds)
      hourMap.set(appName, (hourMap.get(appName) || 0) + seconds)
    }
  }

  const totalApps = [...totalByApp.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, seconds]) => `${name} ${formatDurationForPrompt(seconds)}`)

  const hourlyLines = [...hourlyByApp.entries()]
    .map(([hour, apps]) => {
      const topApps = [...apps.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
      const totalSeconds = topApps.reduce((sum, [, seconds]) => sum + seconds, 0)
      return {
        hour,
        totalSeconds,
        text: `${hour}:00-${hour + 1}:00：${topApps.map(([name, seconds]) => `${name} ${formatDurationForPrompt(seconds)}`).join('、')}`,
      }
    })
    .filter(item => item.totalSeconds > 0)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 5)
    .map(item => item.text)

  if (totalApps.length === 0 && hourlyLines.length === 0) return ''

  return [
    '应用使用时长（仅记录应用名，不记录窗口标题/网址；可用于解释电脑活跃时段在做什么）：',
    totalApps.length > 0 ? `- 总排行：${totalApps.join('、')}` : '',
    hourlyLines.length > 0 ? `- 分时段 Top 应用：${hourlyLines.join('；')}` : '',
  ].filter(Boolean).join('\n')
}

function getChartFocusRootId(chartId: string): string {
  return CHART_FOCUS_ROOTS[chartId] ?? chartId
}

function ChartFocusSection({
  id,
  className = '',
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  return (
    <div id={id} className={`relative rounded-xl transition-[filter] duration-200 ${className}`}>
      {children}
    </div>
  )
}

// ===================== 主组件 =====================

export default function ReflectionView({ tasks: propTasks, aiConfig, userProfile, onClose }: ReflectionViewProps) {
  const [events, setEvents] = useState<TrackEvent[]>([])
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [activityData, setActivityData] = useState<ActivityRecord[]>([])
  const [memoryContext, setMemoryContext] = useState('')
  const [memoryLoaded, setMemoryLoaded] = useState(false)
  const [insightContext, setInsightContext] = useState('')
  const [insightLoaded, setInsightLoaded] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [localTasks, setLocalTasks] = useState<Task[]>(propTasks)

  // ---- 侧边栏状态（默认展开，用户无需手动点击机器人图标） ----
  const [chatOpen, setChatOpen] = useState(true)
  const [chatWidth, setChatWidth] = useState(400)
  const [reflectionFullscreen, setReflectionFullscreen] = useState(false)
  // 截图功能已移除：纯文本数据更精确、可控、可调试，避免视觉误读
  const dataPanelRef = useRef<HTMLDivElement>(null)
  const hasDisplayDataRef = useRef(false)
  const [manualEntryExpanded, setManualEntryExpanded] = useState(false)
  const chatRef = useRef<ReflectionChatHandle>(null)
  const [closingAfterSave, setClosingAfterSave] = useState(false)

  // ---- 任务 hover 联动热力图 ----
  const [hoveredTask, setHoveredTask] = useState<string | null>(null)
  const [showAllTaskDistribution, setShowAllTaskDistribution] = useState(false)

  // ---- AI 视觉引用高亮：同一时间只保留一个重点位置 ----
  const [activeHighlight, setActiveHighlight] = useState<ActiveHighlight | null>(null)
  const [focusedChartId, setFocusedChartId] = useState<string | null>(null)
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null)
  const [spotlightVisible, setSpotlightVisible] = useState(false)
  const spotlightTargetRef = useRef<Element | null>(null)
  const spotlightFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spotlightWaitFrameRef = useRef<number | null>(null)
  const spotlightRequestRef = useRef(0)
  const chartHighlightRef = useRef<string | null>(null)

  // ---- AI 浮标气泡 ----
  const [showBubble, setShowBubble] = useState(false)

  // ---- 日/周 视图模式 ----
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')
  const trackerMode = viewMode === 'week' ? 'weekly' : 'daily'
  const [reflectionStyle] = useState<ReflectionStyle>('free')
  // 三段式/自由反思切换暂时下线；保留旧初始化逻辑，后续需要恢复切换时可直接放开。
  // const [reflectionStyle, setReflectionStyle] = useState<ReflectionStyle>(() => {
  //   try {
  //     return localStorage.getItem(REFLECTION_STYLE_STORAGE_KEY) === 'free' ? 'free' : 'structured'
  //   } catch {
  //     return 'structured'
  //   }
  // })

  // ---- 日期选择 & 日历弹窗 ----
  const today = getToday()
  const [selectedDate, setSelectedDate] = useState(today)
  const isToday = selectedDate === today
  const [displayDate, setDisplayDate] = useState(today)
  const [displayEvents, setDisplayEvents] = useState<TrackEvent[]>([])
  const [displaySummary, setDisplaySummary] = useState<DailySummary | null>(null)
  const [displayActivityData, setDisplayActivityData] = useState<ActivityRecord[]>([])
  const [displayTasks, setDisplayTasks] = useState<Task[]>(propTasks)
  const [displayMoodRecord, setDisplayMoodRecord] = useState<DailyMoodRecord | null>(null)
  const [moodNoteExpanded, setMoodNoteExpanded] = useState(false)
  const moodPillRef = useRef<HTMLDivElement>(null)
  const [isDataTransitioning, setIsDataTransitioning] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const displayIsToday = displayDate === today
  const [reflCalendarOpen, setReflCalendarOpen] = useState(false)

  // ---- 周视图导航 ----
  // weekEndDate 始终是周视图范围的最后一天
  const [weekEndDate, setWeekEndDate] = useState(today)

  // ---- 周视图 AI 数据 ----
  const [weekDayData, setWeekDayData] = useState<WeekDayData[] | null>(null)

  // 浮标气泡文案：根据视图模式和日期区分
  const bubbleText = useMemo(() => {
    if (viewMode === 'week') {
      return BUBBLE_HINTS_WEEK[Math.floor(Math.random() * BUBBLE_HINTS_WEEK.length)]
    }
    const hints = isToday ? BUBBLE_HINTS_TODAY : BUBBLE_HINTS_HISTORY
    return hints[Math.floor(Math.random() * hints.length)]
  }, [viewMode, isToday])

  const goPrev = useCallback(() => {
    setActiveHighlight(null)
    setSelectedDate(d => shiftDate(d, -1))
  }, [])
  const goNext = useCallback(() => {
    setActiveHighlight(null)
    setSelectedDate(d => {
      const next = shiftDate(d, 1)
      return next > getToday() ? d : next   // 不能超过今天
    })
  }, [])
  const goToday = useCallback(() => {
    setActiveHighlight(null)
    setSelectedDate(getToday())
  }, [])

  // const handleReflectionStyleChange = useCallback((style: ReflectionStyle) => {
  //   setReflectionStyle(style)
  //   try {
  //     localStorage.setItem(REFLECTION_STYLE_STORAGE_KEY, style)
  //   } catch {
  //     // 忽略 localStorage 不可用；本次会话仍会切换。
  //   }
  // }, [])

  // ---- 拖拽分隔条 ----
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // ---- 反思页面生命周期追踪 ----
  const reflectOpenedAt = useRef(Date.now())
  const hadChatRef = useRef(false)
  const hadEndedProperlyRef = useRef(false)

  // 挂载时立即扩展窗口（chatOpen 默认 true，需要匹配宽度）
  useEffect(() => {
    window.electronAPI.resizeMainWindow(EXPANDED_WIDTH, MAIN_HEIGHT)
    hadChatRef.current = true
  }, [])

  // 追踪反思页面打开
  useEffect(() => {
    reflectOpenedAt.current = Date.now()
    tracker.track('reflect.opened', { date: selectedDate, mode: trackerMode }, {
      date: selectedDate,
      logicalDate: selectedDate,
    })
    return () => {
      tracker.track('reflect.closed', {
        date: selectedDate,
        mode: trackerMode,
        durationMs: Date.now() - reflectOpenedAt.current,
        hadChat: hadChatRef.current,
        hadEndedProperly: hadEndedProperlyRef.current,
      }, {
        date: selectedDate,
        logicalDate: selectedDate,
      })
    }
  }, [selectedDate, trackerMode])

  // 切换日期或视图后收起全部任务分布，避免把上一页的查看状态带到新数据上
  useEffect(() => {
    setShowAllTaskDistribution(false)
    setHoveredTask(null)
  }, [selectedDate, viewMode])

  // 加载选中日期的事件数据 + 活跃度数据 + 任务
  useEffect(() => {
    let cancelled = false
    let transitionTimer: ReturnType<typeof setTimeout> | null = null
    async function loadEvents() {
      setLoadingData(true)
      if (hasDisplayDataRef.current) {
        setIsDataTransitioning(true)
        setContentVisible(false)
      }
      setSummary(null)  // 立即清空，防止 systemPrompt 用旧日期数据初始化 AI 对话
      try {
        // ★ 如果是今天，先刷新 tracker 缓冲区确保最新数据
        if (selectedDate === getToday()) {
          await tracker.flushAsync()
        }

        const [raw, rawActivity, rawTasks, rawMood] = await Promise.all([
          window.electronAPI.loadTrackerEvents(selectedDate),
          window.electronAPI.loadActivityData(selectedDate),
          window.electronAPI.loadTasks(selectedDate),
          window.electronAPI.loadMoodRecord(selectedDate),
        ])

        if (cancelled) return  // 防止切换日期后旧请求覆盖新数据

        const typedEvents = raw as TrackEvent[]
        setEvents(typedEvents)
        setActivityData(rawActivity as ActivityRecord[])
        setLocalTasks(rawTasks as Task[])

        const s = buildDailySummary(selectedDate, typedEvents)
        setDisplayDate(selectedDate)
        setDisplayEvents(typedEvents)
        setDisplayActivityData(rawActivity as ActivityRecord[])
        setDisplayTasks(rawTasks as Task[])
        setDisplayMoodRecord(parseMoodRecord(rawMood))
        setMoodNoteExpanded(false)
        setDisplaySummary(s)
        hasDisplayDataRef.current = true
        setSummary(s)
      } catch (e) {
        console.error('加载反思数据失败:', e)
      } finally {
        if (!cancelled) {
          setLoadingData(false)
          requestAnimationFrame(() => setContentVisible(true))
          transitionTimer = setTimeout(() => setIsDataTransitioning(false), 220)
        }
      }
    }
    loadEvents()
    return () => {
      cancelled = true
      if (transitionTimer) clearTimeout(transitionTimer)
    }
  }, [selectedDate])

  // 加载记忆上下文（开场 prompt 注入用）；随当前数据更新，挑选相关记忆而不是塞入全部历史。
  useEffect(() => {
    setMemoryLoaded(false)
    ;(async () => {
      try {
        const store = await expireOldCommitments()
        console.log('[Memory Debug] loadMemory 返回:', `sessions=${store.sessions.length}, commitments=${store.commitments.length}`)
        const ctx = buildReflectionMemoryCapsule(store, {
          date: selectedDate,
          mode: viewMode === 'week' ? 'weekly' : 'daily',
          tasks: localTasks,
          summary,
          events,
        })
        console.log('[Memory Debug] 胶囊 memoryContext 长度:', ctx.length, ctx ? `\n${ctx}` : '(空)')
        setMemoryContext(ctx)
      } catch (e) {
        console.warn('[Memory] 加载记忆上下文失败:', e)
      } finally {
        setMemoryLoaded(true)
        console.log('[Memory Debug] memoryLoaded = true')
      }
    })()
  }, [selectedDate, viewMode, localTasks, summary, events])

  // 加载可用洞察线索：按证据选择当天模式、任务延续、卡顿恢复、用户画像或历史对比。
  useEffect(() => {
    let cancelled = false
    setInsightLoaded(false)

    async function loadInsightContext() {
      try {
        const dates = Array.from({ length: 14 }, (_, index) => shiftDate(selectedDate, -index))
        const rows = await Promise.all(dates.map(async date => {
          const [rawTasks, rawEvents] = await Promise.all([
            window.electronAPI.loadTasks(date).catch(() => []),
            window.electronAPI.loadTrackerEvents(date).catch(() => []),
          ])
          const tasks = Array.isArray(rawTasks) ? (rawTasks as Task[]) : []
          const dayEvents = Array.isArray(rawEvents) ? (rawEvents as TrackEvent[]) : []
          const hasData = tasks.length > 0 || dayEvents.length > 0
          const daySummary = dayEvents.length > 0 ? buildDailySummary(date, dayEvents) : null
          return { date, tasks, summary: daySummary, hasData }
        }))

        if (cancelled) return

        const current = rows.find(row => row.date === selectedDate)
        const historyRows = rows.filter(row => row.date !== selectedDate && row.hasData)
        const lines: string[] = [
          '## 可用洞察线索（供 AI 选择，不要求全部使用）',
          '- 使用顺序：先讲当前图表事实，再按需选择当天内部模式、任务延续、卡顿恢复、用户画像、记忆或历史对比。',
          '- 主线对齐：选择洞察时必须和当前引用的图表接得上；电脑活动图优先讲整天活跃节奏，任务用时图只讲任务总耗时/排行，电脑活动分布图负责任务时间段、卡顿红点、卡住前后变化。',
          '- 交互方式：每次只展开一个值得注意的行为模式；如果用户点击“换一个角度看看”，再换到另一个有图表证据支持的方向。',
          '- 历史对比只是可选证据；数据不足或不相关时不要强行对比。',
        ]

        if (current?.summary) {
          const s = current.summary.stats
          const completedTasks = current.tasks.filter(task => task.completed).length
          const pendingTasks = current.tasks.filter(task => !task.completed).length
          lines.push(`- 当前日期概况：完成任务 ${completedTasks} 个，未完成任务 ${pendingTasks} 个，专注 ${s.totalFocusMinutes} 分钟，卡顿 ${s.totalStuckCount} 次。`)
          if (s.totalStuckCount > 0) {
            const stuckReasons = current.summary.stuckEvents
              .map(event => event.reason)
              .filter(Boolean)
              .slice(0, 3)
            lines.push(`- 可选卡顿线索（优先配合【chart:activity】电脑活动分布图）：卡顿红点显示在任务时间分布线上，主要和 ${stuckReasons.join('、') || '执行过程'} 有关。适合问开放小问题，例如“当时最先让你停下来的可能是什么？不用想得很完整，大概说说也可以。”不要用【chart:task-duration】来指代卡顿红点位置。`)
          }
          if (current.summary.flowEvents.length > 0) {
            const flowTasks = current.summary.flowEvents.map(event => event.taskTitle).filter(Boolean).slice(0, 3)
            lines.push(`- 可选任务推进线索：出现过心流推进，相关任务：${flowTasks.join('、')}。如果讲任务总用时可配合【chart:task-duration】；如果讲推进发生在哪段时间或前后状态，优先配合【chart:activity】。`)
          }
        }

        const yesterdayDate = shiftDate(selectedDate, -1)
        const yesterday = rows.find(row => row.date === yesterdayDate)
        if (current?.summary && yesterday?.summary) {
          const currentStats = current.summary.stats
          const yesterdayStats = yesterday.summary.stats
          const currentCompleted = current.tasks.filter(task => task.completed).length
          const currentPending = current.tasks.filter(task => !task.completed).length
          const yesterdayCompleted = yesterday.tasks.filter(task => task.completed).length
          const yesterdayPending = yesterday.tasks.filter(task => !task.completed).length
          lines.push(`- 昨日对比线索（仅当用户明确问“昨天”时优先使用）：昨天（${yesterdayDate}）完成任务 ${yesterdayCompleted} 个，未完成任务 ${yesterdayPending} 个，专注 ${yesterdayStats.totalFocusMinutes} 分钟，卡顿 ${yesterdayStats.totalStuckCount} 次；当前日期（${selectedDate}）完成任务 ${currentCompleted} 个，未完成任务 ${currentPending} 个，专注 ${currentStats.totalFocusMinutes} 分钟，卡顿 ${currentStats.totalStuckCount} 次。用户问“今天和昨天”时，只使用当前日期与昨天做比较，不要改用前几次或 13 天历史平均。`)
        } else {
          lines.push(`- 昨日对比限制：没有找到昨天（${yesterdayDate}）的完整行为摘要；如果用户问“今天和昨天”，明确说目前没有昨天数据，不能硬比较，不要改用 13 天历史平均代替昨天。`)
        }

        const repeatedPending = new Map<string, { title: string; days: string[] }>()
        for (const row of rows.filter(row => row.hasData)) {
          for (const task of row.tasks) {
            if (task.completed) continue
            const key = normalizeTaskTitle(task.title)
            if (!key) continue
            const existing = repeatedPending.get(key) ?? { title: task.title, days: [] }
            existing.days.push(row.date)
            repeatedPending.set(key, existing)
          }
        }
        const longPending = [...repeatedPending.values()]
          .filter(item => item.days.length >= 2)
          .sort((a, b) => b.days.length - a.days.length)
          .slice(0, 3)
        if (longPending.length > 0) {
          lines.push(`- 可选任务延续线索（适合配合任务用时图）：这些任务在多个记录日仍未完成：${longPending.map(item => `「${item.title}」${item.days.length}天`).join('、')}。适合问“最挡在前面的一小步是什么”，不要直接下结论。`)
        }

        const reasonCounts = new Map<string, number>()
        let successfulRescues = 0
        for (const row of rows) {
          for (const event of row.summary?.stuckEvents ?? []) {
            if (event.reason) reasonCounts.set(event.reason, (reasonCounts.get(event.reason) ?? 0) + 1)
            if (event.rescueSucceeded) successfulRescues += 1
          }
        }
        const repeatedReasons = [...reasonCounts.entries()]
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
        if (repeatedReasons.length > 0) {
          lines.push(`- 可选反复卡点线索（适合配合任务过程图表）：${repeatedReasons.map(([reason, count]) => `「${reason}」${count}次`).join('、')}。适合围绕用户自己的上下文继续问。`)
        }
        if (successfulRescues > 0) {
          lines.push(`- 可选恢复线索（优先配合【chart:activity】电脑活动分布图）：记录中有 ${successfulRescues} 次卡住后继续推进，可用于事实型鼓励。卡住后是否接上，要看活动分布里的时间线和卡顿点，不要只看任务用时排行。`)
        }

        const historySummaries = historyRows.map(row => row.summary).filter((s): s is DailySummary => !!s)
        if (historySummaries.length >= 2 && current?.summary) {
          const avgFocus = Math.round(historySummaries.reduce((sum, s) => sum + s.stats.totalFocusMinutes, 0) / historySummaries.length)
          const avgStuck = historySummaries.reduce((sum, s) => sum + s.stats.totalStuckCount, 0) / historySummaries.length
          const focusLevel = compareLevel(current.summary.stats.totalFocusMinutes, avgFocus)
          const stuckLevel = compareLevel(current.summary.stats.totalStuckCount, avgStuck)
          lines.push(`- 可选历史对比：可用历史 ${historySummaries.length} 天；当前专注时长相对前几次为 ${focusLevel}，当前卡顿次数相对前几次为 ${stuckLevel}。只有和当前话题相关时才使用。`)
        } else {
          lines.push('- 历史对比限制：可用历史不足 2 天时，不要做跨天对比，也不要说长期规律。')
        }

        const profileContext = buildProfileContext(userProfile)
        setInsightContext(profileContext ? `${lines.join('\n')}\n\n${profileContext}` : lines.join('\n'))
      } catch (e) {
        console.warn('[Reflection Insight] 加载洞察线索失败:', e)
        if (!cancelled) setInsightContext('')
      } finally {
        if (!cancelled) setInsightLoaded(true)
      }
    }

    loadInsightContext()
    return () => { cancelled = true }
  }, [selectedDate, userProfile])


  // 气泡提示：打开 1.2 秒后显示，5 秒后自动隐藏
  useEffect(() => {
    if (chatOpen) {
      setShowBubble(false)
      return
    }
    const showTimer = setTimeout(() => setShowBubble(true), 1200)
    const hideTimer = setTimeout(() => setShowBubble(false), 7000)
    return () => {
      clearTimeout(showTimer)
      clearTimeout(hideTimer)
    }
  }, [chatOpen])

  useEffect(() => {
    if (!moodNoteExpanded) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && moodPillRef.current && !moodPillRef.current.contains(target)) {
        setMoodNoteExpanded(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [moodNoteExpanded])

  // 计算任务完成率
  const completionRate = useMemo(() => {
    if (displayTasks.length === 0) return 0
    return Math.round((displayTasks.filter(t => t.completed).length / displayTasks.length) * 100)
  }, [displayTasks])

  // 构建时间轴条目
  const timelineEntries = useMemo(() => buildTimelineEntries(displayEvents), [displayEvents])

  // 构建任务用时数据（从 session.ended 事件聚合），同时附带卡顿标记
  const taskDurations: TaskDurationItem[] = useMemo(() => {
    // ---- 1. 按任务名聚合所有 session 的总时长 ----
    // 注意：同一任务可能有多个 session（暂停→恢复），只统计 endReason 不是 'pause' 的时长
    // 来避免 pause 和 resume 后重复计时
    const durationMap = new Map<string, number>()

    // ---- 2. 判断任务是否已完成（三重判断，任意一个成立即可） ----
    //   a. session.ended 的 endReason 中出现过 'task_done'
    //   b. 存在 session.macro_completed 事件
    //   c. tasks 列表中标记为 completed
    const everTaskDone = new Set<string>()         // 曾出现 endReason='task_done'
    const macroCompleted = new Set<string>()        // 有 macro_completed 事件

    // ---- 3. 记录每个 sessionId 的起始时间和所属任务名 ----
    const sessionStartMap = new Map<string, { timestamp: number; taskTitle: string }>()

    // ---- 4. 记录每个任务下各 session 的排列顺序和时长（用于计算卡顿点的累计偏移） ----
    // taskTitle → [{sessionId, durationSec}]（按时间顺序排列）
    const sessionOrderByTask = new Map<string, { sessionId: string; durationSec: number }[]>()

    for (const e of displayEvents) {
      if (e.type === 'session.started') {
        const p = e.payload as { sessionId: string; taskTitle: string }
        sessionStartMap.set(p.sessionId, { timestamp: e.timestamp, taskTitle: p.taskTitle })
      }
      if (e.type === 'session.ended') {
        const p = e.payload as { sessionId: string; taskTitle: string; totalDurationSeconds: number; endReason: string }
        durationMap.set(p.taskTitle, (durationMap.get(p.taskTitle) || 0) + p.totalDurationSeconds)

        // 记录该 session 的时长（按顺序追加）
        if (!sessionOrderByTask.has(p.taskTitle)) {
          sessionOrderByTask.set(p.taskTitle, [])
        }
        sessionOrderByTask.get(p.taskTitle)?.push({
          sessionId: p.sessionId,
          durationSec: p.totalDurationSeconds,
        })

        // 只要曾经出现过 task_done，就标记
        if (p.endReason === 'task_done') {
          everTaskDone.add(p.taskTitle)
        }
      }
      if (e.type === 'session.macro_completed') {
        const p = e.payload as { taskTitle: string }
        macroCompleted.add(p.taskTitle)
      }
    }

    // 建立 localTasks 中已完成的任务名集合
    const completedTaskTitles = new Set(displayTasks.filter(t => t.completed).map(t => t.title))

    // ---- 5. 收集卡顿标记，并计算正确的累计偏移 ----
    const stuckMarksByTask = new Map<string, StuckMark[]>()

    // 预构建"恢复事件"索引：同 sessionId 下在 stuck.triggered 之后出现的恢复性事件
    // 有这些事件说明卡顿已解决：stuck.pivot_chosen / exec.micro_started / exec.micro_completed / exec.flow_entered
    const resolvedSessionSet = new Set<string>()
    for (const e of displayEvents) {
      if (
        e.type === 'stuck.pivot_chosen' ||
        e.type === 'exec.micro_started' ||
        e.type === 'exec.micro_completed' ||
        e.type === 'exec.flow_entered'
      ) {
        const p = e.payload as { sessionId: string }
        resolvedSessionSet.add(p.sessionId)
      }
    }

    for (const e of displayEvents) {
      if (e.type === 'stuck.triggered') {
        const p = e.payload as { sessionId: string; microAction: string; elapsedSeconds: number }
        const sessionInfo = sessionStartMap.get(p.sessionId)
        if (!sessionInfo) continue

        const taskTitle = sessionInfo.taskTitle
        const sessionsOfTask = sessionOrderByTask.get(taskTitle) || []

        // 计算该 session 之前所有 session 的累计时长
        let cumulativeBefore = 0
        for (const s of sessionsOfTask) {
          if (s.sessionId === p.sessionId) break
          cumulativeBefore += s.durationSec
        }

        // 卡顿在整条任务时间线上的真实偏移 = 前面的累计 + 本 session 内的已过秒数
        const offsetSeconds = Math.round(cumulativeBefore + p.elapsedSeconds)

        // 找对应的 stuck.reason：同 sessionId，且时间在此事件之后最近的一条
        let reason = ''
        for (const re of displayEvents) {
          if (re.type === 'stuck.reason') {
            const rp = re.payload as { sessionId: string; reason: string }
            if (rp.sessionId === p.sessionId && re.timestamp >= e.timestamp) {
              reason = rp.reason
              break
            }
          }
        }

        // 判断卡顿是否已解决：同 session 中在卡顿之后是否有恢复性事件
        let resolved = false
        for (const re of displayEvents) {
          if (re.timestamp <= e.timestamp) continue
          const rp = re.payload as { sessionId?: string }
          if (rp.sessionId !== p.sessionId) continue
          if (
            re.type === 'stuck.pivot_chosen' ||
            re.type === 'exec.micro_started' ||
            re.type === 'exec.micro_completed' ||
            re.type === 'exec.flow_entered'
          ) {
            resolved = true
            break
          }
        }

        const mark: StuckMark = {
          offsetSeconds,
          microAction: p.microAction,
          reason,
          resolved,
        }

        if (!stuckMarksByTask.has(taskTitle)) {
          stuckMarksByTask.set(taskTitle, [])
        }
        stuckMarksByTask.get(taskTitle)?.push(mark)
      }
    }

    // ---- 6. 转为数组，按时长降序排列 ----
    // ★ 用秒级精度：避免短时长任务（<30秒）被 Math.round 舍为 0 后过滤掉
    return Array.from(durationMap.entries())
      .map(([title, sec]) => ({
        title,
        durationSec: Math.round(sec),            // 保留秒级精度
        durationMin: Math.round(sec / 60),        // 分钟级（仅用于 ≥60s 的显示）
        // 三重判断：只要有一个成立就认为已完成（蓝色）
        completed: everTaskDone.has(title)
                || macroCompleted.has(title)
                || completedTaskTitles.has(title),
        stuckMarks: stuckMarksByTask.get(title) || [],
      }))
      .filter(d => d.durationSec > 0)            // ★ 只过滤真正 0 秒的异常数据
      .sort((a, b) => b.durationSec - a.durationSec)
  }, [displayEvents, displayTasks])

  // ---- 生产力指标（基于使用时长模型：1 分钟无操作 → 未使用） ----

  // 热力图与节奏曲线共享的动态时间范围
  const { rangeStart: sharedRangeStart, rangeEnd: sharedRangeEnd } = useMemo(
    () => computeActiveTimeRange(displayActivityData),
    [displayActivityData],
  )

  const visualTargets = useMemo<VisualTarget[]>(() => {
    if (viewMode !== 'day') return []

    const targets: VisualTarget[] = [
      {
        targetId: 'metric:completed-tasks',
        type: 'metric',
        chartId: 'chart-key-metrics',
        label: '完成任务数',
        value: 'completed-tasks',
      },
      {
        targetId: 'metric:computer-usage',
        type: 'metric',
        chartId: 'chart-key-metrics',
        label: '电脑使用时长',
        value: 'computer-usage',
      },
      {
        targetId: 'metric:focus-minutes',
        type: 'metric',
        chartId: 'chart-key-metrics',
        label: '任务时长',
        value: 'focus-minutes',
      },
    ]

    targets.push(...buildActivityTargets(displayActivityData, 'chart-activity-heatmap', sharedRangeStart, sharedRangeEnd))

    for (const task of taskDurations.slice(0, 8)) {
      targets.push({
        targetId: `task:${task.title}`,
        type: 'task_duration',
        chartId: 'chart-task-duration',
        label: task.title,
        value: task.title,
      })
    }

    for (const appName of getVisibleAppUsageNames(displayActivityData)) {
      targets.push({
        targetId: `app:${appName}`,
        type: 'app_usage',
        chartId: 'chart-app-usage',
        label: appName,
        value: appName,
      })
    }

    return targets
  }, [displayActivityData, sharedRangeEnd, sharedRangeStart, taskDurations, viewMode])

  const weekVisualTargets = useMemo<VisualTarget[]>(() => {
    if (viewMode !== 'week' || !weekDayData || weekDayData.length === 0) return []

    const targets: VisualTarget[] = [
      {
        targetId: 'metric:completed-tasks',
        type: 'metric',
        chartId: 'chart-week-metrics',
        label: '日均完成任务数',
        value: 'completed-tasks',
      },
      {
        targetId: 'metric:computer-usage',
        type: 'metric',
        chartId: 'chart-week-metrics',
        label: '日均电脑使用时长',
        value: 'computer-usage',
      },
      {
        targetId: 'metric:focus-minutes',
        type: 'metric',
        chartId: 'chart-week-metrics',
        label: '日均任务时长',
        value: 'focus-minutes',
      },
    ]

    const weekRange = computeWeekActiveTimeRange(weekDayData)
    targets.push(...buildActivityTargets(
      weekDayData.flatMap(day => day.activity),
      'chart-week-heatmap',
      weekRange.rangeStart,
      weekRange.rangeEnd,
    ))

    for (const task of getWeekTaskDurations(weekDayData).slice(0, 8)) {
      targets.push({
        targetId: `task:${task.title}`,
        type: 'task_duration',
        chartId: 'chart-week-ranking',
        label: task.title,
        value: task.title,
      })
    }

    for (const appName of getVisibleAppUsageNames(weekDayData.flatMap(day => day.activity))) {
      targets.push({
        targetId: `app:${appName}`,
        type: 'app_usage',
        chartId: 'chart-week-app-usage',
        label: appName,
        value: appName,
      })
    }

    return targets
  }, [viewMode, weekDayData])

  const scrollChartIntoDataPanel = useCallback((chartId: string) => {
    const panel = dataPanelRef.current
    const el = document.getElementById(chartId)
    if (!panel || !el || !panel.contains(el)) return false

    const panelRect = panel.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const panelHeight = Math.max(panelRect.height, 1)
    const elHeight = Math.max(elRect.height, 1)
    const visibleTop = Math.max(elRect.top, panelRect.top)
    const visibleBottom = Math.min(elRect.bottom, panelRect.bottom)
    const visibleHeight = Math.max(visibleBottom - visibleTop, 0)
    const measuredHeight = Math.min(elHeight, panelHeight)
    const visibleRatio = visibleHeight / measuredHeight
    const targetCenterRatio = ((elRect.top + measuredHeight / 2) - panelRect.top) / panelHeight

    if (visibleRatio >= 0.85 && targetCenterRatio >= 0.32 && targetCenterRatio <= 0.68) return true

    const targetAnchorInElement = Math.min(elHeight * 0.5, panelHeight * 0.42)
    const desiredAnchorInPanel = panelHeight * 0.46
    const rawTop = panel.scrollTop + (elRect.top - panelRect.top) + targetAnchorInElement - desiredAnchorInPanel
    const maxTop = Math.max(panel.scrollHeight - panel.clientHeight, 0)
    const targetTop = Math.max(0, Math.min(rawTop, maxTop))

    panel.scrollTo({ top: targetTop, behavior: 'smooth' })
    return true
  }, [])

  const cancelSpotlightVisibleWait = useCallback(() => {
    if (spotlightWaitFrameRef.current != null) {
      window.cancelAnimationFrame(spotlightWaitFrameRef.current)
      spotlightWaitFrameRef.current = null
    }
  }, [])

  const getElementVisibilityInDataPanel = useCallback((target: Element) => {
    const panel = dataPanelRef.current
    if (!panel || !panel.contains(target)) return null

    const panelRect = panel.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const visibleWidth = Math.min(targetRect.right, panelRect.right) - Math.max(targetRect.left, panelRect.left)
    const visibleHeight = Math.min(targetRect.bottom, panelRect.bottom) - Math.max(targetRect.top, panelRect.top)
    const targetHeight = Math.max(targetRect.height, 1)
    const measuredHeight = Math.min(targetHeight, Math.max(panelRect.height, 1))
    const visibleRatio = Math.max(visibleHeight, 0) / measuredHeight
    const targetCenterRatio = ((targetRect.top + measuredHeight / 2) - panelRect.top) / Math.max(panelRect.height, 1)

    return {
      panel,
      panelRect,
      targetRect,
      visibleWidth,
      visibleHeight,
      visibleRatio,
      targetCenterRatio,
    }
  }, [])

  const scrollElementIntoDataPanel = useCallback((target: Element, behavior: ScrollBehavior = 'smooth') => {
    const metrics = getElementVisibilityInDataPanel(target)
    if (!metrics) return null

    const { panel, panelRect, targetRect, visibleRatio, targetCenterRatio } = metrics
    if (visibleRatio >= 0.85 && targetCenterRatio >= 0.28 && targetCenterRatio <= 0.72) {
      return { panel, targetTop: panel.scrollTop }
    }

    const panelHeight = Math.max(panelRect.height, 1)
    const targetHeight = Math.max(targetRect.height, 1)
    const targetAnchorInElement = Math.min(targetHeight * 0.5, panelHeight * 0.42)
    const desiredAnchorInPanel = panelHeight * 0.46
    const rawTop = panel.scrollTop + (targetRect.top - panelRect.top) + targetAnchorInElement - desiredAnchorInPanel
    const maxTop = Math.max(panel.scrollHeight - panel.clientHeight, 0)
    const targetTop = Math.max(0, Math.min(rawTop, maxTop))

    panel.scrollTo({ top: targetTop, behavior })
    return { panel, targetTop }
  }, [getElementVisibilityInDataPanel])

  const isElementReadyForSpotlight = useCallback((target: Element) => {
    const metrics = getElementVisibilityInDataPanel(target)
    if (!metrics) return false

    const { panelRect, targetRect, visibleWidth, visibleHeight, visibleRatio, targetCenterRatio } = metrics
    if (visibleWidth <= 8 || visibleHeight <= 8) return false

    const targetFitsInPanel = targetRect.height <= panelRect.height * 0.9
    if (targetFitsInPanel) {
      return visibleRatio >= 0.85 && targetCenterRatio >= 0.28 && targetCenterRatio <= 0.72
    }

    return visibleRatio >= 0.75
  }, [getElementVisibilityInDataPanel])

  const hasElementVisibleAreaInDataPanel = useCallback((target: Element) => {
    const metrics = getElementVisibilityInDataPanel(target)
    if (!metrics) return false
    return metrics.visibleWidth > 8 && metrics.visibleHeight > 8
  }, [getElementVisibilityInDataPanel])

  const waitForSpotlightTargetVisible = useCallback((target: Element, requestId: number, onVisible: () => void, onTimeout?: () => void) => {
    cancelSpotlightVisibleWait()

    const startedAt = performance.now()
    const scrollResult = scrollElementIntoDataPanel(target, 'auto')
    const panel = scrollResult?.panel ?? dataPanelRef.current
    const expectedScrollTop = scrollResult?.targetTop
    let lastScrollTop = panel?.scrollTop ?? 0
    let stableFrameCount = 0

    const tick = () => {
      if (requestId !== spotlightRequestRef.current) {
        spotlightWaitFrameRef.current = null
        return
      }

      const elapsed = performance.now() - startedAt
      const currentScrollTop = panel?.scrollTop ?? 0
      if (Math.abs(currentScrollTop - lastScrollTop) <= SPOTLIGHT_SCROLL_EPSILON_PX) {
        stableFrameCount += 1
      } else {
        stableFrameCount = 0
      }
      lastScrollTop = currentScrollTop

      const scrollIsStable = stableFrameCount >= SPOTLIGHT_SCROLL_STABLE_FRAMES &&
        (expectedScrollTop == null || Math.abs(currentScrollTop - expectedScrollTop) <= 1)

      if (scrollIsStable && isElementReadyForSpotlight(target)) {
        spotlightWaitFrameRef.current = null
        onVisible()
        return
      }

      if (elapsed >= SPOTLIGHT_WAIT_VISIBLE_MS && hasElementVisibleAreaInDataPanel(target)) {
        spotlightWaitFrameRef.current = null
        onVisible()
        return
      }

      if (elapsed >= SPOTLIGHT_WAIT_VISIBLE_MS) {
        spotlightWaitFrameRef.current = null
        onTimeout?.()
        return
      }

      spotlightWaitFrameRef.current = window.requestAnimationFrame(tick)
    }

    spotlightWaitFrameRef.current = window.requestAnimationFrame(tick)
  }, [cancelSpotlightVisibleWait, hasElementVisibleAreaInDataPanel, isElementReadyForSpotlight, scrollElementIntoDataPanel])

  const hideSpotlight = useCallback((immediate = false) => {
    if (spotlightFadeTimerRef.current) {
      clearTimeout(spotlightFadeTimerRef.current)
      spotlightFadeTimerRef.current = null
    }

    spotlightTargetRef.current = null
    setSpotlightVisible(false)

    if (immediate) {
      setSpotlightRect(null)
      return
    }

    spotlightFadeTimerRef.current = setTimeout(() => {
      setSpotlightRect(null)
      spotlightFadeTimerRef.current = null
    }, SPOTLIGHT_FADE_OUT_MS)
  }, [])

  const updateSpotlightFromElement = useCallback((target: Element | null) => {
    const panel = dataPanelRef.current
    if (!panel || !target || !panel.contains(target)) {
      hideSpotlight()
      return
    }

    const panelRect = panel.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const padding = 8
    const left = Math.max(panelRect.left, targetRect.left - padding)
    const top = Math.max(panelRect.top, targetRect.top - padding)
    const right = Math.min(panelRect.right, targetRect.right + padding)
    const bottom = Math.min(panelRect.bottom, targetRect.bottom + padding)

    if (right <= left || bottom <= top) {
      hideSpotlight()
      return
    }

    if (spotlightFadeTimerRef.current) {
      clearTimeout(spotlightFadeTimerRef.current)
      spotlightFadeTimerRef.current = null
    }

    spotlightTargetRef.current = target
    setSpotlightRect({
      top,
      left,
      right,
      bottom,
      panelTop: panelRect.top,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      panelBottom: panelRect.bottom,
      panelWidth: panelRect.width,
      panelHeight: panelRect.height,
    })
    setSpotlightVisible(true)
  }, [hideSpotlight])

  const findSpotlightTarget = useCallback((fallbackChartId?: string, focusType?: VisualFocusType) => {
    const panel = dataPanelRef.current
    if (!panel) return null
    const preferredSelector = focusType === 'activity-hour' || focusType === 'activity-range'
      ? '[data-ai-focus-kind="activity-heatmap"]'
      : null
    const fallback = fallbackChartId ? document.getElementById(fallbackChartId) : null
    if (fallback && panel.contains(fallback)) {
      return (preferredSelector ? fallback.querySelector(preferredSelector) : null)
        ?? fallback.querySelector('.ai-focus-target')
        ?? fallback
    }
    return (preferredSelector ? panel.querySelector(preferredSelector) : null)
      ?? panel.querySelector('.ai-focus-target')
  }, [])

  const waitForSpotlightTargetElement = useCallback((fallbackChartId: string | undefined, requestId: number, onFound: (target: Element | null) => void, focusType?: VisualFocusType) => {
    const startedAt = performance.now()

    const tick = () => {
      if (requestId !== spotlightRequestRef.current) return

      const target = findSpotlightTarget(fallbackChartId, focusType)
      const isLocalTarget = target?.classList.contains('ai-focus-target') ?? false
      if (isLocalTarget || performance.now() - startedAt >= SPOTLIGHT_TARGET_LOOKUP_MS) {
        onFound(target)
        return
      }

      window.requestAnimationFrame(tick)
    }

    window.requestAnimationFrame(tick)
  }, [findSpotlightTarget])

  const showSpotlightForElement = useCallback((target: Element | null, requestId: number, fallbackChartId?: string) => {
    if (requestId !== spotlightRequestRef.current) return

    const fallback = fallbackChartId ? document.getElementById(fallbackChartId) : null
    const targetToShow = target ?? fallback
    if (!targetToShow) return

    waitForSpotlightTargetVisible(targetToShow, requestId, () => {
      if (requestId !== spotlightRequestRef.current) return
      window.requestAnimationFrame(() => {
        if (requestId !== spotlightRequestRef.current) return
        updateSpotlightFromElement(targetToShow)
      })
    }, () => {
      if (requestId !== spotlightRequestRef.current) return
      if (fallback && fallback !== targetToShow) {
        showSpotlightForElement(fallback, requestId)
        return
      }
      updateSpotlightFromElement(targetToShow)
    })
  }, [updateSpotlightFromElement, waitForSpotlightTargetVisible])

  const handleVisualRef = useCallback((ref: VisualRef) => {
    const requestId = spotlightRequestRef.current + 1
    spotlightRequestRef.current = requestId

    if (highlightStartTimerRef.current) {
      clearTimeout(highlightStartTimerRef.current)
      highlightStartTimerRef.current = null
    }
    cancelSpotlightVisibleWait()

    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }

    if (chartHighlightRef.current) {
      chartHighlightRef.current = null
    }

    setActiveHighlight(null)
    setFocusedChartId(null)
    hideSpotlight(true)

    const focusChartSection = (chartId: string) => {
      const focusRootChartId = getChartFocusRootId(chartId)
      if (!document.getElementById(focusRootChartId) && !document.getElementById(chartId)) return null
      setFocusedChartId(focusRootChartId)
      return focusRootChartId
    }

    const pulseChart = (chartId: string) => {
      const el = document.getElementById(chartId)
      if (!el) return false
      const focusRootChartId = focusChartSection(chartId) ?? getChartFocusRootId(chartId)
      scrollChartIntoDataPanel(chartId)
      highlightStartTimerRef.current = setTimeout(() => {
        if (requestId !== spotlightRequestRef.current) return
        highlightStartTimerRef.current = null
        waitForSpotlightTargetVisible(el, requestId, () => {
          if (requestId !== spotlightRequestRef.current) return
          window.requestAnimationFrame(() => {
            if (requestId !== spotlightRequestRef.current) return
            updateSpotlightFromElement(el)
          })
          chartHighlightRef.current = chartId
          highlightTimerRef.current = setTimeout(() => {
            if (requestId !== spotlightRequestRef.current) return
            if (chartHighlightRef.current === chartId) chartHighlightRef.current = null
            setFocusedChartId(current => current === focusRootChartId ? null : current)
            if (spotlightTargetRef.current === el) {
              hideSpotlight()
            }
          }, HIGHLIGHT_DURATION_MS)
        })
      }, HIGHLIGHT_START_DELAY_MS)
      return true
    }

    if (ref.kind === 'chart') {
      tracker.track('reflect.chart_referenced', { chartId: ref.chartId }, {
        date: selectedDate,
        logicalDate: selectedDate,
      })
      pulseChart(ref.chartId)
      return
    }

    if (ref.kind === 'multi-focus') {
      const fallbackChartId = viewMode === 'week'
        ? (ref.chartId === 'chart-app-usage' ? 'chart-week-app-usage' : ref.chartId)
        : ref.chartId
      const sourceActivityData = viewMode === 'week' && weekDayData
        ? weekDayData.flatMap(day => day.activity)
        : displayActivityData

      const resolvedApps: string[] = []
      const labels: string[] = []
      for (const sub of ref.refs) {
        if (sub.focusType !== 'app-usage') continue
        const appName = findBestAppNameMatch(sub.value, sourceActivityData)
        if (appName) {
          resolvedApps.push(appName)
          labels.push(sub.label)
        }
      }
      const uniqueApps = [...new Set(resolvedApps)]

      tracker.track('reflect.visual_ref_clicked', {
        type: 'multi-focus',
        matched: uniqueApps.length > 0,
        count: uniqueApps.length,
        chartId: fallbackChartId,
        mode: trackerMode,
      }, {
        date: selectedDate,
        logicalDate: selectedDate,
      })

      const focusRootChartId = focusChartSection(fallbackChartId)

      if (uniqueApps.length === 0) {
        pulseChart(fallbackChartId)
        return
      }

      highlightStartTimerRef.current = setTimeout(() => {
        if (requestId !== spotlightRequestRef.current) return
        setActiveHighlight({
          id: `app-usage:multi:${Date.now()}`,
          type: 'app-usage',
          value: uniqueApps[0],
          label: labels.length > 0 ? [...new Set(labels)].join('、') : uniqueApps.join('、'),
          appNames: uniqueApps,
        })
        highlightStartTimerRef.current = null
        highlightTimerRef.current = setTimeout(() => {
          if (requestId !== spotlightRequestRef.current) return
          setActiveHighlight(null)
          if (focusRootChartId) setFocusedChartId(current => current === focusRootChartId ? null : current)
          hideSpotlight()
          highlightTimerRef.current = null
        }, HIGHLIGHT_DURATION_MS)
      }, HIGHLIGHT_START_DELAY_MS)
      return
    }

    const fallbackChartId = viewMode === 'week'
      ? WEEK_FOCUS_FALLBACK_CHARTS[ref.focusType]
      : FOCUS_FALLBACK_CHARTS[ref.focusType]
    const sourceActivityData = viewMode === 'week' && weekDayData
      ? weekDayData.flatMap(day => day.activity)
      : displayActivityData
    const sourceTaskDurations = viewMode === 'week' && weekDayData
      ? getWeekTaskDurations(weekDayData)
      : taskDurations
    const activeRange = viewMode === 'week' && weekDayData
      ? computeWeekActiveTimeRange(weekDayData)
      : { rangeStart: sharedRangeStart, rangeEnd: sharedRangeEnd }

    let resolvedValue = ref.value
    let matched = true

    if (ref.focusType === 'activity-hour') {
      const hour = Number(ref.value)
      matched = Number.isInteger(hour) && hour >= 0 && hour < 24 && hour >= activeRange.rangeStart && hour < activeRange.rangeEnd
      resolvedValue = String(hour)
    } else if (ref.focusType === 'activity-range') {
      const startHour = ref.startHour ?? Number(ref.value.split('-')[0])
      const endHour = ref.endHour ?? Number(ref.value.split('-')[1])
      matched = Number.isInteger(startHour) &&
        Number.isInteger(endHour) &&
        startHour >= 0 &&
        endHour <= 24 &&
        endHour > startHour &&
        endHour > activeRange.rangeStart &&
        startHour < activeRange.rangeEnd
      resolvedValue = `${Math.max(startHour, activeRange.rangeStart)}-${Math.min(endHour, activeRange.rangeEnd)}`
    } else if (ref.focusType === 'task-duration') {
      const taskTitle = findBestTaskTitleMatch(ref.value, sourceTaskDurations)
      matched = Boolean(taskTitle)
      if (taskTitle) resolvedValue = taskTitle
    } else if (ref.focusType === 'metric') {
      matched = METRIC_KEYS.has(ref.value)
    } else if (ref.focusType === 'app-usage') {
      const appName = findBestAppNameMatch(ref.value, sourceActivityData)
      matched = Boolean(appName)
      if (appName) resolvedValue = appName
    }

    tracker.track('reflect.visual_ref_clicked', {
      type: ref.focusType,
      value: ref.value,
      matched,
      fallbackChartId,
      mode: trackerMode,
    }, {
      date: selectedDate,
      logicalDate: selectedDate,
    })

    const focusRootChartId = focusChartSection(fallbackChartId)

    if (!matched) {
      pulseChart(fallbackChartId)
      return
    }

    highlightStartTimerRef.current = setTimeout(() => {
      if (requestId !== spotlightRequestRef.current) return
      setActiveHighlight({
        id: `${ref.focusType}:${resolvedValue}:${Date.now()}`,
        type: ref.focusType,
        value: resolvedValue,
        label: ref.label,
        startHour: ref.focusType === 'activity-range' ? Number(resolvedValue.split('-')[0]) : ref.startHour,
        endHour: ref.focusType === 'activity-range' ? Number(resolvedValue.split('-')[1]) : ref.endHour,
      })
      highlightStartTimerRef.current = null
      highlightTimerRef.current = setTimeout(() => {
        if (requestId !== spotlightRequestRef.current) return
        setActiveHighlight(null)
        if (focusRootChartId) setFocusedChartId(current => current === focusRootChartId ? null : current)
        hideSpotlight()
        highlightTimerRef.current = null
      }, HIGHLIGHT_DURATION_MS)
    }, HIGHLIGHT_START_DELAY_MS)
  }, [cancelSpotlightVisibleWait, displayActivityData, hideSpotlight, scrollChartIntoDataPanel, sharedRangeEnd, sharedRangeStart, taskDurations, updateSpotlightFromElement, viewMode, waitForSpotlightTargetVisible, weekDayData])

  useEffect(() => {
    if (!activeHighlight) return
    const requestId = spotlightRequestRef.current
    const fallbackChartId = focusedChartId ?? (viewMode === 'week'
      ? WEEK_FOCUS_FALLBACK_CHARTS[activeHighlight.type]
      : FOCUS_FALLBACK_CHARTS[activeHighlight.type])
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        waitForSpotlightTargetElement(fallbackChartId, requestId, (target) => {
          showSpotlightForElement(target, requestId, fallbackChartId)
        }, activeHighlight.type)
      })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      cancelSpotlightVisibleWait()
    }
  }, [activeHighlight, cancelSpotlightVisibleWait, focusedChartId, showSpotlightForElement, viewMode, waitForSpotlightTargetElement])

  useEffect(() => {
    const panel = dataPanelRef.current
    if (!panel) return

    const refreshSpotlight = () => {
      if (spotlightTargetRef.current) updateSpotlightFromElement(spotlightTargetRef.current)
    }

    panel.addEventListener('scroll', refreshSpotlight, { passive: true })
    window.addEventListener('resize', refreshSpotlight)
    return () => {
      panel.removeEventListener('scroll', refreshSpotlight)
      window.removeEventListener('resize', refreshSpotlight)
    }
  }, [updateSpotlightFromElement])

  useEffect(() => {
    spotlightRequestRef.current += 1
    setActiveHighlight(null)
    setFocusedChartId(null)
    hideSpotlight(true)
    if (highlightStartTimerRef.current) {
      clearTimeout(highlightStartTimerRef.current)
      highlightStartTimerRef.current = null
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
    if (chartHighlightRef.current) {
      chartHighlightRef.current = null
    }
  }, [displayDate, hideSpotlight, viewMode])

  useEffect(() => {
    return () => {
      if (highlightStartTimerRef.current) clearTimeout(highlightStartTimerRef.current)
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      if (spotlightWaitFrameRef.current != null) window.cancelAnimationFrame(spotlightWaitFrameRef.current)
      if (spotlightFadeTimerRef.current) clearTimeout(spotlightFadeTimerRef.current)
      if (chartHighlightRef.current) {
        chartHighlightRef.current = null
      }
    }
  }, [])

  /** 电脑使用总时长（分钟）：所有 30 秒窗口的 usageRatio 之和 × 0.5 */
  const totalUsageMinutes = useMemo(() => {
    if (displayActivityData.length === 0) return 0
    return Math.round(
      displayActivityData.reduce((sum, r) => sum + getActiveRatio(r) * 0.5, 0)
    )
  }, [displayActivityData])

  /** 生产力比率：专注时长 / 电脑使用时长 × 100% */
  const productivityRatio = useMemo(() => {
    if (totalUsageMinutes <= 0) return 0
    const focusMin = displaySummary?.stats.totalFocusMinutes ?? 0
    return Math.min(Math.round((focusMin / totalUsageMinutes) * 100), 100)
  }, [totalUsageMinutes, displaySummary])

  /** 心流占比：心流时长 / 专注时长 × 100% */
  const flowRatio = useMemo(() => {
    const focusMin = displaySummary?.stats.totalFocusMinutes ?? 0
    if (focusMin <= 0) return 0
    const flowMin = displaySummary?.stats.totalFlowMinutes ?? 0
    return Math.min(Math.round((flowMin / focusMin) * 100), 100)
  }, [displaySummary])

  /** 格式化使用时长：指标卡统一显示分钟，方便和任务时长直接比较。 */
  const usageDurationStr = useMemo(() => {
    return { value: totalUsageMinutes, unit: '分钟' }
  }, [totalUsageMinutes])

  const displayMoodOption = useMemo(() => {
    return displayMoodRecord ? getMoodOptionForDate(displayDate, displayMoodRecord.mood) : null
  }, [displayDate, displayMoodRecord])

  const displayMoodNote = displayMoodRecord?.note.trim() ?? ''
  const hasMoodNote = displayMoodNote.length > 0

  /**
   * 将 activityData 按小时聚合为精力分布描述。
   * 例如："9点-10点 活跃、14点-16点 基本空闲"
   */
  const activityTimeDistribution = useMemo(() => {
    if (displayActivityData.length === 0) return ''
    const EXPECTED_PER_HOUR = 120 // 每小时应有 120 条 30 秒采样，和图表保持一致
    const hourBuckets: Record<number, number> = {}
    for (const r of displayActivityData) {
      const h = new Date(r.ts).getHours()
      if (!hourBuckets[h]) hourBuckets[h] = 0
      hourBuckets[h] += getActiveRatio(r)
    }
    const hours = Object.keys(hourBuckets).map(Number).sort((a, b) => a - b)
    if (hours.length === 0) return ''

    const segments: string[] = []
    for (const h of hours) {
      const ratio = Math.min(Math.round((hourBuckets[h] / EXPECTED_PER_HOUR) * 100), 100)
      const label = ratio >= 70 ? '活跃' : ratio >= 30 ? '一般' : '基本空闲'
      segments.push(`${h}:00 ${label}(${ratio}%)`)
    }
    return segments.join('、')
  }, [displayActivityData])

  // 构建 AI system prompt
  const systemPrompt = useMemo(() => {
    if (!summary || !memoryLoaded || !insightLoaded) return ''
    const context = summaryToLLMContext(summary, events)
    const taskInfo = `\n\n额外信息：\n- 当前任务总数：${localTasks.length}\n- 已完成任务：${localTasks.filter(t => t.completed).length}\n- 完成率：${completionRate}%\n- 待办任务：${localTasks.filter(t => !t.completed).map(t => t.title).join('、') || '无'}`
    const productivityInfo = `\n\n生产力指标：\n- 电脑使用时长：${totalUsageMinutes}分钟\n- 专注时长：${summary.stats.totalFocusMinutes}分钟\n- 生产力比率：${productivityRatio}%（专注/使用）\n- 心流占比：${flowRatio}%（心流/专注）`
    const activityInfo = activityTimeDistribution
      ? `\n\n精力时间分布（每小时电脑活跃度）：\n${activityTimeDistribution}`
      : ''
    const moodInfo = displayMoodRecord && displayMoodOption
      ? `\n\n当日心情记录（可选背景，非必须引用）：\n- 心情：${displayMoodOption.label}${displayMoodNote ? `\n- 备注：${displayMoodNote}` : ''}\n- 使用原则：这是用户自述状态，只在讨论状态、开始困难、卡顿、停顿、节奏变化或用户主动提到情绪时按需参考；不要为了使用它而使用它，不要用它解释效率高低、任务完成好坏或电脑活跃变化。`
      : ''
    const taskSessionInfo = buildTaskSessionPromptContext(events)
    const appUsageInfo = buildAppUsagePromptContext(activityData)

    // 任务用时排行（对齐条形图数据）
    let taskDurationInfo = ''
    if (taskDurations.length > 0) {
      const lines = taskDurations.map(d => {
        const timeStr = d.durationSec >= 60 ? `${d.durationMin}分钟` : `${d.durationSec}秒`
        const status = d.completed ? '已完成 ✅' : '未完成 ⚠️'
        const stuckStr = d.stuckMarks && d.stuckMarks.length > 0
          ? `（卡顿${d.stuckMarks.length}次：${d.stuckMarks.map(m => m.reason || m.microAction).join('、')}）`
          : ''
        return `- ${d.title}：${timeStr}（${status}）${stuckStr}`
      })
      taskDurationInfo = `\n\n任务实际用时排行（按时长降序，对应【chart:task-duration】条形图）：\n${lines.join('\n')}`
    }

    const insightInfo = insightContext ? `\n\n${insightContext}` : ''
    const visualMarkerInfo = `\n\n${buildVisualMarkerPromptContext(visualTargets)}`
    const taskSessionContext = taskSessionInfo ? `\n\n${taskSessionInfo}` : ''
    const appUsageContext = appUsageInfo ? `\n\n${appUsageInfo}` : ''
    const prompt = buildReflectionSystemPrompt(context + taskInfo + productivityInfo + activityInfo + moodInfo + taskSessionContext + appUsageContext + taskDurationInfo + insightInfo + visualMarkerInfo, false, isToday, memoryContext, selectedDate, userProfile.preferredName ?? '', reflectionStyle)
    console.log('[Memory Debug] systemPrompt 构建完成, 包含记忆:', prompt.includes('对话记忆'), ', memoryContext长度:', memoryContext.length)
    return prompt
  }, [summary, events, localTasks, completionRate, totalUsageMinutes, productivityRatio, flowRatio, activityTimeDistribution, displayMoodRecord, displayMoodOption, displayMoodNote, activityData, taskDurations, visualTargets, isToday, memoryContext, memoryLoaded, insightContext, insightLoaded, selectedDate, reflectionStyle])

  // ---- 周视图数据回调 ----
  const handleWeekDataReady = useCallback((data: WeekDayData[]) => {
    setWeekDayData(data)
  }, [])

  // 构建周 AI system prompt
  const weekSystemPrompt = useMemo(() => {
    if (!weekDayData || weekDayData.length === 0) return ''
    const context = buildWeeklyLLMContext(weekDayData)
    const dates = getWeekDates(weekEndDate)
    const weekLabel = `${formatDateFriendly(dates[0]).replace(/ .+/, '')} – ${formatDateFriendly(dates[6]).replace(/ .+/, '')}`
    const insightInfo = insightContext ? `\n\n${insightContext}` : ''
    const weekAppUsageInfo = buildAppUsagePromptContext(weekDayData.flatMap(day => day.activity))
    const appUsageContext = weekAppUsageInfo ? `\n\n本周${weekAppUsageInfo}` : ''
    const visualMarkerInfo = `\n\n${buildVisualMarkerPromptContext(weekVisualTargets)}`
    return buildWeeklyReflectionSystemPrompt(context + appUsageContext + insightInfo + visualMarkerInfo, false, weekLabel, memoryContext, reflectionStyle)
  }, [weekDayData, weekEndDate, memoryContext, insightContext, weekVisualTargets, reflectionStyle])

  // 根据当前视图模式选择对应的 system prompt
  const activeSystemPrompt = viewMode === 'week' ? weekSystemPrompt : systemPrompt

  const dailyMemoryMatchContext = useMemo(() => {
    if (!summary) return ''
    const taskLines = localTasks.slice(0, 8).map(task => `${task.completed ? '已完成' : '未完成'}：${task.title}`)
    const durationLines = taskDurations.slice(0, 6).map(item => {
      const timeStr = item.durationSec >= 60 ? `${item.durationMin}分钟` : `${item.durationSec}秒`
      return `${item.completed ? '已完成' : '未完成'} ${item.title}：${timeStr}${item.stuckMarks?.length ? `，卡顿${item.stuckMarks.length}次` : ''}`
    })
    const moodLine = displayMoodRecord && displayMoodOption
      ? `心情：${displayMoodOption.label}${displayMoodNote ? `（${displayMoodNote}）` : ''}`
      : '心情：无记录'

    return [
      `日期：${selectedDate}`,
      `模式：日反思`,
      `完成任务：${localTasks.filter(task => task.completed).length}/${localTasks.length}`,
      `专注：${summary.stats.totalFocusMinutes}分钟`,
      `卡顿：${summary.stats.totalStuckCount}次`,
      moodLine,
      taskLines.length > 0 ? `任务列表：${taskLines.join('；')}` : '',
      durationLines.length > 0 ? `任务用时：${durationLines.join('；')}` : '',
      activityTimeDistribution ? `电脑活跃：${activityTimeDistribution}` : '',
    ].filter(Boolean).join('\n')
  }, [activityTimeDistribution, displayMoodNote, displayMoodOption, displayMoodRecord, localTasks, selectedDate, summary, taskDurations])

  const weeklyMemoryMatchContext = useMemo(() => {
    if (!weekDayData || weekDayData.length === 0) return ''
    const dayLines = weekDayData
      .filter(day => day.hasData)
      .map(day => {
        const taskCount = day.taskDurations.length
        const completedCount = day.taskDurations.filter(task => task.completed).length
        const stuckCount = day.summary.stats.totalStuckCount
        const mood = day.moodRecord ? `，有心情记录` : ''
        return `${day.dateFull}：任务${completedCount}/${taskCount}，专注${day.summary.stats.totalFocusMinutes}分钟，卡顿${stuckCount}次${mood}`
      })
      .slice(0, 7)
    const topTasks = weekDayData
      .flatMap(day => day.taskDurations.map(task => `${day.dateLabel} ${task.title} ${task.durationMin}分钟${task.completed ? ' 已完成' : ' 未完成'}`))
      .slice(0, 10)

    return [
      `模式：周反思`,
      dayLines.length > 0 ? `每日概况：${dayLines.join('；')}` : '',
      topTasks.length > 0 ? `任务线索：${topTasks.join('；')}` : '',
    ].filter(Boolean).join('\n')
  }, [weekDayData])

  const activeMemoryMatchContext = viewMode === 'week' ? weeklyMemoryMatchContext : dailyMemoryMatchContext

  // 补提取未处理的 raw session（和页面加载并行，零体感延迟）
  useEffect(() => {
    (async () => {
      try {
        const keys = await window.electronAPI.listRawSessionKeys()
        for (const key of keys) {
          const raw = await window.electronAPI.loadRawSession(key) as {
            date: string; mode: string; status: string; startedAt: number
            messages: { role: 'user' | 'assistant'; content: string; ts: number }[]
          } | null
          if (!raw || raw.status !== 'in_progress') continue
          if (raw.messages.length < 4) {
            // 对话太短，直接标记为 processed
            raw.status = 'processed'
            await window.electronAPI.saveRawSession(key, raw)
            await window.electronAPI.saveAIConversation({
              conversationId: `reflection-${key}`,
              conversationType: 'reflection',
              date: raw.date,
              logicalDate: raw.date,
              mode: raw.mode === 'weekly' ? 'weekly' : 'daily',
              status: raw.status,
              startedAt: raw.startedAt,
              endedAt: Date.now(),
              savedAt: Date.now(),
              messages: raw.messages,
              metadata: { storageKey: key, source: 'raw-session-backfill' },
            })
            continue
          }
          console.log(`[Memory] 补提取未处理的会话: ${key}`)
          const chatMsgs = raw.messages.filter(m => m.content.length > 0)
          const result = await extractMemoryFromChat(chatMsgs, aiConfig)
          if (result && (result.summary || result.commitments.length > 0)) {
            await recordReflectionMemory(result, {
              date: raw.date,
              mode: raw.mode === 'weekly' ? 'weekly' : 'daily',
            })
            console.log(`[Memory] 补提取完成: ${key}`, result.summary?.slice(0, 50))
          }
          raw.status = 'processed'
          await window.electronAPI.saveRawSession(key, raw)
          await window.electronAPI.saveAIConversation({
            conversationId: `reflection-${key}`,
            conversationType: 'reflection',
            date: raw.date,
            logicalDate: raw.date,
            mode: raw.mode === 'weekly' ? 'weekly' : 'daily',
            status: raw.status,
            startedAt: raw.startedAt,
            endedAt: Date.now(),
            savedAt: Date.now(),
            messages: raw.messages,
            metadata: { storageKey: key, source: 'raw-session-backfill' },
          })
        }
      } catch (e) {
        console.warn('[Memory] 补提取失败:', e)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 反思完成回调
  const handleReflectionComplete = (summaryText: string) => {
    tracker.track('daily.leftovers', {
      leftoverTasks: localTasks
        .filter(t => !t.completed)
        .map(t => ({ id: t.id, title: t.title, priority: t.priority })),
      totalCount: localTasks.filter(t => !t.completed).length,
    })
    console.log('[Reflection] 完成:', summaryText.slice(0, 100))
  }

  const handleManualEntry = useCallback(
    async (newEvents: TrackEvent[], newTasks: { title: string }[], completedTaskIds: string[]) => {
      if (newEvents.length === 0) return
      tracker.track('manual.time_added', { date: selectedDate, entryCount: newEvents.length })

      // 1. 写入 tracker 事件
      await window.electronAPI.appendTrackerEvents(
        selectedDate,
        newEvents as unknown[],
      )

      // 2. 加载当前任务列表，标记已补记的为完成，并追加新任务（也标记为完成）
      const existingTasks = (await window.electronAPI.loadTasks(selectedDate)) as Task[]
      const completedSet = new Set(completedTaskIds)
      const updatedTasks = existingTasks.map(t =>
        completedSet.has(t.id) ? { ...t, completed: true } : t,
      )
      const tasksToAdd = newTasks.map((t) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: t.title,
        note: '',
        priority: 'medium' as const,
        completed: true,
        createdAt: Date.now(),
      }))
      const finalTasks = [...updatedTasks, ...tasksToAdd]
      await window.electronAPI.saveTasks(selectedDate, finalTasks)
      setLocalTasks(finalTasks)

      // 3. 重新加载事件数据以刷新图表
      const [raw, rawActivity] = await Promise.all([
        window.electronAPI.loadTrackerEvents(selectedDate),
        window.electronAPI.loadActivityData(selectedDate),
      ])
      const typedEvents = raw as TrackEvent[]
      const updatedSummary = buildDailySummary(selectedDate, typedEvents)
      setEvents(typedEvents)
      setActivityData(rawActivity as ActivityRecord[])
      setSummary(updatedSummary)
      setDisplayDate(selectedDate)
      setDisplayEvents(typedEvents)
      setDisplayActivityData(rawActivity as ActivityRecord[])
      setDisplayTasks(finalTasks)
      setDisplaySummary(updatedSummary)
      hasDisplayDataRef.current = true
    },
    [selectedDate],
  )

  // ---- 打开/关闭侧边栏时调整窗口大小 ----
  const openChat = useCallback(async () => {
    tracker.track('reflect.chat_opened', { date: selectedDate, mode: trackerMode }, {
      date: selectedDate,
      logicalDate: selectedDate,
    })
    hadChatRef.current = true
    setChatOpen(true)
    if (!reflectionFullscreen) {
      window.electronAPI.resizeMainWindow(EXPANDED_WIDTH, MAIN_HEIGHT)
    }
  }, [reflectionFullscreen, selectedDate, viewMode])

  const closeChat = useCallback(() => {
    setChatOpen(false)
    if (!reflectionFullscreen) {
      window.electronAPI.resizeMainWindow(MAIN_WIDTH, MAIN_HEIGHT)
    }
  }, [reflectionFullscreen])

  const toggleReflectionFullscreen = useCallback(() => {
    const nextFullscreen = !reflectionFullscreen
    setReflectionFullscreen(nextFullscreen)

    if (nextFullscreen) {
      const { width, height } = getReflectionFullscreenSize()
      window.electronAPI.resizeMainWindow(width, height)
    } else {
      window.electronAPI.resizeMainWindow(chatOpen ? EXPANDED_WIDTH : MAIN_WIDTH, MAIN_HEIGHT)
    }

    tracker.track('reflect.fullscreen_toggled', {
      date: selectedDate,
      mode: trackerMode,
      fullscreen: nextFullscreen,
    }, {
      date: selectedDate,
      logicalDate: selectedDate,
    })
  }, [chatOpen, reflectionFullscreen, selectedDate, viewMode])

  const handleChatEndedProperly = useCallback(() => {
    hadEndedProperlyRef.current = true
    setReflectionFullscreen(false)
    window.electronAPI.resizeMainWindow(MAIN_WIDTH, MAIN_HEIGHT)
    onClose()
  }, [onClose])

  // 关闭反思页面：有对话时先保存记忆再关闭
  const handleClose = useCallback(async () => {
    if (hadChatRef.current && chatRef.current) {
      setClosingAfterSave(true)
      await chatRef.current.triggerEnd()
      hadEndedProperlyRef.current = true
    }
    if (reflectionFullscreen || chatOpen) {
      window.electronAPI.resizeMainWindow(MAIN_WIDTH, MAIN_HEIGHT)
    }
    onClose()
  }, [chatOpen, onClose, reflectionFullscreen])

  // ---- 拖拽分隔条逻辑 ----
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const containerWidth = rect.width
      // 鼠标距右边的距离 = 聊天宽度
      const newChatWidth = rect.right - e.clientX
      const maxChatWidth = containerWidth * MAX_CHAT_RATIO
      const dataWidth = containerWidth - newChatWidth

      if (newChatWidth >= MIN_CHAT_WIDTH && newChatWidth <= maxChatWidth && dataWidth >= MIN_DATA_WIDTH) {
        setChatWidth(newChatWidth)
      }
    }

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // ---- 初次加载中（切换日期时保留旧内容，只在没有任何展示数据时显示整页 loading） ----
  if (loadingData && viewMode === 'day' && !displaySummary) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">正在加载数据...</p>
        </div>
      </div>
    )
  }

  // ---- 是否有 AI 配置 ----
  const hasAI = !!(aiConfig.apiKey && aiConfig.modelId)
  const highlightPulseKey = activeHighlight?.id ?? ''
  const highlightedHour = activeHighlight?.type === 'activity-hour' ? Number(activeHighlight.value) : null
  const highlightedHourRange = activeHighlight?.type === 'activity-range'
    ? { startHour: activeHighlight.startHour ?? Number(activeHighlight.value.split('-')[0]), endHour: activeHighlight.endHour ?? Number(activeHighlight.value.split('-')[1]) }
    : null
  const highlightedTask = activeHighlight?.type === 'task-duration' ? activeHighlight.value : null
  const highlightedMetric = activeHighlight?.type === 'metric' ? activeHighlight.value : null
  const highlightedApps =
    activeHighlight?.type === 'app-usage'
      ? activeHighlight.appNames?.length
        ? activeHighlight.appNames
        : activeHighlight.value
          ? [activeHighlight.value]
          : null
      : null

  const metricCardClass = (metricKey: string, baseClass: string) => {
    const isHighlighted = highlightedMetric === metricKey
    return `${baseClass} transition-all duration-200 ${
      isHighlighted ? 'ai-focus-target' : ''
    }`
  }

  const metricCards = (
    <>
      <div
        key={highlightedMetric === 'completed-tasks' ? highlightPulseKey : 'completed-tasks'}
        className={metricCardClass('completed-tasks', 'text-center bg-gray-100 rounded-xl py-2.5 px-2')}
      >
        <p className="text-lg font-bold text-gray-600">
          {displayTasks.filter(t => t.completed).length}
        </p>
        <p className="text-2xs text-gray-500 mt-0.5">完成任务数</p>
      </div>
      <div
        key={highlightedMetric === 'computer-usage' ? highlightPulseKey : 'computer-usage'}
        className={metricCardClass('computer-usage', 'text-center bg-emerald-50 rounded-xl py-2.5 px-2')}
      >
        <p className="text-lg font-bold text-emerald-600">
          {usageDurationStr.value}
          <span className="text-xs font-normal ml-0.5">{usageDurationStr.unit}</span>
        </p>
        <p className="text-2xs text-emerald-500 mt-0.5">电脑使用时长</p>
      </div>
      <div
        key={highlightedMetric === 'focus-minutes' ? highlightPulseKey : 'focus-minutes'}
        className={metricCardClass('focus-minutes', 'text-center bg-blue-50 rounded-xl py-2.5 px-2')}
      >
        <p className="text-lg font-bold text-blue-600">
          {displaySummary?.stats.totalFocusMinutes ?? 0}
          <span className="text-xs font-normal ml-0.5">分钟</span>
        </p>
        <p className="text-2xs text-blue-500 mt-0.5">任务时长</p>
      </div>
    </>
  )

  const moodLabel = displayIsToday ? '今日心情' : '当日心情'
  const shouldShowMoodPill = !!displayMoodRecord || displayIsToday
  const moodPill = shouldShowMoodPill ? (
    <div ref={moodPillRef} id="chart-daily-mood" className="relative inline-flex max-w-full flex-col items-start">
      {displayMoodRecord && displayMoodOption ? (
        <>
          <button
            type="button"
            onClick={hasMoodNote ? () => setMoodNoteExpanded(v => !v) : undefined}
            title={hasMoodNote ? (moodNoteExpanded ? '收起心情记录' : '查看心情记录') : undefined}
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-50/70 px-2.5 py-1 text-xs transition-colors ${
              hasMoodNote ? 'cursor-pointer hover:bg-emerald-50/70' : 'cursor-default'
            }`}
          >
            <span className="font-medium text-gray-400">{moodLabel}</span>
            <span className="text-sm leading-none">{displayMoodOption.emoji}</span>
            <span className="font-medium text-gray-700">{displayMoodOption.label}</span>
            {hasMoodNote && (
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-300"
                aria-label="有心情记录"
              />
            )}
          </button>
          {hasMoodNote && moodNoteExpanded && (
            <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-2xl border border-gray-100 bg-white/95 px-3 py-2.5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
              <p className="text-2xs font-medium text-gray-400">心情记录</p>
              <p className="mt-1 max-h-24 overflow-y-auto text-xs leading-relaxed text-gray-600">
                {displayMoodNote}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-50/70 px-2.5 py-1 text-xs">
          <span className="font-medium text-gray-400">{moodLabel}</span>
          <span className="text-gray-300">＋</span>
          <span className="text-gray-400">还没有记录</span>
        </div>
      )}
    </div>
  ) : null

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* ====== 顶部标题栏 ====== */}
      <div className="drag-region flex items-center px-5 py-3 border-b border-gray-100 flex-shrink-0">
        {/* 左侧：标题 */}
        <div className="flex items-center no-drag flex-shrink-0">
          <h1 className="font-semibold text-gray-800 text-sm">数据反思</h1>
        </div>

        {/* 中间：日期导航 + 日/周切换 */}
        <div className="flex-1 flex justify-center">
          <div className="flex items-center gap-2.5 no-drag">
            {viewMode === 'day' ? (
              /* ---- 日视图导航 ---- */
              <div className="flex items-center gap-1 relative">
                <button
                  onClick={goPrev}
                  className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center
                             text-gray-400 hover:text-gray-600 transition-colors"
                  title="前一天"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <button
                  onClick={() => setReflCalendarOpen(v => !v)}
                  className="text-xs font-medium text-gray-600 min-w-[90px] text-center select-none
                             py-0.5 px-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                  title="点击选择日期"
                >
                  {formatDateFriendly(selectedDate)}
                  <svg className={`inline-block w-2.5 h-2.5 ml-0.5 transition-transform ${reflCalendarOpen ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {reflCalendarOpen && (
                  <MiniCalendar
                    selectedDate={selectedDate}
                    onSelect={(date) => {
                      const todayStr = getToday()
                      setSelectedDate(date > todayStr ? todayStr : date)
                      setReflCalendarOpen(false)
                    }}
                    onClose={() => setReflCalendarOpen(false)}
                  />
                )}

                <button
                  onClick={goNext}
                  disabled={isToday}
                  className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors
                    ${isToday
                      ? 'text-gray-200 cursor-not-allowed'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                  title={isToday ? '已经是今天' : '后一天'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {!isToday && (
                  <button
                    onClick={goToday}
                    className="ml-1 px-2 py-0.5 rounded-full text-2xs font-semibold
                               bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    今天
                  </button>
                )}
              </div>
            ) : (
              /* ---- 周视图导航 ---- */
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setWeekEndDate(d => shiftDate(d, -7)) }}
                  className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center
                             text-gray-400 hover:text-gray-600 transition-colors"
                  title="前一周"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="text-xs font-medium text-gray-600 min-w-[130px] text-center select-none py-0.5 px-1.5">
                  {(() => {
                    const dates = getWeekDates(weekEndDate)
                    return `${formatDateFriendly(dates[0]).replace(/ .+/, '')} – ${formatDateFriendly(dates[6]).replace(/ .+/, '')}`
                  })()}
                </span>

                <button
                  onClick={() => { setWeekEndDate(d => { const next = shiftDate(d, 7); return next > getToday() ? getToday() : next }) }}
                  disabled={weekEndDate === today}
                  className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors
                    ${weekEndDate === today
                      ? 'text-gray-200 cursor-not-allowed'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                    }`}
                  title={weekEndDate === today ? '已经是本周' : '后一周'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {weekEndDate !== today && (
                  <button
                    onClick={() => { setWeekEndDate(getToday()) }}
                    className="ml-1 px-2 py-0.5 rounded-full text-2xs font-semibold
                               bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                  >
                    本周
                  </button>
                )}
              </div>
            )}

            <div className="flex rounded-md bg-gray-100 p-0.5">
              <button
                onClick={() => {
                  if (viewMode !== 'day') {
                    tracker.track('reflect.mode_switched', { from: trackerMode, to: 'daily' }, {
                      date: selectedDate,
                      logicalDate: selectedDate,
                    })
                  }
                  setViewMode('day')
                }}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-all
                  ${viewMode === 'day'
                    ? 'bg-white text-gray-700 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                  }`}
              >
                日
              </button>
              <button
                onClick={() => {
                  if (viewMode !== 'week') {
                    tracker.track('reflect.mode_switched', { from: trackerMode, to: 'weekly' }, {
                      date: selectedDate,
                      logicalDate: selectedDate,
                    })
                  }
                  setViewMode('week')
                  setWeekEndDate(selectedDate)
                }}
                className={`px-2 py-0.5 rounded text-2xs font-medium transition-all
                  ${viewMode === 'week'
                    ? 'bg-white text-gray-700 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                  }`}
              >
                周
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：最小化 + 全屏 + 关闭按钮 */}
        <div className="flex-shrink-0 flex justify-end gap-1">
          <button
            onClick={() => window.electronAPI.minimizeWindow()}
            className="no-drag w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            title="最小化到任务栏"
            aria-label="最小化到任务栏"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
            </svg>
          </button>
          <button
            onClick={toggleReflectionFullscreen}
            className="no-drag w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            title={reflectionFullscreen ? '退出全屏' : '全屏查看'}
            aria-label={reflectionFullscreen ? '退出全屏' : '全屏查看'}
          >
            {reflectionFullscreen ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9H5V5m0 0 5 5M15 9h4V5m0 0-5 5M9 15H5v4m0 0 5-5M15 15h4v4m0 0-5-5" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 3H3v5m0-5 6 6M16 3h5v5m0-5-6 6M8 21H3v-5m0 5 6-6M16 21h5v-5m0 5-6-6" />
              </svg>
            )}
          </button>
          <button
            onClick={handleClose}
            className="no-drag w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            title="返回主界面"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ====== 主内容区（日/周共享布局：数据面板 + AI 侧边栏） ====== */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">

        {/* ---- 数据可视化区域（日/周内容切换） ---- */}
        <div
          ref={dataPanelRef}
          className="flex-1 overflow-y-auto transition-all duration-400 relative"
          style={{ minWidth: MIN_DATA_WIDTH }}
        >
          {viewMode === 'week' ? (
            /* ---- 周视图 ---- */
            <WeekView
              weekEndDate={weekEndDate}
              onDataReady={handleWeekDataReady}
              chatOpen={chatOpen}
              activeHighlight={activeHighlight}
            />
          ) : (
            /* ---- 日视图 ---- */
            <div
              className={`p-6 space-y-6 transition-all duration-200 ease-out max-w-xl mx-auto ${
                contentVisible ? 'opacity-100 translate-y-0' : 'opacity-70 translate-y-1'
              }`}
            >
              {/* 圆环图 + 核心指标 + 心情状态，所有日视图日期保持同一结构 */}
              <div className={chatOpen ? 'flex items-center gap-6' : 'space-y-4'}>
                <ChartFocusSection
                  id="chart-completion-rate"
                  className={chatOpen ? 'flex-shrink-0' : 'flex justify-center'}
                >
                  <DonutChart
                    percentage={completionRate}
                    size={chatOpen ? 120 : 180}
                    strokeWidth={chatOpen ? 10 : 14}
                    label="任务完成率"
                  />
                </ChartFocusSection>
                <ChartFocusSection
                  id="chart-key-metrics"
                  className={chatOpen ? 'min-w-0 flex-1 space-y-2' : 'space-y-2'}
                >
                  <div className="grid grid-cols-3 gap-3 w-full">
                    {metricCards}
                  </div>
                  {moodPill && (
                    <div className="flex justify-start">
                      {moodPill}
                    </div>
                  )}
                </ChartFocusSection>
              </div>

              {/* 分隔线 */}
              <div className="border-t border-gray-100" />

              {/* 任务用时条形图 */}
              {taskDurations.length > 0 && (
                <ChartFocusSection id="chart-task-duration">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      任务用时
                    </h3>
                    <button
                      onClick={() => setShowAllTaskDistribution(v => !v)}
                      className={`rounded-full border px-2.5 py-1 text-xxs font-medium shadow-sm transition-colors ${
                        showAllTaskDistribution
                          ? 'border-blue-200 bg-blue-50 text-blue-600 hover:border-blue-300 hover:bg-blue-100'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700'
                      }`}
                    >
                      {showAllTaskDistribution ? '收起全部分布' : '显示全部分布'}
                    </button>
                  </div>
                  <TaskDurationChart
                    data={taskDurations}
                    onTaskHover={setHoveredTask}
                    highlightTask={highlightedTask}
                    highlightPulseKey={highlightPulseKey}
                  />
                </ChartFocusSection>
              )}

              {/* 分隔线 */}
              {taskDurations.length > 0 && <div className="border-t border-gray-100" />}

              {/* 电脑活动分布（折线图 + 热力条，共享 x 轴） */}
              <ChartFocusSection id="chart-activity-heatmap">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  电脑活动分布
                  <ChartInfoTooltip>
                    <b>每小时电脑活跃时长</b>（曲线）= 该小时内电脑被实际使用的分钟数（0~60分钟）。曲线越高，表示该时段使用电脑的时间越长。<br/><br/><b>每小时电脑活跃度</b>（色块）= 该小时内检测到的电脑使用时间 ÷ 1小时。颜色越深表示这个时段电脑使用越多。<br/><span className="text-gray-300 mt-1 inline-block">注：连续 1 分钟没有鼠标或键盘操作即视为不活跃。</span>
                  </ChartInfoTooltip>
                </h3>
                <div id="chart-rhythm">
                  <ActivityRhythmChart
                    data={displayActivityData}
                    events={displayEvents}
                    rangeStart={sharedRangeStart}
                    rangeEnd={sharedRangeEnd}
                    highlightHour={highlightedHour}
                    highlightHourRange={highlightedHourRange}
                    highlightPulseKey={highlightPulseKey}
                  />
                </div>
                <div className="mt-0">
                  <InteractiveActivityHeatmap
                    data={displayActivityData}
                    events={displayEvents}
                    rangeStart={sharedRangeStart}
                    rangeEnd={sharedRangeEnd}
                    highlightTask={hoveredTask}
                    highlightHour={highlightedHour}
                    highlightHourRange={highlightedHourRange}
                    highlightPulseKey={highlightPulseKey}
                    showAllTasks={showAllTaskDistribution && taskDurations.length > 0}
                    taskTitles={taskDurations.map(t => t.title)}
                  />
                </div>
              </ChartFocusSection>

              {/* 应用使用时长（按分钟展示，少于 1 分钟显示「< 1 分钟」；默认 Top 5，可展开） */}
              <div className="border-t border-gray-100" />
              <ChartFocusSection id="chart-app-usage">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  应用使用时长
                  <ChartInfoTooltip>
                    今日各前台应用的累计使用时长（精度到分钟，少于 1 分钟显示「&lt; 1 分钟」）。仅在电脑处于活跃状态时统计，已自动排除 MetaPlan 自身、资源管理器、终端等非生产力应用。默认显示前 5 项，可展开查看全部。
                  </ChartInfoTooltip>
                </h3>
                <AppUsageRanking
                  data={displayActivityData}
                  highlightApps={highlightedApps}
                  highlightPulseKey={highlightPulseKey}
                />
              </ChartFocusSection>

              {/* 遗留任务（仅今天显示，历史日期没有任务快照） */}
              {displayIsToday && displaySummary && displaySummary.leftoverTasks.length > 0 && (
                <>
                  <div className="border-t border-gray-100" />
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      未执行任务
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {displaySummary.leftoverTasks.map((t, i) => (
                        <span
                          key={i}
                          className="text-xxs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* 补记时间入口 */}
              <div className="border-t border-gray-100" />
              <ManualTimeEntry
                tasks={displayTasks}
                events={displayEvents}
                selectedDate={selectedDate}
                onConfirm={handleManualEntry}
                onExpandChange={setManualEntryExpanded}
              />
            </div>
          )}
          {spotlightRect && (
            <div
              className={`pointer-events-none fixed inset-0 z-[80] transition-opacity duration-500 ease-out ${
                spotlightVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div
                className="absolute bg-slate-950/60"
                style={{
                  top: spotlightRect.panelTop,
                  left: spotlightRect.panelLeft,
                  width: spotlightRect.panelWidth,
                  height: spotlightRect.top - spotlightRect.panelTop,
                }}
              />
              <div
                className="absolute bg-slate-950/60"
                style={{
                  top: spotlightRect.top,
                  left: spotlightRect.panelLeft,
                  width: spotlightRect.left - spotlightRect.panelLeft,
                  height: spotlightRect.bottom - spotlightRect.top,
                }}
              />
              <div
                className="absolute bg-slate-950/60"
                style={{
                  top: spotlightRect.top,
                  left: spotlightRect.right,
                  width: spotlightRect.panelRight - spotlightRect.right,
                  height: spotlightRect.bottom - spotlightRect.top,
                }}
              />
              <div
                className="absolute bg-slate-950/60"
                style={{
                  top: spotlightRect.bottom,
                  left: spotlightRect.panelLeft,
                  width: spotlightRect.panelWidth,
                  height: spotlightRect.panelBottom - spotlightRect.bottom,
                }}
              />
            </div>
          )}
          {viewMode === 'day' && isDataTransitioning && (
            <div className="pointer-events-auto absolute inset-0 z-20 flex items-start justify-center bg-white/45 backdrop-blur-[1px] transition-opacity duration-200">
              <div className="mt-5 rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 text-2xs text-gray-500 shadow-sm">
                正在切换日期...
              </div>
            </div>
          )}
        </div>

        {/* ---- 可拖拽分隔条 ---- */}
        {chatOpen && (
          <div
            onMouseDown={handleDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize group relative
                       bg-gray-200 hover:bg-indigo-300 transition-colors duration-200"
          >
            <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
            <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2
                            w-1 h-8 rounded-full bg-gray-300 group-hover:bg-indigo-400
                            transition-colors duration-200" />
          </div>
        )}

        {/* ---- 对话侧边栏（日/周共用） ---- */}
        <div
          className="flex-shrink-0 overflow-hidden border-l border-gray-100 flex flex-col
                     transition-[width] duration-400 ease-in-out"
          style={{ width: chatOpen ? chatWidth : 0 }}
        >
          <div className="flex flex-col h-full" style={{ minWidth: MIN_CHAT_WIDTH }}>
            <div className="flex-1 min-h-0">
              {!hasAI ? (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="text-center px-8">
                    <p className="text-4xl mb-3">🤖</p>
                    <p className="text-sm text-gray-500 font-medium mb-1">
                      需要配置 AI 才能开始反思对话
                    </p>
                    <p className="text-xs text-gray-400">
                      请先在标题栏的 AI 设置中填写 API Key 和模型 ID
                    </p>
                  </div>
                </div>
              ) : activeSystemPrompt ? (
                // 暂时不传 onReflectionStyleChange，恢复切换时可放开上方保留的 handler。
                <ReflectionChat
                  ref={chatRef}
                  key={viewMode === 'week' ? `week-${weekEndDate}` : `day-${selectedDate}`}
                  systemPrompt={activeSystemPrompt}
                  aiConfig={aiConfig}
                  mode={viewMode === 'week' ? 'weekly' : 'daily'}
                  reflectionStyle={reflectionStyle}
                  screenshotBase64={null}
                  selectedDate={viewMode === 'week' ? weekEndDate : selectedDate}
                  storageKey={viewMode === 'week' ? `week-${weekEndDate}` : selectedDate}
                  visualTargets={viewMode === 'week' ? weekVisualTargets : visualTargets}
                  memoryMatchContext={activeMemoryMatchContext}
                  memoryContext={memoryContext}
                  onVisualRef={handleVisualRef}
                  onComplete={handleReflectionComplete}
                  onEndChat={handleChatEndedProperly}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---- 右下角 AI 机器人浮标（日/周都显示，补记展开时隐藏避免遮挡） ---- */}
        {!chatOpen && !manualEntryExpanded && (
          <div className="absolute bottom-5 right-5 flex flex-col items-end gap-2 z-20">
            <div
              className={`max-w-[200px] px-3 py-2 rounded-2xl rounded-br-md
                          bg-gray-800 text-white text-xs leading-relaxed shadow-lg
                          transition-all duration-500
                          ${showBubble
                            ? 'opacity-100 translate-y-0'
                            : 'opacity-0 translate-y-2 pointer-events-none'
                          }`}
            >
              {bubbleText}
              <div className="absolute -bottom-1 right-5 w-2.5 h-2.5 bg-gray-800 rotate-45" />
            </div>

            <button
              onClick={openChat}
              onMouseEnter={() => setShowBubble(true)}
              onMouseLeave={() => setShowBubble(false)}
              className="w-11 h-11 rounded-full flex items-center justify-center
                         transition-all duration-200 hover:scale-110 active:scale-95
                         hover:bg-gray-100/80"
              title="开始反思对话"
            >
              <span className="text-2xl">🤖</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
