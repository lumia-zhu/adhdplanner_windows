import { useState, useEffect, useRef, useCallback } from 'react'
import type { Task, PausedSession } from '../types'
import type { FocusSession } from '../components/WidgetView'
import { ENABLE_STEP_BY_STEP } from '../components/WidgetView'
import type { AIConfig } from '../services/ai'
import { tracker } from '../services/tracker'
import { aiCache } from '../services/ai-cache'
import { getToday } from './useDateNavigation'

interface UseFocusSessionParams {
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  aiConfig: AIConfig
  isWidgetMode: boolean
  setIsWidgetMode: (v: boolean) => void
  setIsStandbyMode: (v: boolean) => void
  loading: boolean
}

export function useFocusSession({
  tasks, setTasks, aiConfig,
  isWidgetMode, setIsWidgetMode, setIsStandbyMode,
  loading,
}: UseFocusSessionParams) {
  const [session, setSession] = useState<FocusSession | null>(null)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)
  const [scaffoldTaskId, setScaffoldTaskId] = useState<string | null>(null)
  const [quickFocusEnd, setQuickFocusEnd] = useState<{ durationSeconds: number } | null>(null)
  const sessionIdRef = useRef<string>('')

  // -------- session 持久化（睡眠唤醒 / HMR 重载后可恢复）--------
  const sessionInitialized = useRef(false)
  useEffect(() => {
    if (session) {
      sessionInitialized.current = true
      localStorage.setItem('focusSession', JSON.stringify(session))
      localStorage.setItem('focusSessionId', sessionIdRef.current)
    } else if (sessionInitialized.current) {
      localStorage.removeItem('focusSession')
      localStorage.removeItem('focusSessionId')
    }
  }, [session])

  // ===================== 待命 widget → 开始/继续 =====================

  const handleStandbyStartMicro = useCallback((taskId: string, microTask: string, source: 'self' | 'ai_chip' | 'skip') => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    sessionIdRef.current = sid

    const subtasks = task.subtasks ?? []
    const activeSubtask = subtasks.find(s => !s.completed) ?? null

    const now = Date.now()
    const newSession: FocusSession = {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
      currentMicroTask: microTask,
      startTime: now,
      sessionStartTime: now,
      isFlowMode: false,
      phase: 'executing',
      microHistory: [],
      firstStepHint: microTask,
      currentSubtaskId: activeSubtask?.id,
      currentSubtaskTitle: activeSubtask?.title,
    }
    setSession(newSession)
    setFocusTaskId(task.id)
    setIsStandbyMode(false)

    const pendingSnap = tasks.filter(t => !t.completed)
    tracker.track('plan.brain_dump', {
      tasks: pendingSnap.map(t => ({ id: t.id, title: t.title })),
      taskCount: pendingSnap.length,
    })
    tracker.track('plan.focus_selected', { taskId: task.id, taskTitle: task.title })
    tracker.track('plan.first_micro', { taskId: task.id, taskTitle: task.title, microAction: microTask, source })
    tracker.track('session.started', { sessionId: sid, taskId: task.id, taskTitle: task.title })
    tracker.track('exec.micro_started', { sessionId: sid, taskId: task.id, taskTitle: task.title, microAction: microTask })

    // 行为学习：记录第一步选择到 MemoryStore
    window.electronAPI.loadMemoryStore().then(raw => {
      const store = raw as any
      if (!store.firstSteps) store.firstSteps = []
      store.firstSteps.push({
        taskTitle: task.title, microAction: microTask,
        source, subtaskTitle: activeSubtask?.title, date: getToday(),
      })
      store.firstSteps = store.firstSteps.slice(-30)
      window.electronAPI.saveMemoryStore(store)
    }).catch(() => {})
  }, [tasks, setIsStandbyMode, setTasks]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStandbyResume = useCallback((taskId: string) => {
    setIsStandbyMode(false)
    handleResumePaused(taskId)
  }, [tasks, setIsStandbyMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ===================== 退出小组件 =====================

  const handleExitWidget = useCallback(() => {
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
      const segDur = Math.floor((Date.now() - session.sessionStartTime) / 1000)
      tracker.track('session.ended', {
        sessionId: sessionIdRef.current,
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        totalDurationSeconds: segDur + (session.elapsedOffset || 0),
        completedMicroSteps: session.microHistory.length,
        endReason: 'exit',
      })
    }
    setFocusTaskId(null)
    setSession(null)
    setIsStandbyMode(true)
  }, [session, setIsStandbyMode])

  // ===================== 创建任务并聚焦 =====================

  const handleCreateAndFocus = useCallback((title: string) => {
    const newId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newTask: Task = {
      id: newId,
      title,
      note: '',
      priority: 'medium',
      completed: false,
      createdAt: Date.now(),
    }
    setTasks(prev => [...prev, newTask])
    setScaffoldTaskId(newId)

    if (aiConfig.apiKey) {
      aiCache.prefetch(newId, title, aiConfig)
    }

    const pendingSnap = [...tasks.filter(t => !t.completed), newTask]
    tracker.track('plan.brain_dump', {
      tasks: pendingSnap.map(t => ({ id: t.id, title: t.title })),
      taskCount: pendingSnap.length,
    })
    tracker.track('plan.focus_selected', { taskId: newId, taskTitle: title })
  }, [tasks, aiConfig, setTasks])

  // ===================== 聚焦已有任务 =====================

  const handleFocusTask = useCallback((id: string) => {
    setScaffoldTaskId(id)
    const task = tasks.find(t => t.id === id)
    if (task) {
      const pendingSnap = tasks.filter(t => !t.completed)
      tracker.track('plan.brain_dump', {
        tasks: pendingSnap.map(t => ({ id: t.id, title: t.title })),
        taskCount: pendingSnap.length,
      })
      tracker.track('plan.focus_selected', { taskId: task.id, taskTitle: task.title, taskNote: task.note || undefined })
    }
  }, [tasks])

  // ===================== FocusFlow 确认微任务 → 进入执行 =====================

  const handleStartMicro = useCallback((microTask: string, source: 'self' | 'ai_chip' | 'skip', understandingContext?: string) => {
    const task = tasks.find(t => t.id === scaffoldTaskId)
    if (!task) return
    setScaffoldTaskId(null)

    const sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    sessionIdRef.current = sid

    const subtasks = task.subtasks ?? []
    const activeSubtask = subtasks.find(s => !s.completed) ?? null

    const now = Date.now()
    const newSession: FocusSession = {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
      currentMicroTask: microTask,
      startTime: now,
      sessionStartTime: now,
      isFlowMode: false,
      phase: 'executing',
      microHistory: [],
      firstStepHint: microTask,
      currentSubtaskId: activeSubtask?.id,
      currentSubtaskTitle: activeSubtask?.title,
    }
    setSession(newSession)
    setFocusTaskId(task.id)

    if (understandingContext) {
      tracker.track('plan.task_understanding', { taskId: task.id, taskTitle: task.title, understandingContext })
    }
    tracker.track('plan.first_micro', { taskId: task.id, taskTitle: task.title, microAction: microTask, source })
    tracker.track('session.started', { sessionId: sid, taskId: task.id, taskTitle: task.title })
    tracker.track('exec.micro_started', { sessionId: sid, taskId: task.id, taskTitle: task.title, microAction: microTask })

    // 行为学习：记录第一步选择到 MemoryStore
    window.electronAPI.loadMemoryStore().then(raw => {
      const store = raw as any
      if (!store.firstSteps) store.firstSteps = []
      store.firstSteps.push({
        taskTitle: task.title, microAction: microTask,
        source, subtaskTitle: activeSubtask?.title, date: getToday(),
      })
      store.firstSteps = store.firstSteps.slice(-30)
      window.electronAPI.saveMemoryStore(store)
    }).catch(() => {})

    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }, [tasks, scaffoldTaskId, setIsWidgetMode, setTasks]) // eslint-disable-line react-hooks/exhaustive-deps

  // ===================== 微任务完成 → relay =====================

  const handleMicroComplete = useCallback(() => {
    if (!session) return
    const segmentElapsed = Math.floor((Date.now() - session.startTime) / 1000)
    const totalElapsed = segmentElapsed + (session.elapsedOffset || 0)
    tracker.track('exec.micro_completed', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      microAction: session.currentMicroTask,
      actualSeconds: totalElapsed,
    })

    if (!ENABLE_STEP_BY_STEP) {
      setSession(s => s ? {
        ...s, phase: 'executing', isFlowMode: true,
        currentMicroTask: s.taskTitle,
        microHistory: [...s.microHistory, s.currentMicroTask],
        startTime: Date.now(), firstStepHint: undefined,
      } : s)
      return
    }
    setSession(s => s ? { ...s, phase: 'relay', microHistory: [...s.microHistory, s.currentMicroTask] } : s)
  }, [session])

  // ===================== 接力：下一个微任务 =====================

  const handleNextMicro = useCallback((micro: string) => {
    if (!session) return
    tracker.track('exec.micro_started', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, microAction: micro,
    })
    setSession(s => s ? {
      ...s, phase: 'executing', currentMicroTask: micro,
      startTime: Date.now(), isSubtaskTransition: false, allSubtasksDone: false,
    } : s)
  }, [session])

  // ===================== 卡住了 =====================

  const handleStuck = useCallback(() => {
    if (!session) return
    const elapsed = Math.floor((Date.now() - session.sessionStartTime) / 1000)
    tracker.track('stuck.triggered', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      microAction: session.currentMicroTask, elapsedSeconds: elapsed,
    })
    setSession(s => s ? { ...s, phase: 'stuck_a' } : s)
  }, [session])

  const handleStuckToB = useCallback(() => {
    setSession(s => s ? { ...s, phase: 'stuck_b' } : s)
  }, [])

  const handleResume = useCallback((newMicro: string) => {
    if (!session) return
    tracker.track('exec.micro_started', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, microAction: newMicro,
    })
    setSession(s => s ? { ...s, phase: 'executing', currentMicroTask: newMicro, startTime: Date.now() } : s)
  }, [session])

  // ===================== 子任务完成 =====================

  const handleSubtaskDone = useCallback(() => {
    if (!session || !session.currentSubtaskId) return

    const completedSubId = session.currentSubtaskId
    const completedSubTitle = session.currentSubtaskTitle || ''

    tracker.track('exec.subtask_completed', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, subtaskId: completedSubId, subtaskTitle: completedSubTitle,
    })

    let nextSubtask: { id: string; title: string } | null = null
    setTasks(prev => prev.map(t => {
      if (t.id !== session.taskId) return t
      const updatedSubs = (t.subtasks ?? []).map(s =>
        s.id === completedSubId ? { ...s, completed: true } : s
      )
      const next = updatedSubs.find(s => !s.completed)
      if (next) nextSubtask = { id: next.id, title: next.title }
      return { ...t, subtasks: updatedSubs }
    }))

    if (nextSubtask) {
      setSession(s => s ? {
        ...s, phase: 'relay',
        currentSubtaskId: (nextSubtask as { id: string; title: string }).id,
        currentSubtaskTitle: (nextSubtask as { id: string; title: string }).title,
        isSubtaskTransition: true, allSubtasksDone: false,
        microHistory: [...s.microHistory, s.currentMicroTask],
      } : s)
    } else {
      setSession(s => s ? {
        ...s, phase: 'relay',
        currentSubtaskId: undefined, currentSubtaskTitle: undefined,
        isSubtaskTransition: false, allSubtasksDone: true,
        microHistory: [...s.microHistory, s.currentMicroTask],
      } : s)
    }
  }, [session, setTasks])

  // ===================== 进入心流 =====================

  const handleEnterFlow = useCallback(() => {
    if (!session) return
    tracker.track('exec.flow_entered', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, lastMicroAction: session.currentMicroTask,
      completedStepCount: session.microHistory.length,
    })
    setSession(s => s ? {
      ...s, phase: 'executing', isFlowMode: true,
      startTime: Date.now(), currentMicroTask: s.taskTitle,
    } : s)
  }, [session])

  // ===================== 任务完成 =====================

  const handleQuickFocusEnd = useCallback(() => {
    if (!session || !session.isQuickFocus) return
    const duration = Math.floor((Date.now() - session.sessionStartTime) / 1000)
    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setSession(null)
    setQuickFocusEnd({ durationSeconds: duration })
  }, [session, setIsWidgetMode])

  const handleTaskDone = useCallback(() => {
    if (!session) return
    if (session.isQuickFocus) {
      handleQuickFocusEnd()
      return
    }

    const flowDuration = Math.floor((Date.now() - session.startTime) / 1000)
    const segmentDuration = Math.floor((Date.now() - session.sessionStartTime) / 1000)
    const totalDuration = segmentDuration + (session.elapsedOffset || 0)
    tracker.track('exec.flow_ended', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, flowDurationSeconds: flowDuration, endReason: 'task_done',
    })
    tracker.track('session.macro_completed', {
      taskId: session.taskId, taskTitle: session.taskTitle, completedVia: 'flow',
    })
    tracker.track('session.ended', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, totalDurationSeconds: totalDuration,
      completedMicroSteps: session.microHistory.length, endReason: 'task_done',
    })

    setTasks(prev => prev.map(t => {
      if (t.id !== session.taskId) return t
      return { ...t, completed: true, subtasks: t.subtasks?.map(s => ({ ...s, completed: true })) }
    }))
    setFocusTaskId(null)
    setSession(null)
    setIsStandbyMode(true)
  }, [session, setTasks, setIsStandbyMode, handleQuickFocusEnd])

  // ===================== Widget 子任务勾选 =====================

  const handleWidgetSubtaskToggle = useCallback((subtaskId: string) => {
    if (!session) return

    const parentTask = tasks.find(t => t.id === session.taskId)
    const sub = (parentTask?.subtasks ?? []).find(s => s.id === subtaskId)
    if (parentTask && sub) {
      tracker.track('task.subtask_toggled', {
        taskId: parentTask.id, subtaskId: sub.id, subtaskTitle: sub.title, completed: !sub.completed,
      })
    }

    let allDone = false
    setTasks(prev => prev.map(t => {
      if (t.id !== session.taskId) return t
      const updatedSubs = (t.subtasks ?? []).map(s =>
        s.id === subtaskId ? { ...s, completed: !s.completed } : s
      )
      allDone = updatedSubs.length > 0 && updatedSubs.every(s => s.completed)
      return { ...t, subtasks: updatedSubs }
    }))

    if (allDone) {
      setTimeout(() => {
        const segDur = Math.floor((Date.now() - session.sessionStartTime) / 1000)
        const totalDur = segDur + (session.elapsedOffset || 0)
        tracker.track('session.macro_completed', {
          taskId: session.taskId, taskTitle: session.taskTitle, completedVia: 'subtasks_all_done',
        })
        tracker.track('session.ended', {
          sessionId: sessionIdRef.current, taskId: session.taskId,
          taskTitle: session.taskTitle, totalDurationSeconds: totalDur,
          completedMicroSteps: session.microHistory.length, endReason: 'task_done',
        })
        setTasks(prev => prev.map(t =>
          t.id === session.taskId ? { ...t, completed: true } : t,
        ))
        setFocusTaskId(null)
        setSession(null)
        setIsStandbyMode(true)
      }, 400)
    }
  }, [session, setTasks, setIsStandbyMode])

  // ===================== 暂停 =====================

  const handlePause = useCallback(() => {
    if (!session) return

    const segmentDuration = Math.floor((Date.now() - session.sessionStartTime) / 1000)
    const totalDisplayed = segmentDuration + (session.elapsedOffset || 0)

    const snapshot: PausedSession = {
      sessionId: session.sessionId,
      currentMicroTask: session.currentMicroTask,
      microHistory: [...session.microHistory],
      isFlowMode: session.isFlowMode,
      firstStepHint: session.firstStepHint,
      currentSubtaskId: session.currentSubtaskId,
      currentSubtaskTitle: session.currentSubtaskTitle,
      pausedAt: Date.now(),
      elapsedBeforePause: totalDisplayed,
    }

    tracker.track('session.paused', {
      sessionId: sessionIdRef.current, taskId: session.taskId,
      taskTitle: session.taskTitle, microAction: session.currentMicroTask,
      elapsedSeconds: totalDisplayed, completedMicroSteps: session.microHistory.length,
    })

    setTasks(prev => prev.map(t =>
      t.id === session.taskId ? { ...t, pausedSession: snapshot } : t,
    ))
    setFocusTaskId(null)
    setSession(null)
    setIsStandbyMode(true)
  }, [session, setTasks, setIsStandbyMode])

  // ===================== 恢复暂停 =====================

  // eslint-disable-next-line react-hooks/exhaustive-deps
  function handleResumePaused(taskId: string) {
    const task = tasks.find(t => t.id === taskId)
    if (!task || !task.pausedSession) return

    const snap = task.pausedSession
    const sid = snap.sessionId
    sessionIdRef.current = sid

    const now = Date.now()
    const restored: FocusSession = {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
      currentMicroTask: snap.currentMicroTask,
      startTime: now,
      sessionStartTime: now,
      isFlowMode: snap.isFlowMode ?? true,
      phase: 'executing',
      microHistory: [...snap.microHistory],
      firstStepHint: snap.firstStepHint,
      currentSubtaskId: snap.currentSubtaskId,
      currentSubtaskTitle: snap.currentSubtaskTitle,
      elapsedOffset: snap.elapsedBeforePause,
    }

    tracker.track('session.resumed', {
      sessionId: sid, originalSessionId: snap.sessionId,
      taskId: task.id, taskTitle: task.title, microAction: snap.currentMicroTask,
      pausedDurationSeconds: Math.floor((Date.now() - snap.pausedAt) / 1000),
      elapsedBeforePause: snap.elapsedBeforePause,
      completedMicroSteps: snap.microHistory.length,
    })

    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, pausedSession: null } : t,
    ))
    setSession(restored)
    setFocusTaskId(task.id)

    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }

  // ===================== 快速专注 =====================

  const handleQuickFocus = useCallback(() => {
    const sid = `qf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    sessionIdRef.current = sid

    const now = Date.now()
    const newSession: FocusSession = {
      sessionId: sid,
      taskId: '',
      taskTitle: '',
      currentMicroTask: '',
      startTime: now,
      sessionStartTime: now,
      isFlowMode: false,
      phase: 'executing',
      microHistory: [],
      isQuickFocus: true,
    }
    setSession(newSession)
    setFocusTaskId(null)

    tracker.track('session.started', { sessionId: sid, taskId: '', taskTitle: '', isQuickFocus: true })

    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }, [setIsWidgetMode])

  const handleQuickFocusConfirm = useCallback((taskTitle: string) => {
    if (!quickFocusEnd) return
    const newTask: Task = {
      id: `t-${Date.now()}`,
      title: taskTitle,
      note: '',
      priority: 'medium',
      completed: true,
      createdAt: Date.now(),
      focusDuration: quickFocusEnd.durationSeconds,
    }
    setTasks(prev => [...prev, newTask])

    tracker.track('session.ended', {
      sessionId: sessionIdRef.current, taskId: newTask.id,
      taskTitle, totalDurationSeconds: quickFocusEnd.durationSeconds,
      completedMicroSteps: 0,
      endReason: 'task_done', isQuickFocus: true,
    })
    setQuickFocusEnd(null)
  }, [quickFocusEnd, setTasks])

  const handleQuickFocusSkip = useCallback(() => {
    handleQuickFocusConfirm('专注时段')
  }, [handleQuickFocusConfirm])

  // ===================== Widget toggle =====================

  const handleWidgetToggle = useCallback((id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t
      const nowCompleted = !t.completed
      if (!nowCompleted && t.subtasks?.length) {
        return { ...t, completed: false, subtasks: t.subtasks.map(s => ({ ...s, completed: false })) }
      }
      return { ...t, completed: nowCompleted }
    }))
  }, [setTasks])

  return {
    session, setSession,
    focusTaskId,
    scaffoldTaskId, setScaffoldTaskId,
    quickFocusEnd,
    sessionIdRef,
    handleStandbyStartMicro, handleStandbyResume,
    handleExitWidget,
    handleCreateAndFocus, handleFocusTask,
    handleStartMicro, handleMicroComplete, handleNextMicro,
    handleStuck, handleStuckToB, handleResume,
    handleSubtaskDone, handleEnterFlow, handleTaskDone,
    handleWidgetSubtaskToggle,
    handlePause, handleResumePaused,
    handleQuickFocus, handleQuickFocusEnd,
    handleQuickFocusConfirm, handleQuickFocusSkip,
    handleWidgetToggle,
  }
}
