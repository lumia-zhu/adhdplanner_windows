/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    loadTasks: () => Promise<unknown[]>
    saveTasks: (tasks: unknown[]) => Promise<boolean>
    minimizeWindow: () => void
    hideWindow: () => void
    quitApp: () => void
    // 小组件模式
    enterWidget: () => void
    exitWidget: () => void
    resizeWidget: (width: number, height: number) => void
    // 托盘通信
    updateTrayCount: (count: number) => void
    onWidgetEnter: (cb: () => void) => void
    onWidgetExit: (cb: () => void) => void
    // AI 配置 & 请求
    loadAIConfig: () => Promise<Record<string, string>>
    saveAIConfig: (config: Record<string, string>) => Promise<boolean>
    /** AI 请求代理（绕过 CORS） */
    aiRequest: (payload: { url: string; apiKey: string; body: string }) => Promise<{ ok: boolean; status: number; body: string }>
    // 行为追踪
    appendTrackerEvents: (date: string, events: unknown[]) => Promise<boolean>
    loadTrackerEvents: (date: string) => Promise<unknown[]>
  }
}
