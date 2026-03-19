/**
 * StandbyWidget —— 常驻待命入口
 *
 * 在没有正在执行的任务时，以置顶小条形式常驻桌面。
 * 核心能力：显示当前任务名 + 开始/继续 + 切换任务 + 展开主界面。
 *
 * 窗口尺寸：
 *   收起状态 → 380×80
 *   切换面板展开 → 380×(80 + 面板高度)
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import type { Task } from '../types'

const BAR_W = 380
const BAR_H = 80
const PANEL_MAX_H = 200
const TASK_ROW_H = 40
const PANEL_FOOTER_H = 36

interface StandbyWidgetProps {
  tasks: Task[]
  onFocusTask: (id: string) => void
  onResumePaused: (taskId: string) => void
  onExpand: () => void
}

/**
 * 从今天的任务列表中选出默认任务：
 * 1. 优先选有 pausedSession 的（最近暂停的）
 * 2. 否则选第一个未完成任务
 */
function pickDefaultTask(tasks: Task[]): Task | null {
  const paused = tasks.find(t => !t.completed && t.pausedSession)
  if (paused) return paused
  return tasks.find(t => !t.completed) ?? null
}

export default function StandbyWidget({
  tasks, onFocusTask, onResumePaused, onExpand,
}: StandbyWidgetProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const incompleteTasks = useMemo(
    () => {
      const paused: Task[] = []
      const rest: Task[] = []
      for (const t of tasks) {
        if (t.completed) continue
        if (t.pausedSession) paused.push(t)
        else rest.push(t)
      }
      return [...paused, ...rest]
    },
    [tasks],
  )

  const defaultTask = useMemo(() => pickDefaultTask(tasks), [tasks])
  const isPaused = !!defaultTask?.pausedSession

  // 面板高度根据任务数量自适应，不超过最大值
  const panelContentH = Math.min(
    incompleteTasks.length * TASK_ROW_H + PANEL_FOOTER_H,
    PANEL_MAX_H,
  )
  const totalH = panelOpen ? BAR_H + panelContentH : BAR_H

  // 通知主进程调整窗口大小
  useEffect(() => {
    window.electronAPI.resizeWidget(BAR_W, totalH)
  }, [totalH])

  // 点击面板外部关闭
  useEffect(() => {
    if (!panelOpen) return
    const handle = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setPanelOpen(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [panelOpen])

  const handleStart = (task: Task) => {
    setPanelOpen(false)
    if (task.pausedSession) {
      onResumePaused(task.id)
    } else {
      onFocusTask(task.id)
    }
  }

  // -------- 状态 C：没有任务 --------
  if (!defaultTask) {
    return (
      <div className="w-full h-full flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden select-none">
        <div className="drag-region flex-1 flex items-center justify-between px-4">
          <span className="text-sm text-gray-400">还没有任务</span>
          <button
            onClick={onExpand}
            className="no-drag px-3 py-1.5 text-xs text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
          >
            展开
          </button>
        </div>
      </div>
    )
  }

  // -------- 状态 A/B：有任务 --------
  return (
    <div className="w-full h-full flex flex-col bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden select-none">

      {/* ---- 主区域：任务名 + 按钮 ---- */}
      <div className="drag-region flex items-center gap-3 px-4" style={{ height: BAR_H }}>

        {/* 任务名 */}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-gray-800 truncate">
            {defaultTask.title}
          </div>
          {isPaused && (
            <div className="text-[11px] text-gray-400 truncate mt-0.5">
              上次停在：{defaultTask.pausedSession?.currentMicroTask}
            </div>
          )}
        </div>

        {/* 切换按钮 */}
        {incompleteTasks.length > 1 && (
          <button
            ref={btnRef}
            onClick={() => setPanelOpen(v => !v)}
            className={`no-drag flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg transition-colors font-medium ${
              panelOpen
                ? 'bg-gray-100 text-gray-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
            title="切换任务"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" />
            </svg>
            切换
          </button>
        )}

        {/* 主按钮：开始 / 继续 */}
        <button
          onClick={() => handleStart(defaultTask)}
          className={`no-drag flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-white text-xs font-semibold transition-all active:scale-95 shadow-sm ${
            isPaused
              ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-200/50'
              : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-200/50'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          {isPaused ? '继续' : '开始'}
        </button>

        {/* 展开按钮 */}
        <button
          onClick={onExpand}
          className="no-drag w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="展开主界面"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      {/* ---- 切换面板 ---- */}
      {panelOpen && (
        <div
          ref={panelRef}
          className="border-t border-gray-100 flex flex-col"
          style={{ maxHeight: PANEL_MAX_H }}
        >
          {/* 任务列表（可滚动） */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {incompleteTasks.map(task => {
              const taskIsPaused = !!task.pausedSession
              const isDefault = task.id === defaultTask.id
              return (
                <div
                  key={task.id}
                  className={`flex items-center gap-2 px-4 hover:bg-gray-50 transition-colors ${
                    isDefault ? 'bg-indigo-50/50' : ''
                  }`}
                  style={{ height: TASK_ROW_H }}
                >
                  {/* 当前任务标记 */}
                  {isDefault && (
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                  )}

                  {/* 任务名 */}
                  <span className={`flex-1 text-xs truncate ${
                    isDefault ? 'text-indigo-700 font-medium' : 'text-gray-700'
                  }`}>
                    {task.title}
                  </span>

                  {/* 开始/继续按钮 */}
                  <button
                    onClick={() => handleStart(task)}
                    className={`flex-shrink-0 px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors ${
                      taskIsPaused
                        ? 'text-amber-600 hover:bg-amber-50'
                        : 'text-indigo-600 hover:bg-indigo-50'
                    }`}
                  >
                    {taskIsPaused ? '继续' : '开始'}
                  </button>
                </div>
              )
            })}
          </div>

          {/* 底部固定：展开完整界面 */}
          <div
            className="flex-shrink-0 border-t border-gray-100 flex items-center justify-center"
            style={{ height: PANEL_FOOTER_H }}
          >
            <button
              onClick={() => { setPanelOpen(false); onExpand() }}
              className="text-[11px] text-gray-400 hover:text-indigo-500 transition-colors"
            >
              打开完整界面
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
