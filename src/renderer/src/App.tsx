import { useState, useEffect, useCallback, useRef } from 'react'
import type { Task, UserProfile, PausedSession } from './types'
import { EMPTY_PROFILE } from './types'
import type { AIConfig } from './services/ai'
import { DEFAULT_AI_CONFIG } from './services/ai'
import type { FocusSession } from './components/WidgetView'
import { tracker } from './services/tracker'
import { aiCache } from './services/ai-cache'
import TitleBar from './components/TitleBar'
import CarryOverBanner from './components/CarryOverBanner'
import NoteEditor from './components/NoteEditor'
import WidgetView, { ENABLE_STEP_BY_STEP } from './components/WidgetView'
import StandbyWidget from './components/StandbyWidget'
import FocusFlow from './components/FocusFlow'
import AISettings from './components/AISettings'
import ProfileSettings from './components/ProfileSettings'
import ReflectionView from './components/ReflectionView'
import QuickFocusEndDialog from './components/QuickFocusEndDialog'

/**
 * 主应用组件
 *
 * 核心流程：
 *   1. 用户点击任务的播放按钮或底部「开启任务」→ 弹出 FocusFlow 覆盖层
 *   2. 用户确认微任务 → 创建 FocusSession，进入 WidgetView（Dynamic Bar）
 *   3. 执行 → 完成 → 接力输入 → 循环 / 进入心流
 *   4. 心流完成 → 任务标记完成 → 退出小组件
 */
