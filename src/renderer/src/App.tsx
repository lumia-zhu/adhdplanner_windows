import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { Task, UserProfile } from './types'
import { EMPTY_PROFILE } from './types'
import type { AIConfig } from './services/ai'
import { DEFAULT_AI_CONFIG } from './services/ai'
import type { FocusSession } from './components/WidgetView'
import { tracker } from './services/tracker'
import { aiCache } from './services/ai-cache'
import type { CarryOverGroup } from './components/CarryOverBanner'
import TitleBar from './components/TitleBar'
import NoteEditor from './components/NoteEditor'
import WidgetView from './components/WidgetView'
import StandbyWidget from './components/StandbyWidget'
import FocusFlow from './components/FocusFlow'
import AISettings from './components/AISettings'
import ProfileSettings from './components/ProfileSettings'
import ReflectionView from './components/ReflectionView'
import QuickFocusEndDialog from './components/QuickFocusEndDialog'
import AuthPage from './components/AuthPage'

import { useDateNavigation, getToday } from './hooks/useDateNavigation'
import { useWidgetMode } from './hooks/useWidgetMode'
import { useFocusSession } from './hooks/useFocusSession'
import { useAICache } from './hooks/useAICache'

interface AuthUser {
  id: string
  email: string
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [isWidgetMode, setIsWidgetMode] = useState(false)
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

  // -------- 日期导航 --------
  const {
    currentDate, setCurrentDate, isToday,
    goPrevDate, goNextDate, goToday, jumpToDate,
  } = useDateNavigation()

  // -------- AI 配置 --------
  const [aiConfig, setAIConfig] = useState<AIConfig>({ ...DEFAULT_AI_CONFIG })
  const [showAISettings, setShowAISettings] = useState(false)

  // -------- 用户资料 --------
  const [userProfile, setUserProfile] = useState<UserProfile>({ ...EMPTY_PROFILE })
  const [showProfile, setShowProfile] = useState(false)

  // -------- 专注会话 --------
  const focusSession = useFocusSession({
    tasks, setTasks, aiConfig,
    isWidgetMode, setIsWidgetMode,
    setIsStandbyMode: (v: boolean) => widgetMode.setIsStandbyMode(v),
    loading,
  })

  // -------- Widget 模式 --------
  const widgetMode = useWidgetMode({
    session: focusSession.session,
    setSession: focusSession.setSession,
    isWidgetMode, setIsWidgetMode,
    setCurrentDate,
  })

  // -------- AI 缓存预加载 --------
  const { handlePrefetchTask } = useAICache(tasks, aiConfig, loading, isWidgetMode)

  // -------- 搬迁状态（聚合多天） --------
  const [carryOverGroups, setCarryOverGroups] = useState<CarryOverGroup[]>([])

  // 防止切换日期时用旧 tasks 写入新日期
  const tasksLoadedForDate = useRef<string | null>(null)

