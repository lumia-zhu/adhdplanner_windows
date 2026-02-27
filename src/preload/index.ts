import { contextBridge, ipcRenderer } from 'electron'

/**
 * 预加载脚本：通过 contextBridge 安全地将 Electron API 暴露给渲染进程（React前端）
 * 就像一个"翻译官"，让前端能安全地使用系统功能
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // -------- 任务数据操作 --------
  /** 从本地文件加载任务列表 */
  loadTasks: (): Promise<unknown[]> => ipcRenderer.invoke('tasks:load'),

  /** 保存任务列表到本地文件 */
  saveTasks: (tasks: unknown[]): Promise<boolean> => ipcRenderer.invoke('tasks:save', tasks),

  // -------- 窗口控制 --------
  /** 最小化窗口到任务栏 */
  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),

  /** 隐藏窗口到系统托盘 */
  hideWindow: (): void => ipcRenderer.send('window:hide'),

  /** 退出应用程序 */
  quitApp: (): void => ipcRenderer.send('window:quit'),

  // -------- 小组件模式 --------
  /** 进入小组件置顶模式（窗口缩小为细长条并置顶） */
  enterWidget: (): void => ipcRenderer.send('window:enterWidget'),

  /** 退出小组件模式（窗口恢复为完整主界面） */
  exitWidget: (): void => ipcRenderer.send('window:exitWidget'),

  // -------- 托盘通信 --------
  /** 同步当前待办数量到托盘提示文字 */
  updateTrayCount: (count: number): void => ipcRenderer.send('tray:updateCount', count),

  /** 动态调整小组件窗口大小（展开/收起接力输入框时用） */
  resizeWidget: (width: number, height: number): void =>
    ipcRenderer.send('window:resizeWidget', width, height),

  /** 动态调整主窗口大小（反思侧边栏展开/收起时用） */
  resizeMainWindow: (width: number, height: number): void =>
    ipcRenderer.send('window:resizeMain', width, height),

  // -------- 用户个人资料 --------
  loadProfile: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('profile:load'),
  saveProfile: (profile: Record<string, unknown>): Promise<boolean> =>
    ipcRenderer.invoke('profile:save', profile),

  // -------- AI 配置 & 请求 --------
  loadAIConfig: (): Promise<Record<string, string>> => ipcRenderer.invoke('ai:loadConfig'),
  saveAIConfig: (config: Record<string, string>): Promise<boolean> =>
    ipcRenderer.invoke('ai:saveConfig', config),

  /** AI 请求代理：在主进程发起 HTTP 请求，绕过浏览器 CORS 限制 */
  aiRequest: (payload: { url: string; apiKey: string; body: string }): Promise<{ ok: boolean; status: number; body: string }> =>
    ipcRenderer.invoke('ai:request', payload),

  /** 托盘点击"切换小组件"时，主进程通知前端切换 UI（监听事件） */
  onWidgetEnter: (cb: () => void): void => { ipcRenderer.on('widget:enter', cb) },
  onWidgetExit:  (cb: () => void): void => { ipcRenderer.on('widget:exit',  cb) },

  /** 主进程通知前端打开每日反思页面（由定时提醒触发） */
  onNavigateReflection: (cb: () => void): void => { ipcRenderer.on('navigate:reflection', cb) },

  // -------- 行为追踪 --------
  /** 追加事件到指定日期的日志文件 */
  appendTrackerEvents: (date: string, events: unknown[]): Promise<boolean> =>
    ipcRenderer.invoke('tracker:append', date, events),
  /** 读取指定日期的所有事件 */
  loadTrackerEvents: (date: string): Promise<unknown[]> =>
    ipcRenderer.invoke('tracker:load', date),
})
