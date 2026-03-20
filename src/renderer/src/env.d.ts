/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    loadTasks: (date?: string) => Promise<unknown[]>
    saveTasks: (date: string, tasks: unknown[]) => Promise<boolean>
    findCarryOver: (today?: string) => Promise<{ fromDate: string; tasks: unknown[] } | null>
    carryOverTasks: (fromDate: string, taskIds: string[], today?: string) => Promise<boolean>
    minimizeWindow: () => void
    hideWindow: () => void
    quitApp: () => void
    // 小组件模式
    enterWidget: () => void
    exitWidget: () => void
    resizeWidget: (width: number, height: number) => void
    /** 动态调整主窗口大小（反思侧边栏展开/收起） */
    resizeMainWindow: (width: number, height: number) => void
    // 托盘通信
    updateTrayCount: (count: number) => void
    /** 查询当前窗口模式（启动时同步状态） */
    getWindowMode: () => Promise<{ isWidgetMode: boolean }>
    onWidgetEnter: (cb: () => void) => void
    onWidgetExit: (cb: () => void) => void
    /** 系统唤醒后同步窗口模式 */
    onModeSync: (cb: (data: { isWidgetMode: boolean }) => void) => void
    /** 主进程通知打开每日反思页面 */
    onNavigateReflection: (cb: () => void) => void
    // 用户个人资料
    loadProfile: () => Promise<Record<string, unknown>>
    saveProfile: (profile: Record<string, unknown>) => Promise<boolean>
    // AI 配置 & 请求
    loadAIConfig: () => Promise<Record<string, string>>
    saveAIConfig: (config: Record<string, string>) => Promise<boolean>
    /** AI 请求代理（绕过 CORS） */
    aiRequest: (payload: { url: string; apiKey: string; body: string }) => Promise<{ ok: boolean; status: number; body: string }>
    // 行为追踪
    appendTrackerEvents: (date: string, events: unknown[]) => Promise<boolean>
    loadTrackerEvents: (date: string) => Promise<unknown[]>
    // 反思聊天记录
    saveReflectionChat: (key: string, data: unknown) => Promise<boolean>
    loadReflectionChat: (key: string) => Promise<unknown>
    // 活跃度数据
    /** 读取指定日期的活跃度采样记录 */
    loadActivityData: (date: string) => Promise<unknown[]>
    // 拖拽区域刷新（Windows Chromium bug workaround）
    onRefreshDrag: (cb: () => void) => void
    offRefreshDrag: (cb: () => void) => void
  }
}
