import { useState, useEffect, useCallback, useRef } from 'react'
import type { Task } from './types'
import type { AIConfig } from './services/ai'
import { DEFAULT_AI_CONFIG } from './services/ai'
import type { FocusSession } from './components/WidgetView'
import { tracker } from './services/tracker'
import TitleBar from './components/TitleBar'
import NoteEditor from './components/NoteEditor'
import WidgetView from './components/WidgetView'
import FocusFlow from './components/FocusFlow'
import AISettings from './components/AISettings'
import ReflectionView from './components/ReflectionView'

/**
 * 主应用组件
 *
 * 核心流程：
 *   1. 用户点击任务的播放按钮或底部「开启任务」→ 弹出 FocusFlow 覆盖层
 *   2. 用户确认微任务 → 创建 FocusSession，进入 WidgetView（Dynamic Bar）
 *   3. 执行 → 完成 → 接力输入 → 循环 / 进入心流
 *   4. 心流完成 → 任务标记完成 → 退出小组件
 */
export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [isWidgetMode, setIsWidgetMode] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)

  // -------- 专注力流程状态 --------
  /** 当前正在进行 FocusFlow 覆盖层（阶段1）的任务 */
  const [scaffoldTaskId, setScaffoldTaskId] = useState<string | null>(null)
  /** 当前执行中的专注会话（阶段2），null = 旧的普通小组件 */
  const [session, setSession] = useState<FocusSession | null>(null)

  // -------- AI 配置 --------
  const [aiConfig, setAIConfig] = useState<AIConfig>({ ...DEFAULT_AI_CONFIG })
  const [showAISettings, setShowAISettings] = useState(false)

  // -------- 每日反思 --------
  const [showReflection, setShowReflection] = useState(false)

  // -------- 会话 ID（用于关联同一次专注的所有事件）--------
  const sessionIdRef = useRef<string>('')

  // -------- 初始化追踪器 --------
  useEffect(() => {
    tracker.init()
    return () => tracker.destroy()
  }, [])

  // -------- 数据加载 --------
  useEffect(() => {
    const loadData = async () => {
      try {
        const [savedTasks, savedConfig] = await Promise.all([
          window.electronAPI.loadTasks(),
          window.electronAPI.loadAIConfig(),
        ])
        setTasks(savedTasks as Task[])
        if (savedConfig && savedConfig.apiKey) {
          setAIConfig({
            apiUrl: savedConfig.apiUrl || DEFAULT_AI_CONFIG.apiUrl,
            apiKey: savedConfig.apiKey || '',
            modelId: savedConfig.modelId || '',
          })
        }
      } catch (e) {
        console.error('加载数据失败:', e)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // -------- 监听托盘菜单触发的模式切换 --------
  useEffect(() => {
    window.electronAPI.onWidgetEnter(() => setIsWidgetMode(true))
    window.electronAPI.onWidgetExit(() => {
      setIsWidgetMode(false)
      setSession(null)
    })
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
      const count = tasks.filter(t => !t.completed).length
      window.electronAPI.updateTrayCount(count)
    }
  }, [tasks, loading, saveTasks])

  // -------- AI 配置保存 --------
  const handleSaveAIConfig = async (cfg: AIConfig) => {
    setAIConfig(cfg)
    try {
      await window.electronAPI.saveAIConfig(cfg as unknown as Record<string, string>)
    } catch (e) {
      console.error('保存AI配置失败:', e)
    }
  }

  // ===================== 小组件 / 专注模式 =====================

  /** 退出小组件 */
  const handleExitWidget = () => {
    // 📊 埋点：如果有正在进行的会话，记录放弃/结束
    if (session && session.phase === 'executing') {
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000)
      tracker.track('abandon.exit', {
        sessionId: sessionIdRef.current,
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        microAction: session.currentMicroTask,
        elapsedSeconds: elapsed,
        phase: session.phase,
      })
    }
    if (session) {
      const sessionStart = session.microHistory.length > 0
        ? session.startTime
        : Date.now()
      tracker.track('session.ended', {
        sessionId: sessionIdRef.current,
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        totalDurationSeconds: Math.floor((Date.now() - sessionStart) / 1000),
        completedMicroSteps: session.microHistory.length,
        endReason: 'exit',
      })
    }

    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setFocusTaskId(null)
    setSession(null)
  }

  /**
   * 用户点击任务的「▶」按钮或底部「开启任务」
   * → 弹出 FocusFlow 覆盖层（阶段1）
   */
  const handleFocusTask = (id: string) => {
    setScaffoldTaskId(id)

    // 📊 埋点：记录选中的焦点任务
    const task = tasks.find(t => t.id === id)
    if (task) {
      // 记录脑暴池（当前所有待办任务的快照）
      const pendingSnap = tasks.filter(t => !t.completed)
      tracker.track('plan.brain_dump', {
        tasks: pendingSnap.map(t => ({ id: t.id, title: t.title })),
        taskCount: pendingSnap.length,
      })
      tracker.track('plan.focus_selected', {
        taskId: task.id,
        taskTitle: task.title,
        taskNote: task.note || undefined,
      })
    }
  }

  /**
   * FocusFlow 阶段1 确认微任务 → 进入执行（阶段2）
   */
  const handleStartMicro = (microTask: string, source: 'self' | 'ai_chip') => {
    const task = tasks.find(t => t.id === scaffoldTaskId)
    if (!task) return
    setScaffoldTaskId(null)

    // 生成会话 ID
    const sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    sessionIdRef.current = sid

    // 子任务导航：找到第一个未完成的子任务
    const subtasks = task.subtasks ?? []
    const activeSubtask = subtasks.find(s => !s.completed) ?? null

    // 创建 FocusSession
    const newSession: FocusSession = {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
      currentMicroTask: microTask,
      startTime: Date.now(),
      isFlowMode: false,
      phase: 'executing',
      microHistory: [],
      // 子任务信息
      currentSubtaskId: activeSubtask?.id,
      currentSubtaskTitle: activeSubtask?.title,
    }
    setSession(newSession)
    setFocusTaskId(task.id)

    // 📊 埋点：破冰第一步 + 会话开始 + 微任务开始
    tracker.track('plan.first_micro', {
      taskId: task.id,
      taskTitle: task.title,
      microAction: microTask,
      source,
    })
    tracker.track('session.started', {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
    })
    tracker.track('exec.micro_started', {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
      microAction: microTask,
    })

    // 进入小组件模式
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }

  /** 微任务完成 → 进入 relay 阶段 */
  const handleMicroComplete = () => {
    if (!session) return

    // 📊 埋点：微任务完成
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000)
    tracker.track('exec.micro_completed', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      microAction: session.currentMicroTask,
      actualSeconds: elapsed,
    })

    setSession(s => s ? {
      ...s,
      phase: 'relay',
      microHistory: [...s.microHistory, s.currentMicroTask],
    } : s)
  }

  /** 接力：继续下一个微任务 */
  const handleNextMicro = (micro: string) => {
    if (!session) return

    // 📊 埋点：新微任务开始
    tracker.track('exec.micro_started', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      microAction: micro,
    })

    setSession(s => s ? {
      ...s,
      phase: 'executing',
      currentMicroTask: micro,
      startTime: Date.now(),
      isSubtaskTransition: false,  // 清除子任务过渡标记
      allSubtasksDone: false,
    } : s)
  }

  /** 🆘 卡住了 → 进入急救状态A */
  const handleStuck = () => {
    if (!session) return

    // 📊 埋点：卡住事件
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000)
    tracker.track('stuck.triggered', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      microAction: session.currentMicroTask,
      elapsedSeconds: elapsed,
    })

    setSession(s => s ? { ...s, phase: 'stuck_a' } : s)
  }

  /** 急救状态A → B：用户提交了卡点原因 */
  const handleStuckToB = () => {
    if (!session) return
    setSession(s => s ? { ...s, phase: 'stuck_b' } : s)
  }

  /** 急救完成 → 用新微任务重启执行（状态C） */
  const handleResume = (newMicro: string) => {
    if (!session) return

    // 📊 埋点：新微任务开始（急救后）
    tracker.track('exec.micro_started', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      microAction: newMicro,
    })

    setSession(s => s ? {
      ...s,
      phase: 'executing',
      currentMicroTask: newMicro,
      startTime: Date.now(),
    } : s)
  }

  /**
   * 当前子任务搞定 → 标记完成 → 自动切到下一个子任务
   */
  const handleSubtaskDone = () => {
    if (!session || !session.currentSubtaskId) return

    const completedSubId = session.currentSubtaskId
    const completedSubTitle = session.currentSubtaskTitle || ''

    // 📊 埋点：子任务完成
    tracker.track('exec.subtask_completed', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      subtaskId: completedSubId,
      subtaskTitle: completedSubTitle,
    })

    // 在 tasks 中标记子任务为已完成
    let nextSubtask: { id: string; title: string } | null = null
    setTasks(prev => prev.map(t => {
      if (t.id !== session.taskId) return t
      const updatedSubs = (t.subtasks ?? []).map(s =>
        s.id === completedSubId ? { ...s, completed: true } : s
      )
      // 找下一个未完成的子任务
      const next = updatedSubs.find(s => !s.completed)
      if (next) nextSubtask = { id: next.id, title: next.title }
      return { ...t, subtasks: updatedSubs }
    }))

    // 更新 session
    if (nextSubtask) {
      // 还有子任务 → 进入子任务过渡 relay
      setSession(s => s ? {
        ...s,
        phase: 'relay',
        currentSubtaskId: (nextSubtask as { id: string; title: string }).id,
        currentSubtaskTitle: (nextSubtask as { id: string; title: string }).title,
        isSubtaskTransition: true,
        allSubtasksDone: false,
        microHistory: [...s.microHistory, s.currentMicroTask],
      } : s)
    } else {
      // 所有子任务完成 → 显示完成选项
      setSession(s => s ? {
        ...s,
        phase: 'relay',
        currentSubtaskId: undefined,
        currentSubtaskTitle: undefined,
        isSubtaskTransition: false,
        allSubtasksDone: true,
        microHistory: [...s.microHistory, s.currentMicroTask],
      } : s)
    }
  }

  /** 进入心流模式 */
  const handleEnterFlow = () => {
    if (!session) return

    // 📊 埋点：进入心流
    tracker.track('exec.flow_entered', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      lastMicroAction: session.currentMicroTask,
      completedStepCount: session.microHistory.length,
    })

    setSession(s => s ? {
      ...s,
      phase: 'executing',
      isFlowMode: true,
      startTime: Date.now(),
      currentMicroTask: s.taskTitle, // 切回宏观任务名
    } : s)
  }

  /** 心流模式下完成整个任务 */
  const handleTaskDone = () => {
    if (!session) return

    // 📊 埋点：心流结束 + 宏观任务完成 + 会话结束
    const flowDuration = Math.floor((Date.now() - session.startTime) / 1000)
    tracker.track('exec.flow_ended', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      flowDurationSeconds: flowDuration,
      endReason: 'task_done',
    })
    tracker.track('session.macro_completed', {
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      completedVia: 'flow',
    })
    tracker.track('session.ended', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      totalDurationSeconds: flowDuration,
      completedMicroSteps: session.microHistory.length,
      endReason: 'task_done',
    })

    // 标记任务为已完成
    setTasks(prev => prev.map(t => {
      if (t.id !== session.taskId) return t
      return {
        ...t,
        completed: true,
        subtasks: t.subtasks?.map(s => ({ ...s, completed: true })),
      }
    }))

    // 退出小组件（不再重复记录退出事件）
    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setFocusTaskId(null)
    setSession(null)
  }

  /** 小组件模式下的任务勾选（旧版小组件用） */
  const handleWidgetToggle = (id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t
      const nowCompleted = !t.completed
      if (!nowCompleted && t.subtasks?.length) {
        return { ...t, completed: false, subtasks: t.subtasks.map(s => ({ ...s, completed: false })) }
      }
      return { ...t, completed: nowCompleted }
    }))
  }

  // -------- 清除已完成 --------
  const handleClearCompleted = () => {
    setTasks(prev => prev.filter(t => !t.completed))
  }

  // -------- 数据分组 --------
  const pendingTasks = tasks.filter(t => !t.completed)
  const completedTasks = tasks.filter(t => t.completed)

  // 找到 FocusFlow 需要的任务
  const scaffoldTask = scaffoldTaskId ? tasks.find(t => t.id === scaffoldTaskId) : null

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

  // -------- 小组件模式（包含旧版和新版 Dynamic Bar） --------
  if (isWidgetMode) {
    return (
      <div className="w-full h-full bg-white overflow-hidden">
        <WidgetView
          tasks={tasks}
          session={session}
          aiConfig={aiConfig}
          focusTaskId={focusTaskId}
          onToggle={handleWidgetToggle}
          onExit={handleExitWidget}
          onMicroComplete={handleMicroComplete}
          onNextMicro={handleNextMicro}
          onEnterFlow={handleEnterFlow}
          onTaskDone={handleTaskDone}
          onStuck={handleStuck}
          onStuckToB={handleStuckToB}
          onResume={handleResume}
          onSubtaskDone={handleSubtaskDone}
        />
      </div>
    )
  }

  // -------- 每日反思界面 --------
  if (showReflection) {
    return (
      <div className="h-screen bg-white overflow-hidden">
        <ReflectionView
          tasks={tasks}
          aiConfig={aiConfig}
          onClose={() => setShowReflection(false)}
        />
      </div>
    )
  }

  // -------- 主界面 --------
  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TitleBar
        taskCount={pendingTasks.length}
        onOpenAISettings={() => setShowAISettings(true)}
        onOpenReflection={() => setShowReflection(true)}
      />

      {/* 核心编辑区域 */}
      <NoteEditor tasks={tasks} setTasks={setTasks} onFocusTask={handleFocusTask} />

      {/* 底部区域 */}
      <div className="flex-shrink-0 select-none">
        {/* 开启任务按钮 */}
        {pendingTasks.length > 0 && (
          <div className="flex justify-center -mt-6 mb-2 relative z-10">
            <button
              onClick={() => handleFocusTask(pendingTasks[0].id)}
              className="flex items-center gap-2.5 px-8 py-3 rounded-full
                         bg-emerald-500 hover:bg-emerald-600 active:scale-95
                         text-white text-base font-semibold
                         shadow-lg shadow-emerald-200/70 hover:shadow-xl hover:shadow-emerald-300/70
                         transition-all duration-200"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              开启任务
            </button>
          </div>
        )}

        {/* 状态栏 */}
        {tasks.length > 0 && (
          <div className="px-5 py-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {tasks.length} 个任务 · {pendingTasks.length} 待完成
            </span>
            <div className="flex items-center gap-3">
              {completedTasks.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden w-16">
                      <div
                        className="h-full bg-emerald-400 rounded-full transition-all duration-500"
                        style={{ width: `${(completedTasks.length / tasks.length) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">
                      {Math.round((completedTasks.length / tasks.length) * 100)}%
                    </span>
                  </div>
                  <button
                    onClick={handleClearCompleted}
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                  >
                    清除已完成
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========== 覆盖层 ========== */}

      {/* FocusFlow 覆盖层（阶段1：元认知拦截） */}
      {scaffoldTask && (
        <FocusFlow
          task={scaffoldTask}
          aiConfig={aiConfig}
          onStart={handleStartMicro}
          onCancel={() => setScaffoldTaskId(null)}
        />
      )}

      {/* AI 设置面板 */}
      <AISettings
        visible={showAISettings}
        config={aiConfig}
        onSave={handleSaveAIConfig}
        onClose={() => setShowAISettings(false)}
      />
    </div>
  )
}