/** 获取今天的日期字符串（YYYY-MM-DD） */
function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 把日期字符串偏移 N 天，返回新的 YYYY-MM-DD */
function shiftDate(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 搬迁数据结构 */
interface CarryOverInfo {
  fromDate: string
  tasks: Task[]
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [isWidgetMode, setIsWidgetMode] = useState(false)
  const [isStandbyMode, setIsStandbyMode] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)

  // -------- 日期概念：每天有独立的任务列表 --------
  const [currentDate, setCurrentDate] = useState(getToday)
  const isToday = currentDate === getToday()

  /** 切换到前一天 */
  const goPrevDate = useCallback(() => {
    setCurrentDate(d => shiftDate(d, -1))
  }, [])

  /** 切换到后一天（不能超过今天） */
  const goNextDate = useCallback(() => {
    setCurrentDate(d => {
      const next = shiftDate(d, 1)
      return next > getToday() ? d : next
    })
  }, [])

  /** 跳回今天 */
  const goToday = useCallback(() => {
    setCurrentDate(getToday())
  }, [])

  /** 跳转到指定日期（由日历弹窗触发） */
  const jumpToDate = useCallback((date: string) => {
    // 不能超过今天
    const today = getToday()
    setCurrentDate(date > today ? today : date)
  }, [])

  // -------- 搬迁状态：检测到前几天有未完成任务时显示横幅 --------
  const [carryOver, setCarryOver] = useState<CarryOverInfo | null>(null)

  // -------- 专注力流程状态 --------
  /** 当前正在进行 FocusFlow 覆盖层（阶段1）的任务 */
  const [scaffoldTaskId, setScaffoldTaskId] = useState<string | null>(null)
  /** 当前执行中的专注会话（阶段2），null = 旧的普通小组件 */
  const [session, setSession] = useState<FocusSession | null>(null)

  // -------- AI 配置 --------
  const [aiConfig, setAIConfig] = useState<AIConfig>({ ...DEFAULT_AI_CONFIG })
  const [showAISettings, setShowAISettings] = useState(false)

  // -------- 用户个人资料 --------
  const [userProfile, setUserProfile] = useState<UserProfile>({ ...EMPTY_PROFILE })
  const [showProfile, setShowProfile] = useState(false)

  // -------- 每日反思 --------
  const [showReflection, setShowReflection] = useState(false)

  // -------- 快速专注结束弹窗 --------
  const [quickFocusEnd, setQuickFocusEnd] = useState<{
    durationSeconds: number   // 本次专注时长（秒）
  } | null>(null)

  // -------- 会话 ID（用于关联同一次专注的所有事件）--------
  const sessionIdRef = useRef<string>('')

  // -------- session 持久化（睡眠唤醒 / HMR 重载后可恢复）--------
  // ★ 用 ref 标记 session 是否曾被主动设置过
  //   防止页面重载时初始 null 值误删 localStorage 中保存的 session
  const sessionInitialized = useRef(false)
  useEffect(() => {
    if (session) {
      sessionInitialized.current = true
      localStorage.setItem('focusSession', JSON.stringify(session))
      localStorage.setItem('focusSessionId', sessionIdRef.current)
    } else if (sessionInitialized.current) {
      // 只有 session 从"有"变成"无"时才清除（不在初始化时清除）
      localStorage.removeItem('focusSession')
      localStorage.removeItem('focusSessionId')
    }
    // 如果 sessionInitialized.current 为 false 且 session 为 null，
    // 说明是初始渲染，不动 localStorage（等 loadData 去恢复）
  }, [session])

  // -------- 初始化追踪器 --------
  useEffect(() => {
    tracker.init()
    return () => tracker.destroy()
  }, [])

  // -------- 初始化数据加载（AI配置 / 个人资料 / 窗口模式恢复 — 只跑一次） --------
  useEffect(() => {
    const initApp = async () => {
      try {
        const [savedConfig, savedProfile, windowMode] = await Promise.all([
          window.electronAPI.loadAIConfig(),
          window.electronAPI.loadProfile(),
          window.electronAPI.getWindowMode(),   // ★ 同步窗口模式（解决睡眠唤醒问题）
        ])
        if (savedConfig && savedConfig.apiKey) {
          setAIConfig({
            apiUrl: savedConfig.apiUrl || DEFAULT_AI_CONFIG.apiUrl,
            apiKey: savedConfig.apiKey || '',
            modelId: savedConfig.modelId || '',
          })
        }
        // 加载个人资料
        if (savedProfile && typeof savedProfile === 'object') {
          setUserProfile({
            major: String(savedProfile.major || ''),
            grade: String(savedProfile.grade || ''),
            challenges: Array.isArray(savedProfile.challenges) ? savedProfile.challenges.map(String) : [],
            workplaces: Array.isArray(savedProfile.workplaces) ? savedProfile.workplaces.map(String) : [],
            reflectionTime: savedProfile.reflectionTime ? String(savedProfile.reflectionTime) : null,
          })
        }
        // ★ 如果主进程说当前是 widget 模式，同步过来（页面重载/唤醒后恢复）
        if (windowMode?.isWidgetMode) {
          setIsWidgetMode(true)
          // 没有 session 时默认是待命模式（有 session 会在 loadDailyTasks 中恢复）
          const savedSession = localStorage.getItem('focusSession')
          if (!savedSession) {
            setIsStandbyMode(true)
          }
        }
      } catch (e) {
        console.error('初始化数据加载失败:', e)
      }
    }
    initApp()
  }, [])

  // -------- 按日期加载任务 + 搬迁检测（currentDate 变化时重新加载） --------
  useEffect(() => {
    const loadDailyTasks = async () => {
      try {
        const savedTasks = await window.electronAPI.loadTasks(currentDate)
        setTasks(savedTasks as Task[])

        // ★ widget 模式恢复（仅首次加载时需要，日期切换时不需要）
        // 这里用 loading 判断：true = 首次加载
        if (loading) {
          try {
            const windowMode = await window.electronAPI.getWindowMode()
            if (windowMode?.isWidgetMode) {
              const savedSession = localStorage.getItem('focusSession')
              const savedSessionId = localStorage.getItem('focusSessionId')
              if (savedSession) {
                try {
                  const restored = JSON.parse(savedSession) as FocusSession
                  restored.startTime = Date.now()
                  // ★ 保留原始 sessionStartTime，计时器从真实起点继续而非归零

                  // ★ 快速专注模式：不需要关联任务，直接恢复
                  if (restored.isQuickFocus) {
                    setSession(restored)
                    if (savedSessionId) sessionIdRef.current = savedSessionId
                    console.log('[App] 从 localStorage 恢复快速专注会话 ✓')
                  } else {
                    const loadedTasks = savedTasks as Task[]
                    const task = loadedTasks.find(t => t.id === restored.taskId)
                    if (task && !task.completed) {
                      setSession(restored)
                      if (savedSessionId) sessionIdRef.current = savedSessionId
                      console.log('[App] 从 localStorage 恢复专注会话 ✓', restored.taskTitle)
                    } else {
                      localStorage.removeItem('focusSession')
                      localStorage.removeItem('focusSessionId')
                    }
                  }
                } catch {
                  localStorage.removeItem('focusSession')
                  localStorage.removeItem('focusSessionId')
                }
              }
            }
          } catch { /* ignore */ }
        }

        // ★ 搬迁检测：检查前几天是否有未完成的任务
        const dismissKey = `carryOverDismissed-${currentDate}`
        if (!localStorage.getItem(dismissKey)) {
          try {
            const result = await window.electronAPI.findCarryOver(currentDate)
            if (result && result.tasks.length > 0) {
              setCarryOver({
                fromDate: result.fromDate,
                tasks: result.tasks as Task[],
              })
            } else {
              setCarryOver(null)
            }
          } catch (err) {
            console.error('[CarryOver] 检测失败:', err)
          }
        }
      } catch (e) {
        console.error('加载任务数据失败:', e)
      } finally {
        // ★ 首次启动时，如果没有正在执行的 session，默认进入待命 widget
        // 注意：锁屏唤醒等导致的页面重载不应触发（isFirstInit 区分）
        if (loading) {
          const windowMode = await window.electronAPI.getWindowMode()
          const hasSavedSession = !!localStorage.getItem('focusSession')
          if (windowMode?.isFirstInit && !windowMode?.isWidgetMode && !hasSavedSession) {
            window.electronAPI.enterWidget()
            setIsWidgetMode(true)
            setIsStandbyMode(true)
          }
        }
        setLoading(false)
      }
    }
    loadDailyTasks()
  }, [currentDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------- 监听托盘菜单触发的模式切换 --------
  useEffect(() => {
    window.electronAPI.onWidgetEnter(() => {
      setIsWidgetMode(true)
      // 托盘触发进入 widget 模式时，如果没有 session 就进入待命
      if (!session) setIsStandbyMode(true)
    })
    window.electronAPI.onWidgetExit(() => {
      setIsWidgetMode(false)
      setIsStandbyMode(false)
      setSession(null)
    })
    // ★ 系统唤醒后，主进程推送模式同步（确保 widget 不会变成压缩的主界面）
    window.electronAPI.onModeSync((data) => {
      setIsWidgetMode(data.isWidgetMode)
      if (!data.isWidgetMode) {
        setSession(null)
      } else {
        // ★ Widget 模式但 session 可能丢失（HMR重载）→ 尝试从 localStorage 恢复
        const savedSession = localStorage.getItem('focusSession')
        if (savedSession) {
          try {
            const restored = JSON.parse(savedSession) as FocusSession
            restored.startTime = Date.now()
            // ★ 保留原始 sessionStartTime，计时器从真实起点继续而非归零
            // 只在当前没有 session 时才恢复（不覆盖正常运行中的 session）
            setSession(prev => prev || restored)
          } catch { /* ignore */ }
        }
      }
    })
  }, [])

  // -------- 监听主进程发来的"打开反思页"通知（由定时提醒触发） --------
  useEffect(() => {
    window.electronAPI.onNavigateReflection(() => {
      setShowReflection(true)
    })
  }, [])

  // -------- 跨天检测：如果用户一直开着 app 到了第二天，自动切换日期 --------
  // ★ 注意：在小组件（专注模式）下不切换，避免任务数据丢失
  //   退出小组件后会重新检测，届时自动切到新一天
  useEffect(() => {
    const timer = setInterval(() => {
      if (isWidgetMode) return // 专注模式下不切换日期
      const today = getToday()
      setCurrentDate(prev => {
        if (prev !== today) {
          console.log(`[DayChange] 检测到日期变化：${prev} → ${today}，自动切换`)
          return today  // 这会触发 loadData effect 重新加载新一天的任务
        }
        return prev
      })
    }, 60_000) // 每 60 秒检查一次
    return () => clearInterval(timer)
  }, [isWidgetMode])

  // -------- 数据自动保存 + 托盘数量同步 --------
  const saveTasks = useCallback(async (date: string, newTasks: Task[]) => {
    try {
      await window.electronAPI.saveTasks(date, newTasks)
    } catch (e) {
      console.error('保存任务失败:', e)
    }
  }, [])

  useEffect(() => {
    if (!loading) {
      saveTasks(currentDate, tasks)
      const count = tasks.filter(t => !t.completed).length
      window.electronAPI.updateTrayCount(count)
    }
  }, [tasks, loading, currentDate, saveTasks])

  // -------- AI 配置保存（同时清除旧缓存） --------
  const handleSaveAIConfig = async (cfg: AIConfig) => {
    setAIConfig(cfg)
    aiCache.clearAll()   // 换了模型/Key，旧缓存失效
    try {
      await window.electronAPI.saveAIConfig(cfg as unknown as Record<string, string>)
    } catch (e) {
      console.error('保存AI配置失败:', e)
    }
  }

  // -------- 个人资料保存 --------
  const handleSaveProfile = async (p: UserProfile) => {
    setUserProfile(p)
    try {
      await window.electronAPI.saveProfile(p as unknown as Record<string, unknown>)
    } catch (e) {
      console.error('保存个人资料失败:', e)
    }
  }

  /** 判断用户是否已填写过资料（至少填了专业或年级） */
  const hasProfile = !!(userProfile.major || userProfile.grade)

  // ===================== 待命 widget =====================

  /** 主界面 → 收起为待命 widget */
  const handleEnterStandby = () => {
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
    setIsStandbyMode(true)
  }

  /** 待命 widget → 展开为主界面 */
  const handleExpandFromStandby = () => {
    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setIsStandbyMode(false)
  }

  /** 待命 widget 中确认第一步 → 直接创建 session 进入执行（不离开 widget） */
  const handleStandbyStartMicro = (taskId: string, microTask: string, source: 'self' | 'ai_chip' | 'skip') => {
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

    // 📊 埋点
    const pendingSnap = tasks.filter(t => !t.completed)
    tracker.track('plan.brain_dump', {
      tasks: pendingSnap.map(t => ({ id: t.id, title: t.title })),
      taskCount: pendingSnap.length,
    })
    tracker.track('plan.focus_selected', {
      taskId: task.id,
      taskTitle: task.title,
    })
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
  }

  /** 待命 widget 中点击"继续"→ 恢复暂停的 session */
  const handleStandbyResume = (taskId: string) => {
    setIsStandbyMode(false)
    handleResumePaused(taskId)
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
      tracker.track('session.ended', {
        sessionId: sessionIdRef.current,
        taskId: session.taskId,
        taskTitle: session.taskTitle,
        totalDurationSeconds: Math.floor((Date.now() - session.sessionStartTime) / 1000),
        completedMicroSteps: session.microHistory.length,
        endReason: 'exit',
      })
    }

    // 退出执行 widget → 进入待命 widget（而不是回主界面）
    setFocusTaskId(null)
    setSession(null)
    setIsStandbyMode(true)
    // 不调用 exitWidget()，保持 widget 模式窗口
  }

  /**
   * 底部输入框 ▶ 按钮：创建新任务并立即打开 FocusFlow
   * 一步完成"创建 + 开始"，减少 ADHD 用户的操作摩擦
   */
  const handleCreateAndFocus = (title: string) => {
    const newId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const newTask: Task = {
      id: newId,
      title,
      note: '',
      priority: 'medium',
      completed: false,
      createdAt: Date.now(),
    }

    // 创建任务 + 立即打开 FocusFlow（React 18 批量更新，同一次渲染生效）
    setTasks(prev => [...prev, newTask])
    setScaffoldTaskId(newId)

    // 预加载 AI 建议
    if (aiConfig.apiKey) {
      aiCache.prefetch(newId, title, aiConfig)
    }

    // 📊 埋点
    const pendingSnap = [...tasks.filter(t => !t.completed), newTask]
    tracker.track('plan.brain_dump', {
      tasks: pendingSnap.map(t => ({ id: t.id, title: t.title })),
      taskCount: pendingSnap.length,
    })
    tracker.track('plan.focus_selected', {
      taskId: newId,
      taskTitle: title,
    })
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
   * @param understandingContext  用户在 Task Understanding 阶段的反思问答（可选）
   */
  const handleStartMicro = (microTask: string, source: 'self' | 'ai_chip' | 'skip', understandingContext?: string) => {
    const task = tasks.find(t => t.id === scaffoldTaskId)
    if (!task) return
    setScaffoldTaskId(null)

    // 生成会话 ID
    const sid = `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    sessionIdRef.current = sid

    // 子任务导航：找到第一个未完成的子任务
    const subtasks = task.subtasks ?? []
    const activeSubtask = subtasks.find(s => !s.completed) ?? null

    // 创建 FocusSession —— 先执行用户确认的第一步，完成后再进入主任务视图
    const now = Date.now()
    const newSession: FocusSession = {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
      currentMicroTask: microTask,    // 先执行确认的第一步
      startTime: now,
      sessionStartTime: now,
      isFlowMode: false,              // ★ 先进入第一步执行态，完成后再进入主任务视图
      phase: 'executing',
      microHistory: [],
      firstStepHint: microTask,       // 保留首步提示，便于暂停恢复时保留上下文
      // 子任务信息
      currentSubtaskId: activeSubtask?.id,
      currentSubtaskTitle: activeSubtask?.title,
    }
    setSession(newSession)
    setFocusTaskId(task.id)

    // 📊 埋点：任务理解（如果有）
    if (understandingContext) {
      tracker.track('plan.task_understanding', {
        taskId: task.id,
        taskTitle: task.title,
        understandingContext,
      })
    }

    // 📊 埋点：破冰第一步 + 会话开始 + 第一步真正进入执行
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

  /** 微任务完成 → 进入 relay 阶段（或简化模式下直接退出） */
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

    // 简化模式：完成第一步后切换到主任务视图，继续后续执行。
    if (!ENABLE_STEP_BY_STEP) {
      setSession(s => s ? {
        ...s,
        phase: 'executing',
        isFlowMode: true,
        currentMicroTask: s.taskTitle,
        microHistory: [...s.microHistory, s.currentMicroTask],
        startTime: Date.now(),
        firstStepHint: undefined,
      } : s)
      return
    }

    // 逐步拆解模式：进入 relay 接力阶段
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

    // 📊 埋点：卡住事件（用 sessionStartTime 而非 startTime，与 session.ended 的计算基准一致）
    const elapsed = Math.floor((Date.now() - session.sessionStartTime) / 1000)
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

  /** 心流模式下完成整个任务（或快速专注模式点击"做完了"） */
  const handleTaskDone = () => {
    if (!session) return

    // ★ 快速专注模式：走专门的结束流程（弹窗收集任务名）
    if (session.isQuickFocus) {
      handleQuickFocusEnd()
      return
    }

    // 📊 埋点：心流结束 + 宏观任务完成 + 会话结束
    const flowDuration = Math.floor((Date.now() - session.startTime) / 1000)
    const sessionDuration = Math.floor((Date.now() - session.sessionStartTime) / 1000)
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
      totalDurationSeconds: sessionDuration,
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

    // 任务完成后 → 进入待命 widget
    setFocusTaskId(null)
    setSession(null)
    setIsStandbyMode(true)
  }

  // ===================== 简化模式：任务结构视图中的子任务勾选 =====================

  /**
   * Widget 任务结构视图中勾选/取消子任务
   * 纯进度记录，不触发 AI 行为
   * 如果全部子任务勾选完成 → 自动标记主任务完成并退出
   */
  const handleWidgetSubtaskToggle = (subtaskId: string) => {
    if (!session) return

    let allDone = false

    setTasks(prev => prev.map(t => {
      if (t.id !== session.taskId) return t
      const updatedSubs = (t.subtasks ?? []).map(s =>
        s.id === subtaskId ? { ...s, completed: !s.completed } : s
      )
      allDone = updatedSubs.length > 0 && updatedSubs.every(s => s.completed)
      return { ...t, subtasks: updatedSubs }
    }))

    // 全部子任务完成 → 自动标记主任务完成并退出
    if (allDone) {
      // 延迟一下让 UI 更新 checkbox 状态，然后触发完成
      setTimeout(() => {
        // 📊 埋点
        // 用 sessionStartTime 统计整段专注时长，避免只记录到最后一步导致时长过短
        const elapsed = Math.floor((Date.now() - session.sessionStartTime) / 1000)
        tracker.track('session.macro_completed', {
          taskId: session.taskId,
          taskTitle: session.taskTitle,
          completedVia: 'subtasks_all_done',
        })
        tracker.track('session.ended', {
          sessionId: sessionIdRef.current,
          taskId: session.taskId,
          taskTitle: session.taskTitle,
          totalDurationSeconds: elapsed,
          completedMicroSteps: session.microHistory.length,
          endReason: 'task_done',
        })

        // 标记主任务完成
        setTasks(prev => prev.map(t =>
          t.id === session.taskId ? { ...t, completed: true } : t,
        ))

        // 子任务全部完成 → 进入待命 widget
        setFocusTaskId(null)
        setSession(null)
        setIsStandbyMode(true)
      }, 400)
    }
  }

  // ===================== 暂停 & 切换 =====================

  /**
   * 暂停当前任务——保存 session 快照到 task.pausedSession，然后退出小组件
   * 用户可以之后通过主界面"▶ 继续"恢复
   */
  const handlePause = () => {
    if (!session) return

    // ★ 本段专注时长（仅当前恢复后的这一段，用于埋点）
    const segmentDuration = Math.floor((Date.now() - session.sessionStartTime) / 1000)
    // ★ 累计显示时长 = 本段 + 之前暂停累积的偏移量（用于下次恢复时计时器继续）
    const totalDisplayed = segmentDuration + (session.elapsedOffset || 0)

    // 构造暂停快照
    const snapshot: PausedSession = {
      sessionId: session.sessionId,
      currentMicroTask: session.currentMicroTask,
      microHistory: [...session.microHistory],
      isFlowMode: session.isFlowMode,
      firstStepHint: session.firstStepHint,
      currentSubtaskId: session.currentSubtaskId,
      currentSubtaskTitle: session.currentSubtaskTitle,
      pausedAt: Date.now(),
      elapsedBeforePause: totalDisplayed,  // ★ 保存累计显示时长，下次恢复时计时器从这里接着计
    }

    // 📊 埋点：暂停事件（只记录本段时长，不含之前的累计）
    tracker.track('session.paused', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      microAction: session.currentMicroTask,
      elapsedSeconds: segmentDuration,
      completedMicroSteps: session.microHistory.length,
    })

    // 📊 埋点：补发 session.ended（endReason='pause'），让热力图正确截断这段时间
    tracker.track('session.ended', {
      sessionId: sessionIdRef.current,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      totalDurationSeconds: segmentDuration,  // ★ 只记录本段，避免与之前段重复计数
      completedMicroSteps: session.microHistory.length,
      endReason: 'pause',
    })

    // 写入 task.pausedSession
    setTasks(prev => prev.map(t =>
      t.id === session.taskId ? { ...t, pausedSession: snapshot } : t,
    ))

    // 暂停后 → 进入待命 widget（而不是回主界面）
    setFocusTaskId(null)
    setSession(null)
    setIsStandbyMode(true)
  }

  /**
   * 恢复暂停的任务——读取 task.pausedSession → 重建 FocusSession → 进入小组件
   */
  const handleResumePaused = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task || !task.pausedSession) return

    const snap = task.pausedSession

    // 生成新会话 ID（延续旧的 sessionId 前缀 + resume 后缀）
    const sid = `${snap.sessionId}-r${Date.now().toString(36).slice(-4)}`
    sessionIdRef.current = sid

    // 重建 FocusSession —— 恢复到暂停前所在阶段（第一步执行态 / 主任务视图）
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
      elapsedOffset: snap.elapsedBeforePause,  // ★ 恢复之前已累计的秒数，计时器从暂停处继续
    }

    // 📊 埋点：恢复事件
    tracker.track('session.resumed', {
      sessionId: sid,
      originalSessionId: snap.sessionId,
      taskId: task.id,
      taskTitle: task.title,
      microAction: snap.currentMicroTask,
      pausedDurationSeconds: Math.floor((Date.now() - snap.pausedAt) / 1000),
      completedMicroSteps: snap.microHistory.length,
    })

    // 📊 埋点：补发 session.started（新 sessionId），让热力图正确记录恢复后的时间段
    tracker.track('session.started', {
      sessionId: sid,
      taskId: task.id,
      taskTitle: task.title,
    })

    // 清除暂停状态
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, pausedSession: null } : t,
    ))

    setSession(restored)
    setFocusTaskId(task.id)

    // 进入小组件模式
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }

  // ===================== 快速专注（无需先选任务） =====================

  /**
   * 一键开启专注模式
   * 不绑定任何任务，创建一个 isQuickFocus 的 FocusSession
   * 直接进入 widget 小组件模式
   */
  const handleQuickFocus = () => {
    const sid = `qf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    sessionIdRef.current = sid

    const now = Date.now()
    const newSession: FocusSession = {
      sessionId: sid,
      taskId: '',              // 快速专注没有绑定任务
      taskTitle: '',
      currentMicroTask: '',
      startTime: now,
      sessionStartTime: now,
      isFlowMode: false,
      phase: 'executing',
      microHistory: [],
      isQuickFocus: true,      // ★ 标记为快速专注模式
    }
    setSession(newSession)
    setFocusTaskId(null)

    // 📊 埋点
    tracker.track('session.started', {
      sessionId: sid,
      taskId: '',
      taskTitle: '',
      isQuickFocus: true,
    })

    // 进入小组件模式
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
  }

  /**
   * 快速专注点击"做完了" → 退出 widget → 弹出结束弹窗
   * 弹窗会在主界面上显示，让用户输入任务名称
   */
  const handleQuickFocusEnd = () => {
    if (!session || !session.isQuickFocus) return

    const duration = Math.floor((Date.now() - session.sessionStartTime) / 1000)

    // ★ 不在这里埋点 session.ended，延迟到用户填写任务名称后再发送
    //   这样 tracker 里的 taskTitle 才是用户实际填的名字

    // 退出 widget 模式
    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setSession(null)

    // 弹出结束弹窗（在主界面上显示）
    setQuickFocusEnd({ durationSeconds: duration })
  }

  /**
   * 快速专注结束弹窗确认：创建一个已完成的任务，并补发 tracker 埋点
   */
  const handleQuickFocusConfirm = (taskTitle: string) => {
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

    // 📊 埋点：在用户填写任务名后再记录 session.ended
    //   endReason 用 'task_done' 以便反思页图表识别为已完成（蓝色）
    tracker.track('session.ended', {
      sessionId: sessionIdRef.current,
      taskId: newTask.id,
      taskTitle: taskTitle,
      totalDurationSeconds: quickFocusEnd.durationSeconds,
      endReason: 'task_done',
      isQuickFocus: true,
    })

    setQuickFocusEnd(null)
  }

  /**
   * 快速专注结束弹窗跳过：用默认名称保存
   */
  const handleQuickFocusSkip = () => {
    handleQuickFocusConfirm('专注时段')
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

  // -------- 搬迁操作 --------
  /** 执行搬迁：把选中的旧任务复制到今天 */
  const handleCarryOver = async (taskIds: string[]) => {
    if (!carryOver) return
    try {
      const ok = await window.electronAPI.carryOverTasks(carryOver.fromDate, taskIds, currentDate)
      if (ok) {
        // 重新加载今天的任务
        const refreshed = await window.electronAPI.loadTasks(currentDate)
        setTasks(refreshed as Task[])
        setCarryOver(null)
      }
    } catch (e) {
      console.error('[CarryOver] 搬迁失败:', e)
    }
  }

  /** 忽略搬迁（今天不再提示） */
  const handleDismissCarryOver = () => {
    localStorage.setItem(`carryOverDismissed-${currentDate}`, '1')
    setCarryOver(null)
  }

  // -------- 数据分组 --------
  const pendingTasks = tasks.filter(t => !t.completed)
  const completedTasks = tasks.filter(t => t.completed)

  // 找到 FocusFlow 需要的任务
  const scaffoldTask = scaffoldTaskId ? tasks.find(t => t.id === scaffoldTaskId) : null

  // -------- AI 建议预加载 --------

  // ★ 策略1：页面加载后预加载所有待办任务（错开请求，避免并发压力）
  useEffect(() => {
    if (loading || isWidgetMode || !aiConfig.apiKey) return
    pendingTasks.forEach((t, i) => {
      const subtaskTitle = (t.subtasks ?? []).find(s => !s.completed)?.title
      // 错开 1 秒间隔，避免并发压力
      setTimeout(() => aiCache.prefetch(t.id, t.title, aiConfig, subtaskTitle), i * 1000)
    })
  }, [loading, isWidgetMode, aiConfig])  // 注意：不监听 tasks，只在加载完成时触发一次

  // ★ 策略2：新任务创建时立即预加载（覆盖"写完就想干"场景）
  const prevTaskCountRef = useRef(0)
  useEffect(() => {
    if (loading || isWidgetMode || !aiConfig.apiKey) return
    const currentCount = pendingTasks.length
    // 任务数量增加 → 说明新建了任务，预加载最后一个（刚创建的）
    if (currentCount > prevTaskCountRef.current && currentCount > 0) {
      const newest = pendingTasks[currentCount - 1]
      const subtaskTitle = (newest.subtasks ?? []).find(s => !s.completed)?.title
      aiCache.prefetch(newest.id, newest.title, aiConfig, subtaskTitle)
    }
    prevTaskCountRef.current = currentCount
  }, [pendingTasks.length, aiConfig])

  // ★ 策略3：任务标题变更时 → 清除旧缓存 + 防抖重新预加载（修复改名后 AI 建议不更新的问题）
  //   - 立即清除旧缓存（防止返回过期结果）
  //   - 防抖 800ms 后再预加载（用户逐字输入时避免频繁请求 AI）
  const prevTaskTitlesRef = useRef<Map<string, string>>(new Map())
  const titleChangeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  useEffect(() => {
    if (loading || !aiConfig.apiKey) return

    const prevTitles = prevTaskTitlesRef.current

    // 检测每个任务的标题是否发生了变化
    for (const task of tasks) {
      const prevTitle = prevTitles.get(task.id)
      // prevTitle !== undefined 说明这个任务之前就存在（排除新建任务的情况）
      // prevTitle !== task.title 说明标题被修改了
      if (prevTitle !== undefined && prevTitle !== task.title) {
        // ① 立即清除旧缓存（这样点击 ▶ 时不会拿到旧建议）
        aiCache.invalidate(task.id)

        // ② 防抖预加载：清除之前的定时器，等用户停止输入 800ms 后再发请求
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

    // 更新标题快照（记住每个任务当前的标题，用于下次比较）
    const newTitles = new Map<string, string>()
    for (const task of tasks) {
      newTitles.set(task.id, task.title)
    }
    prevTaskTitlesRef.current = newTitles
  }, [tasks, loading, isWidgetMode, aiConfig])

  // 组件卸载时清除所有防抖定时器
  useEffect(() => {
    return () => {
      titleChangeTimersRef.current.forEach(timer => clearTimeout(timer))
    }
  }, [])

  /** hover ▶ 按钮时预加载该任务的 AI 建议 */
  const handlePrefetchTask = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const subtaskTitle = (task.subtasks ?? []).find(s => !s.completed)?.title
    aiCache.prefetch(task.id, task.title, aiConfig, subtaskTitle)
  }, [tasks, aiConfig])

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

  // -------- 待命 widget 模式（没有 session 时显示常驻开始入口） --------
  if (isWidgetMode && isStandbyMode) {
    return (
      <div className="w-full h-full overflow-hidden">
        <StandbyWidget
          tasks={tasks}
          aiConfig={aiConfig}
          onStartMicro={handleStandbyStartMicro}
          onResumePaused={handleStandbyResume}
          onExpand={handleExpandFromStandby}
        />
      </div>
    )
  }

  // -------- 执行 widget 模式（包含旧版和新版 Dynamic Bar） --------
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
          onPause={handlePause}
          onWidgetSubtaskToggle={handleWidgetSubtaskToggle}
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
        onOpenProfile={() => setShowProfile(true)}
        onOpenAISettings={() => setShowAISettings(true)}
        onOpenReflection={() => setShowReflection(true)}
        onEnterStandby={handleEnterStandby}
        hasProfile={hasProfile}
      />

      {/* 搬迁横幅：仅今天、检测到前几天有未完成任务时显示 */}
      {isToday && carryOver && (
        <CarryOverBanner
          fromDate={carryOver.fromDate}
          tasks={carryOver.tasks}
          onCarryOver={handleCarryOver}
          onDismiss={handleDismissCarryOver}
        />
      )}

      {/* 核心编辑区域 */}
      <NoteEditor
        tasks={tasks} setTasks={setTasks}
        onFocusTask={handleFocusTask} onResumePaused={handleResumePaused} onPrefetchTask={handlePrefetchTask}
        onCreateAndFocus={handleCreateAndFocus}
        isToday={isToday} currentDate={currentDate}
        onPrevDate={goPrevDate} onNextDate={goNextDate} onGoToday={goToday}
        onJumpToDate={jumpToDate}
      />

      {/* 底部区域 */}
      <div className="flex-shrink-0 select-none">
        {/* 收起为小组件按钮（仅今天 + 有待办任务时显示） */}
        {isToday && pendingTasks.length > 0 && (
          <div className="flex justify-center -mt-3 mb-1.5 relative z-10">
            <button
              onClick={handleEnterStandby}
              className="flex items-center gap-1.5 px-5 py-2 rounded-full
                         bg-emerald-500 hover:bg-emerald-600
                         active:scale-95
                         text-white
                         text-xs font-semibold
                         shadow-sm shadow-emerald-200/50 hover:shadow-md hover:shadow-emerald-200/80
                         transition-all duration-200"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
              收起为桌面小组件
            </button>
          </div>
        )}

        {/* 状态栏 */}
        {tasks.length > 0 && (
          <div className="px-5 py-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {isToday
                ? completedTasks.length === 0
                  ? `今天还有 ${pendingTasks.length} 件事等你`
                  : completedTasks.length === tasks.length
                    ? '全部搞定！今天太棒了 🎉'
                    : `已搞定 ${completedTasks.length} 件，还剩 ${pendingTasks.length} 件 💪`
                : `当天共 ${tasks.length} 个任务，完成 ${completedTasks.length} 个`
              }
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
          key={scaffoldTask.id}
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

      {/* 个人资料设置面板 */}
      <ProfileSettings
        visible={showProfile}
        profile={userProfile}
        onSave={handleSaveProfile}
        onClose={() => setShowProfile(false)}
      />

      {/* ★ 快速专注结束弹窗：退出 widget 后在主界面上显示 */}
      {quickFocusEnd && (
        <QuickFocusEndDialog
          durationSeconds={quickFocusEnd.durationSeconds}
          onConfirm={handleQuickFocusConfirm}
          onSkip={handleQuickFocusSkip}
        />
      )}
    </div>
  )
}
