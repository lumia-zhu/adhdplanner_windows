import { contextBridge, ipcRenderer } from 'electron'

/**
 * 预加载脚本：通过 contextBridge 安全地将 Electron API 暴露给渲染进程（React前端）
 * 就像一个"翻译官"，让前端能安全地使用系统功能
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // -------- 认证 --------
  /** 注册 */
  authSignUp: (email: string, password: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('auth:signUp', email, password),
  /** 登录 */
  authSignIn: (email: string, password: string): Promise<{ ok: boolean; error?: string; user?: unknown }> =>
    ipcRenderer.invoke('auth:signIn', email, password),
  /** 退出登录 */
  authSignOut: (): Promise<void> => ipcRenderer.invoke('auth:signOut'),
  /** 获取当前登录用户 */
  authGetUser: (): Promise<{ user: unknown | null }> => ipcRenderer.invoke('auth:getUser'),

  // -------- 任务数据操作（按日期存储） --------
  /** 加载指定日期的任务列表（不传 date 则默认今天） */
  loadTasks: (date?: string): Promise<unknown[]> => ipcRenderer.invoke('tasks:load', date),

  /** 保存任务列表到指定日期的文件 */
  saveTasks: (date: string, tasks: unknown[]): Promise<boolean> => ipcRenderer.invoke('tasks:save', date, tasks),

  /** 查找可搬迁的任务（最近 7 天内第一天有未完成任务的，旧版兼容） */
  findCarryOver: (today?: string): Promise<{ fromDate: string; tasks: unknown[] } | null> =>
    ipcRenderer.invoke('tasks:findCarryOver', today),

  /** 查找所有可搬迁的任务（聚合最近 7 天，按日期分组） */
  findAllCarryOver: (today?: string): Promise<{ fromDate: string; tasks: unknown[] }[]> =>
    ipcRenderer.invoke('tasks:findAllCarryOver', today),

  /** 执行搬迁：把指定日期的指定任务复制到今天 */
  carryOverTasks: (fromDate: string, taskIds: string[], today?: string): Promise<boolean> =>
    ipcRenderer.invoke('tasks:carryOver', fromDate, taskIds, today),

  /** 执行多天搬迁：传入 { fromDate → taskIds[] } 映射 */
  multiCarryOverTasks: (dateTaskMap: Record<string, string[]>, today?: string): Promise<boolean> =>
    ipcRenderer.invoke('tasks:multiCarryOver', dateTaskMap, today),

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

  /** AI 流式请求：返回 requestId，后续通过事件接收增量文本 */
  aiRequestStream: (payload: { url: string; apiKey: string; body: string }): Promise<{ requestId: string }> =>
    ipcRenderer.invoke('ai:requestStream', payload),

  /** 监听流式 AI 响应的增量文本 */
  onAIStreamChunk: (cb: (requestId: string, delta: string) => void): void => {
    ipcRenderer.on('ai:stream-chunk', (_, requestId, delta) => cb(requestId, delta))
  },

  /** 监听流式 AI 响应结束 */
  onAIStreamEnd: (cb: (requestId: string) => void): void => {
    ipcRenderer.on('ai:stream-end', (_, requestId) => cb(requestId))
  },

  /** 监听流式 AI 响应错误 */
  onAIStreamError: (cb: (requestId: string, error: string) => void): void => {
    ipcRenderer.on('ai:stream-error', (_, requestId, error) => cb(requestId, error))
  },

  /** 清理所有流式 AI 监听器 */
  offAIStream: (): void => {
    ipcRenderer.removeAllListeners('ai:stream-chunk')
    ipcRenderer.removeAllListeners('ai:stream-end')
    ipcRenderer.removeAllListeners('ai:stream-error')
  },

  /** 查询当前窗口模式（启动时同步状态，解决睡眠唤醒问题） */
  getWindowMode: (): Promise<{ isWidgetMode: boolean }> => ipcRenderer.invoke('window:getMode'),

  /** 托盘点击"切换小组件"时，主进程通知前端切换 UI（监听事件） */
  onWidgetEnter: (cb: () => void): void => { ipcRenderer.on('widget:enter', cb) },
  onWidgetExit:  (cb: () => void): void => { ipcRenderer.on('widget:exit',  cb) },

  /** 系统唤醒后，主进程通知前端重新同步窗口模式 */
  onModeSync: (cb: (data: { isWidgetMode: boolean }) => void): void => {
    ipcRenderer.on('window:modeSync', (_, data) => cb(data))
  },

  /** 主进程通知前端打开每日反思页面（由定时提醒触发） */
  onNavigateReflection: (cb: () => void): void => { ipcRenderer.on('navigate:reflection', cb) },

  // -------- 行为追踪 --------
  /** 追加事件到指定日期的日志文件 */
  appendTrackerEvents: (date: string, events: unknown[]): Promise<boolean> =>
    ipcRenderer.invoke('tracker:append', date, events),
  /** 读取指定日期的所有事件 */
  loadTrackerEvents: (date: string): Promise<unknown[]> =>
    ipcRenderer.invoke('tracker:load', date),

  // -------- 反思聊天记录 --------
  /** 保存反思聊天记录（key 格式: "2026-03-20" 或 "week-2026-03-20"） */
  saveReflectionChat: (key: string, data: unknown): Promise<boolean> =>
    ipcRenderer.invoke('reflection:save', key, data),
  /** 加载反思聊天记录 */
  loadReflectionChat: (key: string): Promise<unknown> =>
    ipcRenderer.invoke('reflection:load', key),

  // -------- 活跃度数据 --------
  /** 读取指定日期的活跃度采样记录 */
  loadActivityData: (date: string): Promise<unknown[]> =>
    ipcRenderer.invoke('activity:load', date),

  // -------- 拖拽区域刷新（Windows Chromium bug workaround） --------
  /** 主进程 resize 后通知前端刷新 drag-region */
  onRefreshDrag: (cb: () => void): void => { ipcRenderer.on('widget:refreshDrag', cb) },
  offRefreshDrag: (cb: () => void): void => { ipcRenderer.removeListener('widget:refreshDrag', cb) },
})
