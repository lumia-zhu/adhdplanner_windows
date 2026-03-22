import { useState, useEffect } from 'react'
import type { FocusSession } from '../components/WidgetView'
import { getToday } from './useDateNavigation'

interface UseWidgetModeParams {
  session: FocusSession | null
  setSession: React.Dispatch<React.SetStateAction<FocusSession | null>>
  isWidgetMode: boolean
  setIsWidgetMode: (v: boolean) => void
  setCurrentDate: (d: string | ((prev: string) => string)) => void
}

/**
 * 管理 Widget 模式的 IPC 监听、模式同步、跨天检测。
 * 反思页导航回调也在这里注册。
 */
export function useWidgetMode({
  session, setSession,
  isWidgetMode, setIsWidgetMode,
  setCurrentDate,
}: UseWidgetModeParams) {
  const [isStandbyMode, setIsStandbyMode] = useState(false)
  const [showReflection, setShowReflection] = useState(false)

  // 监听托盘菜单触发的模式切换
  useEffect(() => {
    window.electronAPI.onWidgetEnter(() => {
      setIsWidgetMode(true)
      if (!session) setIsStandbyMode(true)
    })
    window.electronAPI.onWidgetExit(() => {
      setIsWidgetMode(false)
      setIsStandbyMode(false)
      setSession(null)
    })
    // 系统唤醒后的模式同步
    window.electronAPI.onModeSync((data) => {
      setIsWidgetMode(data.isWidgetMode)
      if (!data.isWidgetMode) {
        setSession(null)
      } else {
        const savedSession = localStorage.getItem('focusSession')
        if (savedSession) {
          try {
            const restored = JSON.parse(savedSession) as FocusSession
            restored.startTime = Date.now()
            setSession(prev => prev || restored)
          } catch { /* ignore */ }
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 监听主进程发来的"打开反思页"通知
  useEffect(() => {
    window.electronAPI.onNavigateReflection(() => {
      setShowReflection(true)
    })
  }, [])

  // 跨天检测：app 开着到了第二天 → 自动切日期
  useEffect(() => {
    const timer = setInterval(() => {
      if (isWidgetMode) return
      const today = getToday()
      setCurrentDate((prev: string) => {
        if (prev !== today) {
          console.log(`[DayChange] 检测到日期变化：${prev} → ${today}，自动切换`)
          return today
        }
        return prev
      })
    }, 60_000)
    return () => clearInterval(timer)
  }, [isWidgetMode, setCurrentDate])

  // 主界面 → 待命 widget
  const handleEnterStandby = () => {
    window.electronAPI.enterWidget()
    setIsWidgetMode(true)
    setIsStandbyMode(true)
  }

  // 待命 widget → 展开为主界面
  const handleExpandFromStandby = () => {
    window.electronAPI.exitWidget()
    setIsWidgetMode(false)
    setIsStandbyMode(false)
  }

  return {
    isStandbyMode, setIsStandbyMode,
    showReflection, setShowReflection,
    handleEnterStandby, handleExpandFromStandby,
  }
}
