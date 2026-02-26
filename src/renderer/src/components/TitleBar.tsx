/**
 * 自定义标题栏组件
 * 因为我们用了无边框窗口，所以需要自己做标题栏
 * 包含：拖动区域、最小化、隐藏到托盘、退出按钮
 */

interface TitleBarProps {
  taskCount: number         // 未完成的任务数量，显示在标题旁边
  onOpenProfile?: () => void    // 打开个人资料设置
  onOpenAISettings?: () => void // 打开 AI 设置面板
  onOpenReflection?: () => void // 打开每日反思页面
  hasProfile?: boolean          // 是否已填写个人资料（用于显示小绿点）
}

export default function TitleBar({ taskCount, onOpenProfile, onOpenAISettings, onOpenReflection, hasProfile }: TitleBarProps) {
  return (
    // drag-region 类让这块区域可以被鼠标拖动来移动窗口
    <div className="drag-region flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 select-none">
      {/* 左侧：应用图标 + 标题 + 任务数量 */}
      <div className="flex items-center gap-2 no-drag">
        <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            />
          </svg>
        </div>
        <span className="font-semibold text-gray-800 text-sm">我的任务</span>
        {taskCount > 0 && (
          <span className="bg-indigo-500 text-white text-xs font-medium px-1.5 py-0.5 rounded-full">
            {taskCount}
          </span>
        )}
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div className="no-drag flex items-center gap-1">
        {/* 个人资料按钮 */}
        {onOpenProfile && (
          <button
            onClick={onOpenProfile}
            className="relative w-7 h-7 rounded-md hover:bg-indigo-50 flex items-center justify-center text-gray-400 hover:text-indigo-500 transition-colors"
            title="个人资料"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            {/* 已填写资料时显示小绿点 */}
            {hasProfile && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-1 ring-white" />
            )}
          </button>
        )}

        {/* 每日反思按钮 */}
        {onOpenReflection && (
          <button
            onClick={onOpenReflection}
            className="w-7 h-7 rounded-md hover:bg-amber-50 flex items-center justify-center text-gray-400 hover:text-amber-500 transition-colors"
            title="每日反思"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
              />
            </svg>
          </button>
        )}

        {/* AI 设置按钮 */}
        {onOpenAISettings && (
          <button
            onClick={onOpenAISettings}
            className="w-7 h-7 rounded-md hover:bg-violet-50 flex items-center justify-center text-gray-400 hover:text-violet-500 transition-colors"
            title="AI 配置"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </button>
        )}

        {/* 分割线 */}
        <div className="w-px h-4 bg-gray-200 mx-0.5" />

        {/* 最小化按钮 */}
        <button
          onClick={() => window.electronAPI.minimizeWindow()}
          className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
          title="最小化"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>

        {/* 隐藏到托盘按钮 */}
        <button
          onClick={() => window.electronAPI.hideWindow()}
          className="w-7 h-7 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
          title="隐藏到托盘"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {/* 退出按钮 */}
        <button
          onClick={() => window.electronAPI.quitApp()}
          className="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center text-gray-500 hover:text-red-500 transition-colors"
          title="退出应用"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
