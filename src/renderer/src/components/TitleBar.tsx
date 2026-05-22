/**
 * 自定义标题栏组件
 * 因为我们用了无边框窗口，所以需要自己做标题栏
 * 包含：拖动区域、设置菜单（个人资料 + AI 配置）、反思、收起为小组件、隐藏到托盘
 */

import { useState, useRef, useEffect } from 'react'

interface TitleBarProps {
  taskCount: number         // 未完成的任务数量，显示在标题旁边
  onOpenProfile?: () => void    // 打开个人资料设置
  onOpenAISettings?: () => void // 打开 AI 设置面板
  onOpenMemory?: () => void     // 打开 AI 记忆管理面板
  onOpenReflection?: () => void // 打开每日反思页面
  onEnterStandby?: () => void   // 收起为待命 widget
  onLogout?: () => void         // 退出登录
  hasProfile?: boolean          // 是否已填写个人资料（用于显示小绿点）
  hasMemory?: boolean           // 是否有记忆数据（用于显示小圆点提示）
}

export default function TitleBar({
  taskCount,
  onOpenProfile, onOpenAISettings, onOpenMemory, onOpenReflection, onEnterStandby, onLogout,
  hasProfile, hasMemory,
}: TitleBarProps) {
  // 设置下拉菜单的开关状态
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [minimizePromptOpen, setMinimizePromptOpen] = useState(false)
  const [hideToastOpen, setHideToastOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const minimizePromptRef = useRef<HTMLDivElement>(null)
  const hideToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const styleId = 'settings-menu-anim'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes settingsMenuFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes titleBarToastInOut {
          0%   { opacity: 0; transform: translateY(-4px); }
          15%  { opacity: 1; transform: translateY(0); }
          85%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 0; transform: translateY(-4px); }
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (hideToastTimerRef.current) clearTimeout(hideToastTimerRef.current)
    }
  }, [])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!settingsOpen && !minimizePromptOpen) return
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
      if (minimizePromptRef.current && !minimizePromptRef.current.contains(e.target as Node)) {
        setMinimizePromptOpen(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [settingsOpen, minimizePromptOpen])

  useEffect(() => {
    if (!minimizePromptOpen) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMinimizePromptOpen(false)
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [minimizePromptOpen])

  const handleMinimize = () => {
    setSettingsOpen(false)
    setMinimizePromptOpen(true)
  }

  const handlePromptStandby = () => {
    setMinimizePromptOpen(false)
    onEnterStandby?.()
  }

  const handleConfirmMinimize = () => {
    setMinimizePromptOpen(false)
    window.electronAPI.minimizeWindow()
  }

  const handleHideToTray = () => {
    setSettingsOpen(false)
    setMinimizePromptOpen(false)
    setHideToastOpen(true)
    if (hideToastTimerRef.current) clearTimeout(hideToastTimerRef.current)
    hideToastTimerRef.current = setTimeout(() => {
      setHideToastOpen(false)
      window.electronAPI.hideWindow()
    }, 850)
  }

  return (
    // drag-region 类让这块区域可以被鼠标拖动来移动窗口
    <div className="drag-region flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 select-none">
      {/* 左侧：应用图标 + 标题 + 任务数量 */}
      <div className="flex items-center gap-2 no-drag">
        <span className="font-semibold text-gray-800 text-sm">我的任务</span>
        {taskCount > 0 && (
          <span className="text-white text-xs font-medium px-1.5 py-0.5 rounded-full bg-emerald-500">
            {taskCount}
          </span>
        )}
      </div>

      {/* 右侧：功能按钮 */}
      <div className="no-drag relative flex items-center gap-1">

        {/* ⚙ 设置按钮（点击弹出下拉菜单：个人资料 + AI 配置） */}
        {(onOpenProfile || onOpenAISettings) && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setSettingsOpen(v => !v)}
              className={`relative w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                settingsOpen
                  ? 'bg-gray-100 text-gray-700'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
              title="设置"
            >
              {/* 齿轮图标 */}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {/* 已填写资料时显示小绿点 */}
              {hasProfile && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-1 ring-white" />
              )}
            </button>

            {/* 下拉菜单 */}
            {settingsOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50"
                style={{ animation: 'settingsMenuFadeIn 0.12s ease-out' }}
              >
                {/* 个人资料 */}
                {onOpenProfile && (
                  <button
                    onClick={() => { setSettingsOpen(false); onOpenProfile() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left
                               text-sm text-gray-600 hover:bg-indigo-50 hover:text-indigo-600
                               transition-colors"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <span>个人资料</span>
                    {hasProfile && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                    )}
                  </button>
                )}

                {/* AI 配置 —— 已预配置，暂时隐藏入口。恢复时取消下方注释即可 */}
                {/* {onOpenAISettings && (
                  <button
                    onClick={() => { setSettingsOpen(false); onOpenAISettings() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left
                               text-sm text-gray-600 hover:bg-violet-50 hover:text-violet-600
                               transition-colors"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <span>AI 配置</span>
                  </button>
                )} */}

                {/* AI 记忆 */}
                {onOpenMemory && (
                  <button
                    onClick={() => { setSettingsOpen(false); onOpenMemory() }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left
                               text-sm text-gray-600 hover:bg-indigo-50 hover:text-indigo-600
                               transition-colors"
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                    <span>AI 记忆</span>
                    {hasMemory && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                    )}
                  </button>
                )}

                {/* 退出登录 */}
                {onLogout && (
                  <>
                    <div className="my-1 border-t border-gray-100" />
                    <button
                      onClick={() => { setSettingsOpen(false); onLogout() }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left
                                 text-sm text-gray-600 hover:bg-red-50 hover:text-red-500
                                 transition-colors"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                      <span>退出登录</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* 分割线 */}
        <div className="w-px h-4 bg-gray-200 mx-0.5" />

        {/* 收起为待命 widget */}
        {onEnterStandby && (
          <button
            onClick={() => {
              setMinimizePromptOpen(false)
              onEnterStandby()
            }}
            className="w-7 h-7 rounded-md hover:bg-emerald-50 flex items-center justify-center text-gray-500 hover:text-emerald-600 transition-colors"
            title="收起为桌面小组件，方便继续记录任务"
            aria-label="收起为桌面小组件，方便继续记录任务"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        )}

        {/* 最小化：先推荐小组件，保留用户控制权 */}
        <div className="relative" ref={minimizePromptRef}>
          <button
            onClick={handleMinimize}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              minimizePromptOpen
                ? 'bg-gray-100 text-gray-700'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
            title="最小化到任务栏"
            aria-label="最小化到任务栏"
            aria-expanded={minimizePromptOpen}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
            </svg>
          </button>

          {minimizePromptOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-lg p-3 z-50"
              style={{ animation: 'settingsMenuFadeIn 0.12s ease-out' }}
            >
              <p className="text-xs leading-5 text-gray-600">
                更推荐收起为桌面小组件，这样还能看到任务，并快速开始记录。
              </p>
              <div className="mt-3 flex items-center justify-end gap-2">
                {onEnterStandby && (
                  <button
                    onClick={handlePromptStandby}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 transition-colors"
                  >
                    收起为小组件
                  </button>
                )}
                <button
                  onClick={handleConfirmMinimize}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                >
                  仍然最小化
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 关闭界面：隐藏到托盘，应用继续在后台记录 */}
        <button
          onClick={handleHideToTray}
          className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors"
          title="隐藏到后台，MetaPlan 会继续运行"
          aria-label="隐藏到后台，MetaPlan 会继续运行"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {hideToastOpen && (
          <div
            className="absolute right-0 top-full mt-2 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-lg z-50"
            style={{ animation: 'titleBarToastInOut 0.85s ease-out both' }}
          >
            已隐藏到后台，任务记录与提醒会继续运行
          </div>
        )}
      </div>
    </div>
  )
}