  // -------- 检查登录状态 --------
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { user } = await window.electronAPI.authGetUser()
        if (user && typeof user === 'object') {
          const u = user as AuthUser
          setCurrentUser({ id: u.id, email: u.email })
        }
      } catch (e) {
        console.error('[Auth] 检查登录状态失败:', e)
      } finally {
        setAuthChecking(false)
      }
    }
    checkAuth()
  }, [])

  // -------- 初始化追踪器 --------
  useEffect(() => {
    tracker.init()
    return () => tracker.destroy()
  }, [])

  // -------- 初始化数据加载 --------
  useEffect(() => {
    const initApp = async () => {
      try {
        const [savedConfig, savedProfile, windowMode] = await Promise.all([
          window.electronAPI.loadAIConfig(),
          window.electronAPI.loadProfile(),
          window.electronAPI.getWindowMode(),
        ])
        if (savedConfig && savedConfig.apiKey) {
          setAIConfig({
            apiUrl: savedConfig.apiUrl || DEFAULT_AI_CONFIG.apiUrl,
            apiKey: savedConfig.apiKey || '',
            modelId: savedConfig.modelId || '',
          })
        }
        if (savedProfile && typeof savedProfile === 'object') {
          setUserProfile({
            major: String(savedProfile.major || ''),
            grade: String(savedProfile.grade || ''),
            challenges: Array.isArray(savedProfile.challenges) ? savedProfile.challenges.map(String) : [],
            workplaces: Array.isArray(savedProfile.workplaces) ? savedProfile.workplaces.map(String) : [],
            reflectionTime: savedProfile.reflectionTime ? String(savedProfile.reflectionTime) : null,
          })
        }
        if (windowMode?.isWidgetMode) {
          setIsWidgetMode(true)
          const savedSession = localStorage.getItem('focusSession')
          if (!savedSession) {
            widgetMode.setIsStandbyMode(true)
          }
        }
      } catch (e) {
        console.error('初始化数据加载失败:', e)
      }
    }
    initApp()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -------- 按日期加载任务 + 搬迁检测 --------
  useEffect(() => {
    tasksLoadedForDate.current = null
    const loadDailyTasks = async () => {
      try {
        const savedTasks = await window.electronAPI.loadTasks(currentDate)
        setTasks(savedTasks as Task[])
        tasksLoadedForDate.current = currentDate

        // Widget 模式恢复（仅首次加载）
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

                  if (restored.isQuickFocus) {
                    focusSession.setSession(restored)
                    if (savedSessionId) focusSession.sessionIdRef.current = savedSessionId
                  } else {
                    const loadedTasks = savedTasks as Task[]
                    const task = loadedTasks.find(t => t.id === restored.taskId)
                    if (task && !task.completed) {
                      focusSession.setSession(restored)
                      if (savedSessionId) focusSession.sessionIdRef.current = savedSessionId
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

        // 搬迁检测（聚合多天）
        try {
          const groups = await window.electronAPI.findAllCarryOver(currentDate)
          if (groups && groups.length > 0) {
            const totalCount = groups.reduce((s, g) => s + g.tasks.length, 0)
            const dismissKey = `carryOverDismissed-${currentDate}`
            const dismissedCount = parseInt(localStorage.getItem(dismissKey) || '0', 10)
            if (totalCount > dismissedCount) {
              setCarryOverGroups(groups.map(g => ({
                fromDate: g.fromDate,
                tasks: g.tasks as Task[],
              })))
            } else {
              setCarryOverGroups([])
            }
          } else {
            setCarryOverGroups([])
            }
          } catch (err) {
            console.error('[CarryOver] 检测失败:', err)
        }
      } catch (e) {
        console.error('加载任务数据失败:', e)
      } finally {
        if (loading) {
          const windowMode = await window.electronAPI.getWindowMode()
          const hasSavedSession = !!localStorage.getItem('focusSession')
          if (windowMode?.isFirstInit && !windowMode?.isWidgetMode && !hasSavedSession) {
            window.electronAPI.enterWidget()
            setIsWidgetMode(true)
            widgetMode.setIsStandbyMode(true)
          }
        }
        setLoading(false)
      }
    }
    loadDailyTasks()
  }, [currentDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // -------- 数据自动保存 + 托盘同步 --------
  const saveTasks = useCallback(async (date: string, newTasks: Task[]) => {
    try {
      await window.electronAPI.saveTasks(date, newTasks)
    } catch (e) {
      console.error('保存任务失败:', e)
    }
  }, [])

  useEffect(() => {
    if (!loading && tasksLoadedForDate.current === currentDate) {
      saveTasks(currentDate, tasks)
      const count = tasks.filter(t => !t.completed).length
      window.electronAPI.updateTrayCount(count)
    }
  }, [tasks, loading, currentDate, saveTasks])

  // -------- Widget 快速添加/删除任务 --------
  const handleQuickAddTask = useCallback((title: string, id: string) => {
    setTasks(prev => [...prev, {
      id,
      title,
      note: '',
      priority: 'medium' as const,
      completed: false,
      createdAt: Date.now(),
    }])
  }, [setTasks])

  const handleDeleteTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }, [setTasks])

  // -------- AI 配置保存 --------
  const handleSaveAIConfig = async (cfg: AIConfig) => {
    setAIConfig(cfg)
    aiCache.clearAll()
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

  const hasProfile = !!(userProfile.major || userProfile.grade)

  // -------- 搬迁操作（支持多天） --------
  const handleCarryOver = async (dateTaskMap: Record<string, string[]>) => {
    try {
      const ok = await window.electronAPI.multiCarryOverTasks(dateTaskMap, currentDate)
      if (ok) {
        const refreshed = await window.electronAPI.loadTasks(currentDate)
        setTasks(refreshed as Task[])
        setCarryOverGroups([])
      }
    } catch (e) {
      console.error('[CarryOver] 搬迁失败:', e)
    }
  }

  const handleDismissCarryOver = () => {
    const totalCount = carryOverGroups.reduce((s, g) => s + g.tasks.length, 0)
    localStorage.setItem(`carryOverDismissed-${currentDate}`, String(totalCount))
    setCarryOverGroups([])
  }

  const handleClearCompleted = () => {
    setTasks(prev => prev.filter(t => !t.completed))
  }

  // -------- 数据分组 --------
  const pendingTasks = tasks.filter(t => !t.completed)
  const completedTasks = tasks.filter(t => t.completed)
  const scaffoldTask = focusSession.scaffoldTaskId
    ? tasks.find(t => t.id === focusSession.scaffoldTaskId) : null

  // -------- 检查认证中 --------
  if (authChecking) {
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

  // -------- 未登录：显示登录页 --------
  if (!currentUser) {
    return (
      <AuthPage onLoginSuccess={(user) => setCurrentUser(user)} />
    )
  }

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

  // -------- 待命 widget --------
  if (isWidgetMode && widgetMode.isStandbyMode) {
    return (
      <div className="w-full h-full overflow-hidden">
        <StandbyWidget
          tasks={tasks}
          aiConfig={aiConfig}
          onStartMicro={focusSession.handleStandbyStartMicro}
          onResumePaused={focusSession.handleStandbyResume}
          onExpand={widgetMode.handleExpandFromStandby}
          onQuickAddTask={handleQuickAddTask}
          onDeleteTask={handleDeleteTask}
        />
      </div>
    )
  }

  // -------- 执行 widget --------
  if (isWidgetMode) {
    return (
      <div className="w-full h-full bg-white overflow-hidden">
        <WidgetView
          tasks={tasks}
          session={focusSession.session}
          aiConfig={aiConfig}
          focusTaskId={focusSession.focusTaskId}
          onToggle={focusSession.handleWidgetToggle}
          onExit={focusSession.handleExitWidget}
          onMicroComplete={focusSession.handleMicroComplete}
          onNextMicro={focusSession.handleNextMicro}
          onEnterFlow={focusSession.handleEnterFlow}
          onTaskDone={focusSession.handleTaskDone}
          onStuck={focusSession.handleStuck}
          onStuckToB={focusSession.handleStuckToB}
          onResume={focusSession.handleResume}
          onSubtaskDone={focusSession.handleSubtaskDone}
          onPause={focusSession.handlePause}
          onWidgetSubtaskToggle={focusSession.handleWidgetSubtaskToggle}
        />
      </div>
    )
  }

  // -------- 每日反思界面 --------
  if (widgetMode.showReflection) {
    return (
      <div className="h-screen bg-white overflow-hidden">
        <ReflectionView
          tasks={tasks}
          aiConfig={aiConfig}
          onClose={() => widgetMode.setShowReflection(false)}
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
        onOpenReflection={() => widgetMode.setShowReflection(true)}
        onEnterStandby={widgetMode.handleEnterStandby}
        hasProfile={hasProfile}
      />

      <NoteEditor
        tasks={tasks} setTasks={setTasks}
        onFocusTask={focusSession.handleFocusTask}
        onResumePaused={focusSession.handleResumePaused}
        onPrefetchTask={handlePrefetchTask}
        onCreateAndFocus={focusSession.handleCreateAndFocus}
        carryOverGroups={isToday ? carryOverGroups : []}
        onCarryOver={handleCarryOver}
        onDismissCarryOver={handleDismissCarryOver}
        isToday={isToday} currentDate={currentDate}
        onPrevDate={goPrevDate} onNextDate={goNextDate} onGoToday={goToday}
        onJumpToDate={jumpToDate}
      />

      <div className="flex-shrink-0 select-none">
        {isToday && pendingTasks.length > 0 && (
          <div className="flex justify-center -mt-3 mb-1.5 relative z-10">
            <button
              onClick={widgetMode.handleEnterStandby}
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

        {tasks.length > 0 && (
          <div className="px-5 py-1.5 flex items-center justify-between">
            <span className="text-xxs text-gray-400">
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
                    <span className="text-xxs text-gray-400">
                      {Math.round((completedTasks.length / tasks.length) * 100)}%
                    </span>
                  </div>
                  <button
                    onClick={handleClearCompleted}
                    className="text-xxs text-gray-400 hover:text-red-400 transition-colors"
                  >
                    清除已完成
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {scaffoldTask && (
        <FocusFlow
          key={scaffoldTask.id}
          task={scaffoldTask}
          aiConfig={aiConfig}
          onStart={focusSession.handleStartMicro}
          onCancel={() => focusSession.setScaffoldTaskId(null)}
        />
      )}

      <AISettings
        visible={showAISettings}
        config={aiConfig}
        onSave={handleSaveAIConfig}
        onClose={() => setShowAISettings(false)}
      />

      <ProfileSettings
        visible={showProfile}
        profile={userProfile}
        onSave={handleSaveProfile}
        onClose={() => setShowProfile(false)}
      />

      {focusSession.quickFocusEnd && (
        <QuickFocusEndDialog
          durationSeconds={focusSession.quickFocusEnd.durationSeconds}
          onConfirm={focusSession.handleQuickFocusConfirm}
          onSkip={focusSession.handleQuickFocusSkip}
        />
      )}
    </div>
  )
}
