/// <reference types="vite/client" />

/**
 * 声明 window.electronAPI 的类型
 * 这样 TypeScript 就知道我们在 preload 中暴露的 API 有哪些方法
 */
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
    // 托盘通信
    updateTrayCount: (count: number) => void
    onWidgetEnter: (cb: () => void) => void
    onWidgetExit:  (cb: () => void) => void
  }
}
