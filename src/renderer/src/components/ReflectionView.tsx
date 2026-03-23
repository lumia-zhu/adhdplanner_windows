/**
 * ReflectionView —— 每日反思主页面
 *
 * 默认：数据可视化全屏居中，右下角 AI 浮标引导
 * 点击浮标：窗口变宽 + 对话侧边栏从右侧滑入
 * 中间可拖拽分隔条调整比例
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { buildReflectionSystemPrompt, buildWeeklyReflectionSystemPrompt } from '../services/ai'
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
import ReflectionChat from './ReflectionChat'
import ManualTimeEntry from './ManualTimeEntry'
import MiniCalendar from './MiniCalendar'
import WeekView from './WeekView'
import type { WeekDayData } from './WeekView'
import { getWeekDates } from './WeekView'
import { tracker } from '../services/tracker'

interface ReflectionViewProps {
  tasks: Task[]
  aiConfig: AIConfig
  onClose: () => void
}

// ===================== 常量 =====================

/** AI 浮标随机引导语 —— 今天 */
const BUBBLE_HINTS_TODAY = [
  '今天过得怎么样？来聊聊~',
  '点我开始反思，只需 3 个问题 ✨',
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

/** 主窗口默认宽度（和 main/index.ts 里的 MAIN_WIDTH 一致） */
const MAIN_WIDTH = 480
const MAIN_HEIGHT = 680
/** 侧边栏展开时窗口总宽度 */
const EXPANDED_WIDTH = 880
/** 侧边栏最小宽度 */
const MIN_CHAT_WIDTH = 320
/** 侧边栏最大宽度占比 */
const MAX_CHAT_RATIO = 0.65
/** 数据区最小宽度 */
const MIN_DATA_WIDTH = 300

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

/** 把 YYYY-MM-DD 格式化为友好显示，如 "3月12日 周四" */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function formatDateFriendly(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

// ===================== 主组件 =====================

export default function ReflectionView({ tasks, aiConfig, onClose }: ReflectionViewProps) {
  const [events, setEvents] = useState<TrackEvent[]>([])
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [activityData, setActivityData] = useState<ActivityRecord[]>([])
  const [loadingData, setLoadingData] = useState(true)

  // ---- 侧边栏状态 ----
  const [chatOpen, setChatOpen] = useState(false)
  const [chatWidth, setChatWidth] = useState(400) // 侧边栏初始宽度
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null) // 仪表板截图
  const dataPanelRef = useRef<HTMLDivElement>(null) // 数据面板引用（用于截图）
  const [manualEntryExpanded, setManualEntryExpanded] = useState(false)

  // ---- AI 浮标气泡 ----
  const [showBubble, setShowBubble] = useState(false)

  // ---- 日/周 视图模式 ----
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day')

  // ---- 日期选择 & 日历弹窗 ----
  const today = getToday()
  const [selectedDate, setSelectedDate] = useState(today)
  const isToday = selectedDate === today
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

  // 切换日期时：关闭 AI 侧边栏 + 清除截图缓存（每天数据不同需重新截图）
  const resetChatOnDateChange = useCallback(() => {
    setScreenshotBase64(null)
    if (chatOpen) {
      setChatOpen(false)
      window.electronAPI.resizeMainWindow(MAIN_WIDTH, MAIN_HEIGHT)
    }
  }, [chatOpen])

  const goPrev = useCallback(() => {
    setSelectedDate(d => shiftDate(d, -1))
    resetChatOnDateChange()
  }, [resetChatOnDateChange])
  const goNext = useCallback(() => {
    setSelectedDate(d => {
      const next = shiftDate(d, 1)
      return next > getToday() ? d : next   // 不能超过今天
    })
    resetChatOnDateChange()
  }, [resetChatOnDateChange])
  const goToday = useCallback(() => {
    setSelectedDate(getToday())
    resetChatOnDateChange()
  }, [resetChatOnDateChange])

  // ---- 拖拽分隔条 ----
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 加载选中日期的事件数据 + 活跃度数据
  useEffect(() => {
    let cancelled = false
    async function loadEvents() {
      setLoadingData(true)
      try {
        // ★ 如果是今天，先刷新 tracker 缓冲区确保最新数据
        if (selectedDate === getToday()) {
          await tracker.flushAsync()
        }

        const [raw, rawActivity] = await Promise.all([
          window.electronAPI.loadTrackerEvents(selectedDate),
          window.electronAPI.loadActivityData(selectedDate),
        ])

        if (cancelled) return  // 防止切换日期后旧请求覆盖新数据

        const typedEvents = raw as TrackEvent[]
        setEvents(typedEvents)
        setActivityData(rawActivity as ActivityRecord[])

        const s = buildDailySummary(selectedDate, typedEvents)
        setSummary(s)
      } catch (e) {
        console.error('加载反思数据失败:', e)
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    }
    loadEvents()
    return () => { cancelled = true }
  }, [selectedDate])

  // 数据加载完后，后台预截图（避免点浮标时阻塞）
  useEffect(() => {
    if (loadingData || screenshotBase64 || chatOpen) return
    if (!dataPanelRef.current) return

    const timer = setTimeout(async () => {
      if (!dataPanelRef.current) return
      try {
        const canvas = await html2canvas(dataPanelRef.current, {
          scale: 1,
          useCORS: true,
          backgroundColor: '#ffffff',
          height: dataPanelRef.current.scrollHeight,
          windowHeight: dataPanelRef.current.scrollHeight,
        })
        const base64 = canvas.toDataURL('image/jpeg', 0.75)
        setScreenshotBase64(base64)
        console.log('[Reflection] 预截图完成，大小:', Math.round(base64.length / 1024), 'KB')
      } catch (e) {
        console.warn('[Reflection] 预截图失败:', e)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [loadingData, screenshotBase64, chatOpen])

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

  // 计算任务完成率
  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((tasks.filter(t => t.completed).length / tasks.length) * 100)
  }, [tasks])

  // 构建时间轴条目
  const timelineEntries = useMemo(() => buildTimelineEntries(events), [events])

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

    for (const e of events) {
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

    // 建立 tasks 中已完成的任务名集合
    const completedTaskTitles = new Set(tasks.filter(t => t.completed).map(t => t.title))

    // ---- 5. 收集卡顿标记，并计算正确的累计偏移 ----
    const stuckMarksByTask = new Map<string, StuckMark[]>()

    // 预构建"恢复事件"索引：同 sessionId 下在 stuck.triggered 之后出现的恢复性事件
    // 有这些事件说明卡顿已解决：stuck.pivot_chosen / exec.micro_started / exec.micro_completed / exec.flow_entered
    const resolvedSessionSet = new Set<string>()
    for (const e of events) {
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

    for (const e of events) {
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
        for (const re of events) {
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
        for (const re of events) {
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
  }, [events, tasks])

  // ---- 生产力指标（基于使用时长模型：1 分钟无操作 → 未使用） ----

  /** 电脑使用总时长（分钟）：所有 30 秒窗口的 usageRatio 之和 × 0.5 */
  const totalUsageMinutes = useMemo(() => {
    if (activityData.length === 0) return 0
    return Math.round(
      activityData.reduce((sum, r) => sum + getActiveRatio(r) * 0.5, 0)
    )
  }, [activityData])

  /** 生产力比率：专注时长 / 电脑使用时长 × 100% */
  const productivityRatio = useMemo(() => {
    if (totalUsageMinutes <= 0) return 0
    const focusMin = summary?.stats.totalFocusMinutes ?? 0
    return Math.min(Math.round((focusMin / totalUsageMinutes) * 100), 100)
  }, [totalUsageMinutes, summary])

  /** 心流占比：心流时长 / 专注时长 × 100% */
  const flowRatio = useMemo(() => {
    const focusMin = summary?.stats.totalFocusMinutes ?? 0
    if (focusMin <= 0) return 0
    const flowMin = summary?.stats.totalFlowMinutes ?? 0
    return Math.min(Math.round((flowMin / focusMin) * 100), 100)
  }, [summary])

  /** 格式化使用时长：< 60 分钟显示"X分钟"，>= 60 分钟显示"X.Xh" */
  const usageDurationStr = useMemo(() => {
    if (totalUsageMinutes < 60) return { value: totalUsageMinutes, unit: '分钟' }
    const hours = (totalUsageMinutes / 60).toFixed(1)
    return { value: hours, unit: '小时' }
  }, [totalUsageMinutes])

  /**
   * 将 activityData 按小时聚合为精力分布描述。
   * 例如："9点-10点 活跃、14点-16点 基本空闲"
   */
  const activityTimeDistribution = useMemo(() => {
    if (activityData.length === 0) return ''
    const hourBuckets: Record<number, { active: number; total: number }> = {}
    for (const r of activityData) {
      const h = new Date(r.ts).getHours()
      if (!hourBuckets[h]) hourBuckets[h] = { active: 0, total: 0 }
      hourBuckets[h].total++
      hourBuckets[h].active += getActiveRatio(r)
    }
    const hours = Object.keys(hourBuckets).map(Number).sort((a, b) => a - b)
    if (hours.length === 0) return ''

    const segments: string[] = []
    for (const h of hours) {
      const b = hourBuckets[h]
      const ratio = Math.round((b.active / b.total) * 100)
      const label = ratio >= 70 ? '活跃' : ratio >= 30 ? '一般' : '基本空闲'
      segments.push(`${h}:00 ${label}(${ratio}%)`)
    }
    return segments.join('、')
  }, [activityData])

  // 构建 AI system prompt
  const systemPrompt = useMemo(() => {
    if (!summary) return ''
    const context = summaryToLLMContext(summary, events)
    const taskInfo = `\n\n额外信息：\n- 当前任务总数：${tasks.length}\n- 已完成任务：${tasks.filter(t => t.completed).length}\n- 完成率：${completionRate}%\n- 待办任务：${tasks.filter(t => !t.completed).map(t => t.title).join('、') || '无'}`
    const productivityInfo = `\n\n生产力指标：\n- 电脑使用时长：${totalUsageMinutes}分钟\n- 专注时长：${summary.stats.totalFocusMinutes}分钟\n- 生产力比率：${productivityRatio}%（专注/使用）\n- 心流占比：${flowRatio}%（心流/专注）`
    const activityInfo = activityTimeDistribution
      ? `\n\n精力时间分布（每小时电脑活跃度）：\n${activityTimeDistribution}`
      : ''
    return buildReflectionSystemPrompt(context + taskInfo + productivityInfo + activityInfo, !!screenshotBase64, isToday)
  }, [summary, events, tasks, completionRate, totalUsageMinutes, productivityRatio, flowRatio, activityTimeDistribution, screenshotBase64, isToday])

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
    return buildWeeklyReflectionSystemPrompt(context, !!screenshotBase64, weekLabel)
  }, [weekDayData, weekEndDate, screenshotBase64])

  // 根据当前视图模式选择对应的 system prompt
  const activeSystemPrompt = viewMode === 'week' ? weekSystemPrompt : systemPrompt

  // 反思完成回调
  const handleReflectionComplete = (summaryText: string) => {
    tracker.track('daily.leftovers', {
      leftoverTasks: tasks
        .filter(t => !t.completed)
        .map(t => ({ id: t.id, title: t.title, priority: t.priority })),
      totalCount: tasks.filter(t => !t.completed).length,
    })
    console.log('[Reflection] 完成:', summaryText.slice(0, 100))
  }

  // ---- 补记时间回调：写入 tracker 事件 + 新任务写入任务列表，然后刷新数据 ----
  const handleManualEntry = useCallback(
    async (newEvents: TrackEvent[], newTasks: { title: string }[]) => {
      if (newEvents.length === 0) return

      // 1. 写入 tracker 事件
      await window.electronAPI.appendTrackerEvents(
        selectedDate,
        newEvents as unknown[],
      )

      // 2. 新任务写入今日任务列表
      if (newTasks.length > 0) {
        const existingTasks = await window.electronAPI.loadTasks(selectedDate)
        const tasksToAdd = newTasks.map((t) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: t.title,
          note: '',
          priority: 'medium' as const,
          completed: false,
          createdAt: Date.now(),
        }))
        await window.electronAPI.saveTasks(selectedDate, [
          ...(existingTasks as unknown[]),
          ...tasksToAdd,
        ])
      }

      // 3. 重新加载事件数据以刷新图表
      const [raw, rawActivity] = await Promise.all([
        window.electronAPI.loadTrackerEvents(selectedDate),
        window.electronAPI.loadActivityData(selectedDate),
      ])
      const typedEvents = raw as TrackEvent[]
      setEvents(typedEvents)
      setActivityData(rawActivity as ActivityRecord[])
      setSummary(buildDailySummary(selectedDate, typedEvents))
    },
    [selectedDate],
  )

  // ---- 图表引用：滚动 + 高亮对应图表 ----
  const handleChartRef = useCallback((chartId: string) => {
    const el = document.getElementById(chartId)
    if (!el) return

    // 平滑滚动到目标图表
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // 添加高亮动画（闪烁 2 秒后自动移除）
    el.classList.add('chart-highlight')
    setTimeout(() => el.classList.remove('chart-highlight'), 2000)
  }, [])

  // ---- 打开/关闭侧边栏时调整窗口大小 ----
  const openChat = useCallback(async () => {
    // 如果预截图还没完成（用户手快），当场补截
    if (dataPanelRef.current && !screenshotBase64) {
      try {
        const canvas = await html2canvas(dataPanelRef.current, {
          scale: 1,
          useCORS: true,
          backgroundColor: '#ffffff',
          height: dataPanelRef.current.scrollHeight,
          windowHeight: dataPanelRef.current.scrollHeight,
        })
        const base64 = canvas.toDataURL('image/jpeg', 0.75)
        setScreenshotBase64(base64)
        console.log('[Reflection] 补截图完成，大小:', Math.round(base64.length / 1024), 'KB')
      } catch (e) {
        console.warn('[Reflection] 补截图失败:', e)
      }
    }
    setChatOpen(true)
    window.electronAPI.resizeMainWindow(EXPANDED_WIDTH, MAIN_HEIGHT)
  }, [screenshotBase64])

  const closeChat = useCallback(() => {
    setChatOpen(false)
    window.electronAPI.resizeMainWindow(MAIN_WIDTH, MAIN_HEIGHT)
  }, [])

  // 关闭反思页面时也要恢复窗口大小
  const handleClose = useCallback(() => {
    if (chatOpen) {
      window.electronAPI.resizeMainWindow(MAIN_WIDTH, MAIN_HEIGHT)
    }
    onClose()
  }, [chatOpen, onClose])

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

  // ---- 加载中（仅日视图模式下等待日数据加载） ----
  if (loadingData && viewMode === 'day') {
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

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* ====== 顶部标题栏 ====== */}
      <div className="drag-region flex items-center px-5 py-3 border-b border-gray-100 flex-shrink-0">
        {/* 左侧：图标 + 标题 */}
        <div className="flex items-center gap-2.5 no-drag flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-amber-400 flex items-center justify-center">
            <span className="text-sm">💡</span>
          </div>
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
                      resetChatOnDateChange()
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
                               bg-indigo-50 text-indigo-500 hover:bg-indigo-100 transition-colors"
                  >
                    今天
                  </button>
                )}
              </div>
            ) : (
              /* ---- 周视图导航 ---- */
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setWeekEndDate(d => shiftDate(d, -7)); resetChatOnDateChange() }}
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
                  onClick={() => { setWeekEndDate(d => { const next = shiftDate(d, 7); return next > getToday() ? getToday() : next }); resetChatOnDateChange() }}
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
                    onClick={() => { setWeekEndDate(getToday()); resetChatOnDateChange() }}
                    className="ml-1 px-2 py-0.5 rounded-full text-2xs font-semibold
                               bg-indigo-50 text-indigo-500 hover:bg-indigo-100 transition-colors"
                  >
                    本周
                  </button>
                )}
              </div>
            )}

            <div className="flex rounded-md bg-gray-100 p-0.5">
              <button
                onClick={() => {
                  setViewMode('day')
                  resetChatOnDateChange()
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
                  setViewMode('week')
                  setWeekEndDate(selectedDate)
                  resetChatOnDateChange()
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

        {/* 右侧：关闭按钮 */}
        <div className="flex-shrink-0 flex justify-end">
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
          className="flex-1 overflow-y-auto transition-all duration-400"
          style={{ minWidth: MIN_DATA_WIDTH }}
        >
          {viewMode === 'week' ? (
            /* ---- 周视图 ---- */
            <WeekView weekEndDate={weekEndDate} onDataReady={handleWeekDataReady} chatOpen={chatOpen} />
          ) : (
            /* ---- 日视图 ---- */
            <div className={`p-6 space-y-6 transition-all duration-400 ${
              chatOpen
                ? 'w-full'
                : 'max-w-xl mx-auto'
            }`}>
              {/* 圆环图 + 核心指标并排（chatOpen 时节省纵向空间） */}
              {isToday && (
                <div id="chart-completion-rate" className={`${
                  chatOpen
                    ? 'flex items-center gap-6'
                    : 'flex flex-col items-center'
                }`}>
                  <DonutChart
                    percentage={completionRate}
                    size={chatOpen ? 120 : 180}
                    strokeWidth={chatOpen ? 10 : 14}
                    label="任务完成率"
                  />
                  {/* chatOpen 时把指标卡片内联到圆环右侧 */}
                  {chatOpen && (
                    <div id="chart-key-metrics" className="grid grid-cols-3 gap-3 flex-1">
                      <div className="text-center bg-emerald-50 rounded-xl py-2.5 px-2">
                        <p className="text-lg font-bold text-emerald-600">{tasks.filter(t => t.completed).length}</p>
                        <p className="text-2xs text-emerald-500 mt-0.5">完成任务数</p>
                      </div>
                      <div className="text-center bg-blue-50 rounded-xl py-2.5 px-2">
                        <p className="text-lg font-bold text-blue-600">
                          {usageDurationStr.value}
                          <span className="text-xs font-normal ml-0.5">{usageDurationStr.unit}</span>
                        </p>
                        <p className="text-2xs text-blue-500 mt-0.5">电脑使用时长</p>
                      </div>
                      <div className="text-center bg-indigo-50 rounded-xl py-2.5 px-2">
                        <p className="text-lg font-bold text-indigo-600">
                          {summary?.stats.totalFocusMinutes ?? 0}
                          <span className="text-xs font-normal ml-0.5">分钟</span>
                        </p>
                        <p className="text-2xs text-indigo-500 mt-0.5">任务时长</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 核心指标卡片（仅 chatOpen=false 时独立显示） */}
              {(!chatOpen || !isToday) && (
              <div id="chart-key-metrics" className={`grid gap-3 w-full ${
                chatOpen ? 'grid-cols-2' : 'grid-cols-3'
              }`}>
                <div className="text-center bg-emerald-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-emerald-600">
                    {tasks.filter(t => t.completed).length}
                  </p>
                  <p className="text-2xs text-emerald-500 mt-0.5">完成任务数</p>
                </div>
                <div className="text-center bg-blue-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-blue-600">
                    {usageDurationStr.value}
                    <span className="text-xs font-normal ml-0.5">{usageDurationStr.unit}</span>
                  </p>
                  <p className="text-2xs text-blue-500 mt-0.5">电脑使用时长</p>
                </div>
                <div className="text-center bg-indigo-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-indigo-600">
                    {summary?.stats.totalFocusMinutes ?? 0}
                    <span className="text-xs font-normal ml-0.5">分钟</span>
                  </p>
                  <p className="text-2xs text-indigo-500 mt-0.5">任务时长</p>
                </div>
              </div>
              )}

              {/* 分隔线 */}
              <div className="border-t border-gray-100" />

              {/* 任务用时条形图 */}
              {taskDurations.length > 0 && (
                <div id="chart-task-duration">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                    ⏱ 任务实际用时
                  </h3>
                  <TaskDurationChart data={taskDurations} />
                </div>
              )}

              {/* 分隔线 */}
              {taskDurations.length > 0 && <div className="border-t border-gray-100" />}

              {/* 任务活动分布（交互式热力图 + 任务时间轴） */}
              <div id="chart-activity-heatmap">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  🔍 任务活动分布
                </h3>
                <InteractiveActivityHeatmap data={activityData} events={events} />
              </div>

              {/* 分隔线 */}
              <div className="border-t border-gray-100" />

              {/* 使用节奏曲线 */}
              <div id="chart-rhythm">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  📈 使用节奏曲线
                </h3>
                <ActivityRhythmChart data={activityData} />
              </div>

              {/* 遗留任务（仅今天显示，历史日期没有任务快照） */}
              {isToday && summary && summary.leftoverTasks.length > 0 && (
                <>
                  <div className="border-t border-gray-100" />
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      📦 未执行任务
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {summary.leftoverTasks.map((t, i) => (
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
                tasks={tasks}
                events={events}
                selectedDate={selectedDate}
                onConfirm={handleManualEntry}
                onExpandChange={setManualEntryExpanded}
              />
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
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 flex-shrink-0">
              <button
                onClick={closeChat}
                className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center
                           text-gray-400 hover:text-gray-600 transition-colors"
                title="收起对话"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
              <span className="text-xs font-semibold text-gray-500">
                AI {viewMode === 'week' ? '周' : ''}反思助手
              </span>
            </div>

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
                <ReflectionChat
                  key={viewMode === 'week' ? `week-${weekEndDate}` : `day-${selectedDate}`}
                  systemPrompt={activeSystemPrompt}
                  aiConfig={aiConfig}
                  screenshotBase64={screenshotBase64}
                  selectedDate={viewMode === 'week' ? weekEndDate : selectedDate}
                  storageKey={viewMode === 'week' ? `week-${weekEndDate}` : selectedDate}
                  onChartRef={handleChartRef}
                  onComplete={handleReflectionComplete}
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
