/**
 * ReflectionView —— 每日反思主页面
 *
 * 「左看数据，右做反思」的双列布局
 * 左侧：圆环图（完成率）+ 一日时间轴
 * 右侧：AI 引导式反思对话
 */

import { useState, useEffect, useMemo } from 'react'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { buildReflectionSystemPrompt } from '../services/ai'
import type { TrackEvent, DailySummary } from '../services/tracker'
import { buildDailySummary, summaryToLLMContext } from '../services/tracker'
import DonutChart from './DonutChart'
import DayTimeline from './DayTimeline'
import type { TimelineEntry } from './DayTimeline'
import ReflectionChat from './ReflectionChat'
import { tracker } from '../services/tracker'

interface ReflectionViewProps {
  tasks: Task[]
  aiConfig: AIConfig
  onClose: () => void
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

  const today = getToday()

  // 加载今日事件数据
  useEffect(() => {
    async function loadEvents() {
      try {
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

  // 计算任务完成率
  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((tasks.filter(t => t.completed).length / tasks.length) * 100)
  }, [tasks])

  // 构建时间轴条目
  const timelineEntries = useMemo(() => buildTimelineEntries(events), [events])

  // 构建 AI system prompt
  const systemPrompt = useMemo(() => {
    if (!summary) return ''

    // 补充任务完成率信息
    const context = summaryToLLMContext(summary)
    const taskInfo = `\n\n额外信息：\n- 当前任务总数：${tasks.length}\n- 已完成任务：${tasks.filter(t => t.completed).length}\n- 完成率：${completionRate}%\n- 待办任务：${tasks.filter(t => !t.completed).map(t => t.title).join('、') || '无'}`

    return buildReflectionSystemPrompt(context + taskInfo)
  }, [summary, tasks, completionRate])

  // 反思完成回调
  const handleReflectionComplete = (summaryText: string) => {
    // 📊 埋点：反思完成
    tracker.track('daily.leftovers', {
      leftoverTasks: tasks
        .filter(t => !t.completed)
        .map(t => ({ id: t.id, title: t.title, priority: t.priority })),
      totalCount: tasks.filter(t => !t.completed).length,
    })
    console.log('[Reflection] 完成:', summaryText.slice(0, 100))
  }

  // 加载中状态
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

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      {/* 顶部标题栏 */}
      <div className="drag-region flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2.5 no-drag">
          <div className="w-7 h-7 rounded-lg bg-amber-400 flex items-center justify-center">
            <span className="text-sm">💡</span>
          </div>
          <h1 className="font-semibold text-gray-800 text-sm">每日反思</h1>
          <span className="text-xs text-gray-400">{today}</span>
        </div>
        <button
          onClick={onClose}
          className="no-drag w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
          title="返回主界面"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 主内容区 - 双列布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* ====== 左侧：数据可视化 ====== */}
        <div className="w-[280px] flex-shrink-0 border-r border-gray-100 overflow-y-auto">
          <div className="p-5 space-y-6">
            {/* 圆环图 */}
            <div className="flex flex-col items-center">
              <DonutChart
                percentage={completionRate}
                size={140}
                strokeWidth={12}
                label="任务完成率"
              />

              {/* 快捷统计 */}
              <div className="mt-4 grid grid-cols-2 gap-3 w-full">
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

        {/* ====== 右侧：AI 对话窗 ====== */}
        <div className="flex-1 flex flex-col min-w-0">
          {!aiConfig.apiKey || !aiConfig.modelId ? (
            <div className="flex-1 flex items-center justify-center">
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
            <div className="flex-1 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
