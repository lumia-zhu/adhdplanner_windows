import type { Task } from '../types'
import { PRIORITY_CONFIG } from '../types'
import { triggerEffect } from '../effects'

interface WidgetViewProps {
  tasks: Task[]
  onToggle: (id: string) => void   // 勾选完成任务
  onExit: () => void               // 退出小组件，恢复主界面
}

/**
 * 小组件视图（置顶细长条）
 * 高度固定 44px，宽度 380px，始终悬浮在屏幕顶部
 * 布局：[拖动区] [待办数] [任务列表] [展开按钮] [退出按钮]
 */
export default function WidgetView({ tasks, onToggle, onExit }: WidgetViewProps) {
  // 只取未完成的任务显示
  const pendingTasks = tasks.filter(t => !t.completed)
  // 小组件最多展示 3 条任务，超出显示数量
  const visibleTasks = pendingTasks.slice(0, 3)
  const hiddenCount = pendingTasks.length - visibleTasks.length

  return (
    /**
     * 整个细长条容器
     * drag-region：让整条可被拖动（移动小组件位置）
     * h-11 = 44px，与主进程设置的 WIDGET_HEIGHT 保持一致
     */
    <div className="drag-region w-full h-full flex items-center bg-white border border-gray-200 rounded-xl shadow-lg px-2 gap-1.5 select-none overflow-hidden">

      {/* ===== 左侧：应用图标 + 待办数量角标 ===== */}
      <div className="no-drag flex items-center gap-1.5 flex-shrink-0">
        <div className="relative">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </div>
          {/* 红色角标：显示待办数量 */}
          {pendingTasks.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold leading-none">
              {pendingTasks.length > 9 ? '9+' : pendingTasks.length}
            </span>
          )}
        </div>

        {/* 分割线 */}
        <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
      </div>

      {/* ===== 中间：任务列表（可滚动横向展示）===== */}
      <div className="no-drag flex-1 flex items-center gap-1.5 overflow-hidden">
        {pendingTasks.length === 0 ? (
          /* 全部完成时显示庆祝提示 */
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <span>🎉</span>
            <span>所有任务已完成！</span>
          </span>
        ) : (
          <>
            {/* 展示前3条待办任务 */}
            {visibleTasks.map((task) => (
              <WidgetTaskChip
                key={task.id}
                task={task}
                onToggle={onToggle}
              />
            ))}

            {/* 超出3条时显示剩余数量 */}
            {hiddenCount > 0 && (
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                +{hiddenCount}
              </span>
            )}
          </>
        )}
      </div>

      {/* ===== 右侧：展开（退出小组件）按钮 ===== */}
      <div className="no-drag flex items-center gap-0.5 flex-shrink-0">
        {/* 分割线 */}
        <div className="w-px h-5 bg-gray-200 flex-shrink-0 mr-1" />

        {/* 展开按钮：点击恢复主界面 */}
        <button
          onClick={onExit}
          className="w-7 h-7 rounded-lg hover:bg-indigo-50 flex items-center justify-center text-gray-400 hover:text-indigo-500 transition-colors"
          title="展开主界面"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ===================== 子组件：单条任务胶囊 =====================

interface WidgetTaskChipProps {
  task: Task
  onToggle: (id: string) => void
}

/**
 * 小组件内的任务胶囊
 * 显示优先级色点 + 任务标题，点击左边的圆圈可以勾选完成
 */
function WidgetTaskChip({ task, onToggle }: WidgetTaskChipProps) {
  const dotColor = PRIORITY_CONFIG[task.priority].dot

  return (
    <div className="flex items-center gap-1 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-full px-2 py-1 flex-shrink-0 max-w-[120px] transition-colors group cursor-default">
      {/* 勾选按钮（小圆圈） */}
        <button
          onClick={(e) => {
            onToggle(task.id)
            triggerEffect(e.currentTarget)
          }}
          className="w-3.5 h-3.5 rounded-full border border-gray-300 group-hover:border-indigo-400 flex-shrink-0 flex items-center justify-center transition-colors hover:bg-indigo-50"
          title="标记完成"
        >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      </button>

      {/* 任务标题，超长截断 */}
      <span className="text-xs text-gray-700 truncate">{task.title}</span>
    </div>
  )
}
