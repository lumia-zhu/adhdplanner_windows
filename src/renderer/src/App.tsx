import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers'
import type { Task } from './types'
import TitleBar from './components/TitleBar'
import AddTask from './components/AddTask'
import TaskItem from './components/TaskItem'
import WidgetView from './components/WidgetView'

/**
 * 主应用组件
 * 负责：任务状态管理、数据加载/保存、拖拽排序、小组件模式切换
 */
export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showCompleted, setShowCompleted] = useState(true)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [isWidgetMode, setIsWidgetMode] = useState(false)       // 是否处于小组件模式
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null) // 专注模式：只显示这个任务

  // -------- 数据加载 --------
  useEffect(() => {
    const loadData = async () => {
      try {
        const savedTasks = await window.electronAPI.loadTasks()
        setTasks(savedTasks as Task[])
      } catch (e) {
        console.error('加载任务失败:', e)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // -------- 监听托盘菜单触发的模式切换 --------
  useEffect(() => {
    // 托盘点击"切换小组件"→ 通知前端进入小组件 UI
    window.electronAPI.onWidgetEnter(() => setIsWidgetMode(true))
    // 托盘点击"退出小组件"→ 通知前端恢复主界面 UI
    window.electronAPI.onWidgetExit(() => setIsWidgetMode(false))
  }, [])

  // -------- 数据自动保存 + 托盘数量同步 --------
  const saveTasks = useCallback(async (newTasks: Task[]) => {
    try {
      await window.electronAPI.saveTasks(newTasks)
    } catch (e) {
      console.error('保存任务失败:', e)
    }
  }, [])

  useEffect(() => {
    if (!loading) {
      saveTasks(tasks)
      // 同步待办数量到托盘悬停提示
      const count = tasks.filter(t => !t.completed).length
      window.electronAPI.updateTrayCount(count)
    }
  }, [tasks, loading, saveTasks])

  // -------- 拖拽传感器配置 --------
  // activationConstraint: 至少拖动 5px 才触发，防止误触
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  )

  /** 拖动开始：记录当前拖动的任务（用于 DragOverlay 预览） */
  const handleDragStart = (event: DragStartEvent) => {
    const draggedTask = tasks.find(t => t.id === event.active.id)
    setActiveTask(draggedTask ?? null)
  }

  /**
   * 拖动结束：计算新的排列顺序
   * active = 被拖动的任务；over = 松手时所在位置的任务
   */
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)

    if (!over || active.id === over.id) return // 没有位置变化，不处理

    setTasks(prev => {
      const oldIndex = prev.findIndex(t => t.id === active.id)
      const newIndex = prev.findIndex(t => t.id === over.id)
      // arrayMove 是 dnd-kit 提供的工具函数，用来移动数组元素
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  // -------- 任务操作 --------
  const handleAddTask = (newTask: Task) => {
    setTasks(prev => [newTask, ...prev])
  }

  const handleToggleTask = (id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t
      const nowCompleted = !t.completed
      // 取消勾选父任务时，同步把所有子任务也重置为未完成
      if (!nowCompleted && t.subtasks?.length) {
        return { ...t, completed: false, subtasks: t.subtasks.map(s => ({ ...s, completed: false })) }
      }
      return { ...t, completed: nowCompleted }
    }))
  }

  /**
   * 勾选/取消某个子任务
   * 规则：子任务全部完成 → 父任务自动完成（并触发庆祝特效在 TaskItem 里触发）
   */
  const handleToggleSubtask = (taskId: string, subtaskId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const updatedSubtasks = (t.subtasks ?? []).map(s =>
        s.id === subtaskId ? { ...s, completed: !s.completed } : s
      )
      // 检查是否所有子任务都完成了
      const allDone = updatedSubtasks.length > 0 && updatedSubtasks.every(s => s.completed)
      return { ...t, subtasks: updatedSubtasks, completed: allDone ? true : t.completed }
    }))
  }

  const handleEditTask = (updatedTask: Task) => {
    setTasks(prev => prev.map(t =>
      t.id === updatedTask.id ? updatedTask : t
    ))
  }

  const handleDeleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const handleClearCompleted = () => {
    setTasks(prev => prev.filter(t => !t.completed))
  }

  // -------- 小组件模式切换 --------

  /** 进入小组件模式：通知主进程缩小窗口并置顶 */
  const handleEnterWidget = () => {
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }

  /** 退出小组件模式：通知主进程恢复窗口，同时清除专注任务 */
  const handleExitWidget = () => {
    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setFocusTaskId(null)
  }

  /**
   * 专注某个任务：进入小组件模式，并只显示这一个任务
   * 就像"全屏播放"一样，让你专心做完这一件事
   */
  const handleFocusTask = (id: string) => {
    setFocusTaskId(id)
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }

  // -------- 数据分组 --------
  const pendingTasks = tasks.filter(t => !t.completed)
  const completedTasks = tasks.filter(t => t.completed)

  // -------- 加载中 --------
  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-white">
        <div className="h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">加载中...</p>
          </div>
        </div>
      </div>
    )
  }

  // -------- 小组件模式：渲染细长条 UI --------
  if (isWidgetMode) {
    return (
      <div className="w-full h-full bg-white overflow-hidden">
        <WidgetView
          tasks={tasks}
          focusTaskId={focusTaskId}
          onToggle={handleToggleTask}
          onExit={handleExitWidget}
        />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <TitleBar taskCount={pendingTasks.length} onEnterWidget={handleEnterWidget} />

      <div className="flex-1 overflow-y-auto">
        <div className="bg-white mb-2">
          <AddTask onAdd={handleAddTask} />
        </div>

        <div className="px-4 pb-4 space-y-4">
          {/* 空状态提示 */}
          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              </div>
              <p className="text-gray-500 font-medium">还没有任务</p>
              <p className="text-gray-400 text-sm mt-1">点击上方输入框添加你的第一个任务吧！</p>
            </div>
          )}

          {/*
           * DndContext：拖拽功能的"总指挥"，包裹所有可拖拽的内容
           * sensors：指定用什么输入方式触发拖拽（鼠标/触摸）
           * collisionDetection：检测拖动时与哪个目标重叠（closestCenter = 最近中心点）
           * modifiers：限制只能在垂直方向拖动
           */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* 待办任务组 */}
            {pendingTasks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">待办</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                    {pendingTasks.length}
                  </span>
                </div>
                {/*
                 * SortableContext：告诉 dnd-kit 这一组任务的 ID 顺序
                 * verticalListSortingStrategy：垂直列表排序策略
                 */}
                <SortableContext
                  items={pendingTasks.map(t => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-1.5">
                    {pendingTasks.map(task => (
                      <TaskItem
                        key={task.id}
                        task={task}
                        onToggle={handleToggleTask}
                        onToggleSubtask={handleToggleSubtask}
                        onEdit={handleEditTask}
                        onDelete={handleDeleteTask}
                        onFocus={handleFocusTask}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            )}

            {/* 已完成任务组 */}
            {completedTasks.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => setShowCompleted(!showCompleted)}
                    className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform ${showCompleted ? '' : '-rotate-90'}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    已完成
                    <span className="text-xs text-gray-300 bg-gray-100 px-1.5 py-0.5 rounded-full normal-case">
                      {completedTasks.length}
                    </span>
                  </button>
                  <button
                    onClick={handleClearCompleted}
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                  >
                    清除全部
                  </button>
                </div>

                {showCompleted && (
                  <SortableContext
                    items={completedTasks.map(t => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1.5">
                      {completedTasks.map(task => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          onToggle={handleToggleTask}
                          onToggleSubtask={handleToggleSubtask}
                          onEdit={handleEditTask}
                          onDelete={handleDeleteTask}
                          onFocus={handleFocusTask}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </div>
            )}

            {/*
             * DragOverlay：拖动时跟随鼠标的"影子卡片"
             * 让拖动体验更直观，用户能看到自己在拖什么
             */}
            <DragOverlay>
              {activeTask ? (
                <div className="flex items-center gap-2 bg-white rounded-xl border-2 border-indigo-300 shadow-xl px-2 py-2.5 opacity-95">
                  <div className="text-indigo-300 flex-shrink-0">
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" />
                      <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
                      <circle cx="5" cy="12" r="1.5" /><circle cx="11" cy="12" r="1.5" />
                    </svg>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    activeTask.completed ? 'bg-green-500 border-green-500' : 'border-gray-300'
                  }`}>
                    {activeTask.completed && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm font-medium flex-1 truncate ${activeTask.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {activeTask.title}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* 底部状态栏 */}
      {tasks.length > 0 && (
        <div className="border-t border-gray-100 bg-white px-4 py-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            共 {tasks.length} 个任务，{pendingTasks.length} 个待完成
          </span>
          {completedTasks.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-20">
                <div
                  className="h-full bg-green-400 rounded-full transition-all duration-500"
                  style={{ width: `${(completedTasks.length / tasks.length) * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">
                {Math.round((completedTasks.length / tasks.length) * 100)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
