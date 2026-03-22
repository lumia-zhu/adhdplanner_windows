import type { BrowserWindow, Tray } from 'electron'

/**
 * 主进程共享可变状态。
 * 所有模块通过 import { S } from './state' 读写。
 * 之所以用对象而非 export let，是因为 CJS 打包不支持 live binding。
 */
export const S = {
  mainWindow: null as BrowserWindow | null,
  tray: null as Tray | null,
  isWidgetMode: false,
  pendingCount: 0,
  forceQuit: false,
  uiScale: 1.0,
  widgetHeartbeatTimer: null as ReturnType<typeof setInterval> | null,
  cachedReflectionTime: null as string | null,
  lastNotifiedDate: null as string | null,
  reflectionTimer: null as ReturnType<typeof setInterval> | null,
  rendererReady: false,
}
