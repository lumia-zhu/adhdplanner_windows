/**
 * ReflectionView —— 每日反思主页面
 *
 * 默认：数据可视化全屏居中，右下角 AI 浮标引导
 * 点击浮标：窗口变宽 + 对话侧边栏从右侧滑入
 * 中间可拖拽分隔条调整比例
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { buildReflectionSystemPrompt } from '../services/ai'
import type { TrackEvent, DailySummary } from '../services/tracker'
import { buildDailySummary, summaryToLLMContext } from '../services/tracker'
import DonutChart from './DonutChart'
import TaskDurationChart from './TaskDurationChart'
import type { TaskDurationItem } from './TaskDurationChart'
import DayTimeline from './DayTimeline'
import type { TimelineEntry } from './DayTimeline'
import ReflectionChat from './ReflectionChat'
import { tracker } from '../services/tracker'

interface ReflectionViewProps {
  tasks: Task[]
  aiConfig: AIConfig
  onClose: () => void
}

// ===================== 常量 =====================

/** AI 浮标随机引导语 */
const BUBBLE_HINTS = [
  '今天过得怎么样？来聊聊~',
  '点我开始反思，只需 3 个问题 ✨',
  '回顾一下今天，发现你的亮点 💡',
  '嘿，有什么想聊的吗？',
  '数据已准备好，一起来看看吧！',
  '花 2 分钟回顾，明天更高效 🚀',
  '今天的你，值得被看见 🌟',
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

/** 获取今日日期字符串 */
function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ===================== 主组件 =====================

export default function ReflectionView({ tasks, aiConfig, onClose }: ReflectionViewProps) {
  const [events, setEvents] = useState<TrackEvent[]>([])
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  // ---- 侧边栏状态 ----
  const [chatOpen, setChatOpen] = useState(false)
  const [chatWidth, setChatWidth] = useState(400) // 侧边栏初始宽度

  // ---- AI 浮标气泡 ----
  const [bubbleText] = useState(() =>
    BUBBLE_HINTS[Math.floor(Math.random() * BUBBLE_HINTS.length)]
  )
  const [showBubble, setShowBubble] = useState(false)

  // ---- 拖拽分隔条 ----
  const isDragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const today = getToday()

  // 加载今日事件数据
  useEffect(() => {
    async function loadEvents() {
      try {
        // ★ 先强制刷新 tracker 缓冲区到磁盘，确保最近的事件不会丢失
        await tracker.flushAsync()

        const raw = await window.electronAPI.loadTrackerEvents(today)
        const typedEvents = raw as TrackEvent[]
        setEvents(typedEvents)

        const s = buildDailySummary(today, typedEvents)
        setSummary(s)
      } catch (e) {
        console.error('加载反思数据失败:', e)
      } finally {
        setLoadingData(false)
      }
    }
    loadEvents()
  }, [today])

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

  // 构建任务用时数据（从 session.ended 事件聚合）
  const taskDurations: TaskDurationItem[] = useMemo(() => {
    // 按任务名聚合所有 session 的总时长
    const durationMap = new Map<string, number>()
    const endReasonMap = new Map<string, string>()

    for (const e of events) {
      if (e.type === 'session.ended') {
        const p = e.payload as { taskTitle: string; totalDurationSeconds: number; endReason: string }
        durationMap.set(p.taskTitle, (durationMap.get(p.taskTitle) || 0) + p.totalDurationSeconds)
        // 记录最终结束原因（最后一个 session 的 endReason 为准）
        endReasonMap.set(p.taskTitle, p.endReason)
      }
    }

    // 转为数组，按时长降序排列
    return Array.from(durationMap.entries())
      .map(([title, sec]) => ({
        title,
        durationMin: Math.round(sec / 60),
        completed: endReasonMap.get(title) === 'task_done',
      }))
      .filter(d => d.durationMin > 0)
      .sort((a, b) => b.durationMin - a.durationMin)
  }, [events])

  // 构建 AI system prompt
  const systemPrompt = useMemo(() => {
    if (!summary) return ''
    const context = summaryToLLMContext(summary)
    const taskInfo = `\n\n额外信息：\n- 当前任务总数：${tasks.length}\n- 已完成任务：${tasks.filter(t => t.completed).length}\n- 完成率：${completionRate}%\n- 待办任务：${tasks.filter(t => !t.completed).map(t => t.title).join('、') || '无'}`
    return buildReflectionSystemPrompt(context + taskInfo)
  }, [summary, tasks, completionRate])

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

  // ---- 打开/关闭侧边栏时调整窗口大小 ----
  const openChat = useCallback(() => {
    setChatOpen(true)
    window.electronAPI.resizeMainWindow(EXPANDED_WIDTH, MAIN_HEIGHT)
  }, [])

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

  // ---- 加载中 ----
  if (loadingData) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">正在加载今日数据...</p>
        </div>
      </div>
    )
  }

  // ---- 是否有 AI 配置 ----
  const hasAI = !!(aiConfig.apiKey && aiConfig.modelId)

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* ====== 顶部标题栏 ====== */}
      <div className="drag-region flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2.5 no-drag">
          <div className="w-7 h-7 rounded-lg bg-amber-400 flex items-center justify-center">
            <span className="text-sm">💡</span>
          </div>
          <h1 className="font-semibold text-gray-800 text-sm">每日反思</h1>
          <span className="text-xs text-gray-400">{today}</span>
        </div>
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

      {/* ====== 主内容区 ====== */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">

        {/* ---- 数据可视化区域 ---- */}
        <div
          className="flex-1 overflow-y-auto transition-all duration-400"
          style={{ minWidth: MIN_DATA_WIDTH }}
        >
          {/* 内容容器：chatOpen 时靠左紧凑，关闭时居中宽松 */}
          <div className={`p-6 space-y-6 transition-all duration-400 ${
            chatOpen
              ? 'max-w-sm'
              : 'max-w-xl mx-auto'
          }`}>
            {/* 圆环图 */}
            <div className="flex flex-col items-center">
              <DonutChart
                percentage={completionRate}
                size={chatOpen ? 140 : 180}
                strokeWidth={chatOpen ? 12 : 14}
                label="任务完成率"
              />

              {/* 快捷统计 */}
              <div className={`mt-5 grid gap-3 w-full transition-all duration-400 ${
                chatOpen ? 'grid-cols-2' : 'grid-cols-4'
              }`}>
                <div className="text-center bg-emerald-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-emerald-600">
                    {summary?.stats.completedMicroSteps ?? 0}
                  </p>
                  <p className="text-[10px] text-emerald-500 mt-0.5">微步完成</p>
                </div>
                <div className="text-center bg-violet-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-violet-600">
                    {summary?.stats.totalFlowMinutes ?? 0}
                    <span className="text-xs font-normal ml-0.5">分钟</span>
                  </p>
                  <p className="text-[10px] text-violet-500 mt-0.5">心流时长</p>
                </div>
                <div className="text-center bg-indigo-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-indigo-600">
                    {summary?.stats.totalFocusMinutes ?? 0}
                    <span className="text-xs font-normal ml-0.5">分钟</span>
                  </p>
                  <p className="text-[10px] text-indigo-500 mt-0.5">总专注</p>
                </div>
                <div className="text-center bg-orange-50 rounded-xl py-2.5 px-2">
                  <p className="text-lg font-bold text-orange-600">
                    {summary?.stats.totalStuckCount ?? 0}
                    <span className="text-xs font-normal ml-0.5">次</span>
                  </p>
                  <p className="text-[10px] text-orange-500 mt-0.5">卡顿次数</p>
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-gray-100" />

            {/* 任务用时条形图 */}
            {taskDurations.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  ⏱ 任务实际用时
                </h3>
                <TaskDurationChart data={taskDurations} />
              </div>
            )}

            {/* 分隔线 */}
            {taskDurations.length > 0 && <div className="border-t border-gray-100" />}

            {/* 时间轴 */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                📅 一日轨迹
              </h3>
              <DayTimeline entries={timelineEntries} />
            </div>

            {/* 遗留任务 */}
            {summary && summary.leftoverTasks.length > 0 && (
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
                        className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ---- 可拖拽分隔条 ---- */}
        {chatOpen && (
          <div
            onMouseDown={handleDragStart}
            className="w-1 flex-shrink-0 cursor-col-resize group relative
                       bg-gray-200 hover:bg-indigo-300 transition-colors duration-200"
          >
            {/* 扩大拖拽热区 */}
            <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
            {/* 中央把手 */}
            <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2
                            w-1 h-8 rounded-full bg-gray-300 group-hover:bg-indigo-400
                            transition-colors duration-200" />
          </div>
        )}

        {/* ---- 对话侧边栏 ---- */}
        <div
          className="flex-shrink-0 overflow-hidden border-l border-gray-100 flex flex-col
                     transition-[width] duration-400 ease-in-out"
          style={{ width: chatOpen ? chatWidth : 0 }}
        >
          {/* 侧边栏内部（始终渲染，width=0 时被 overflow-hidden 截掉） */}
          <div className="flex flex-col h-full" style={{ minWidth: MIN_CHAT_WIDTH }}>
            {/* 侧边栏顶部：左上角收起按钮 */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 flex-shrink-0">
              <button
                onClick={closeChat}
                className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center
                           text-gray-400 hover:text-gray-600 transition-colors"
                title="收起对话"
              >
                {/* 向右箭头（收起方向） */}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
              <span className="text-xs font-semibold text-gray-500">AI 反思助手</span>
            </div>

            {/* 对话内容 */}
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
              ) : systemPrompt ? (
                <ReflectionChat
                  systemPrompt={systemPrompt}
                  aiConfig={aiConfig}
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

        {/* ---- 右下角 AI 机器人浮标（始终显示） ---- */}
        {!chatOpen && (
          <div className="absolute bottom-5 right-5 flex flex-col items-end gap-2 z-20">
            {/* 气泡提示 */}
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
              {/* 小三角 */}
              <div className="absolute -bottom-1 right-5 w-2.5 h-2.5 bg-gray-800 rotate-45" />
            </div>

            {/* 浮标按钮：透明底色，只有 emoji */}
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
