import { useEffect, useRef, useCallback } from 'react'
import type { Task } from '../types'
import type { AIConfig } from '../services/ai'
import { aiCache } from '../services/ai-cache'

/**
 * 管理 AI 建议缓存的三个预加载策略：
 *   1. 页面加载后预加载所有待办任务
 *   2. 新任务创建时立即预加载
 *   3. 任务标题变更时防抖重新预加载
 */
export function useAICache(
  tasks: Task[],
  aiConfig: AIConfig,
  loading: boolean,
  isWidgetMode: boolean,
) {
  const pendingTasks = tasks.filter(t => !t.completed)

  // 策略 1：页面加载后批量预加载
  useEffect(() => {
    if (loading || isWidgetMode || !aiConfig.apiKey) return
    pendingTasks.forEach((t, i) => {
      const subtaskTitle = (t.subtasks ?? []).find(s => !s.completed)?.title
      setTimeout(() => aiCache.prefetch(t.id, t.title, aiConfig, subtaskTitle), i * 1000)
    })
  }, [loading, isWidgetMode, aiConfig]) // eslint-disable-line react-hooks/exhaustive-deps

  // 策略 2：新任务创建时立即预加载
  const prevTaskCountRef = useRef(0)
  useEffect(() => {
    if (loading || isWidgetMode || !aiConfig.apiKey) return
    const currentCount = pendingTasks.length
    if (currentCount > prevTaskCountRef.current && currentCount > 0) {
      const newest = pendingTasks[currentCount - 1]
      const subtaskTitle = (newest.subtasks ?? []).find(s => !s.completed)?.title
      aiCache.prefetch(newest.id, newest.title, aiConfig, subtaskTitle)
    }
    prevTaskCountRef.current = currentCount
  }, [pendingTasks.length, aiConfig]) // eslint-disable-line react-hooks/exhaustive-deps

  // 策略 3：标题变更 → 清旧缓存 + 防抖重新预加载
  const prevTaskTitlesRef = useRef<Map<string, string>>(new Map())
  const titleChangeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    if (loading || !aiConfig.apiKey) return
    const prevTitles = prevTaskTitlesRef.current

    for (const task of tasks) {
      const prevTitle = prevTitles.get(task.id)
      if (prevTitle !== undefined && prevTitle !== task.title) {
        aiCache.invalidate(task.id)
        const existingTimer = titleChangeTimersRef.current.get(task.id)
        if (existingTimer) clearTimeout(existingTimer)

        if (!task.completed && !isWidgetMode) {
          const taskSnapshot = { id: task.id, title: task.title, subtasks: task.subtasks }
          const timer = setTimeout(() => {
            console.log(`[AI Cache] 任务标题变更完成: → "${taskSnapshot.title}"，重新预加载`)
            const subtaskTitle = (taskSnapshot.subtasks ?? []).find(s => !s.completed)?.title
            aiCache.prefetch(taskSnapshot.id, taskSnapshot.title, aiConfig, subtaskTitle)
            titleChangeTimersRef.current.delete(taskSnapshot.id)
          }, 800)
          titleChangeTimersRef.current.set(task.id, timer)
        }
      }
    }

    const newTitles = new Map<string, string>()
    for (const task of tasks) {
      newTitles.set(task.id, task.title)
    }
    prevTaskTitlesRef.current = newTitles
  }, [tasks, loading, isWidgetMode, aiConfig])

  // 卸载时清除防抖定时器
  useEffect(() => {
    return () => {
      titleChangeTimersRef.current.forEach(timer => clearTimeout(timer))
    }
  }, [])

  // hover ▶ 按钮时预加载
  const handlePrefetchTask = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const subtaskTitle = (task.subtasks ?? []).find(s => !s.completed)?.title
    aiCache.prefetch(task.id, task.title, aiConfig, subtaskTitle)
  }, [tasks, aiConfig])

  return { handlePrefetchTask }
}
