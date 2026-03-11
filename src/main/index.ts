import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, net, Notification, powerMonitor } from 'electron'
import { join } from 'path'
import fs from 'fs'

// ===================== 数据存储相关 =====================

const getDataPath = (): string => join(app.getPath('userData'), 'tasks.json')
const getAIConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')
const getProfilePath = (): string => join(app.getPath('userData'), 'profile.json')

function loadAIConfig(): Record<string, string> {
  try {
    const p = getAIConfigPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadAIConfig]', e) }
  return {}
}

function saveAIConfig(config: Record<string, string>): boolean {
  try {
    fs.writeFileSync(getAIConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('[saveAIConfig]', e); return false }
}

function loadTasks(): unknown[] {
  try {
    const p = getDataPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadTasks]', e) }
  return []
}

function saveTasks(tasks: unknown[]): boolean {
  try {
    fs.writeFileSync(getDataPath(), JSON.stringify(tasks, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('[saveTasks]', e); return false }
}

// ===================== 用户个人资料存储 =====================

function loadProfile(): Record<string, unknown> {
  try {
    const p = getProfilePath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadProfile]', e) }
  return {}
}

function saveProfile(profile: Record<string, unknown>): boolean {
  try {
    fs.writeFileSync(getProfilePath(), JSON.stringify(profile, null, 2), 'utf-8')
    return true
  } catch (e) { console.error('[saveProfile]', e); return false }
}

// ===================== 活跃度采样数据存储 =====================

/** 活跃度记录：每 30 秒聚合一条 */
interface ActivityRecord {
  /** Unix 时间戳（ms） */
  ts: number
  /** 采样时刻的系统空闲时间（秒） */
  idle: number
  /** 该 30 秒窗口内活跃采样次数（idle 小于阈值） */
  activeSamples: number
  /** 该 30 秒窗口内总采样次数 */
  totalSamples: number
  /** 该 30 秒窗口内的活跃时间占比，范围 0-1 */
  activeRatio: number
}

/** 获取某天的活跃度数据文件路径，如 activity-2026-03-11.json */
const getActivityPath = (date: string): string =>
  join(app.getPath('userData'), `activity-${date}.json`)

/** 追加活跃度记录到指定日期的文件 */
function appendActivityRecords(date: string, records: ActivityRecord[]): boolean {
  try {
    const p = getActivityPath(date)
    let existing: ActivityRecord[] = []
    if (fs.existsSync(p)) {
      existing = JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
    const merged = [...existing, ...records]
    fs.writeFileSync(p, JSON.stringify(merged), 'utf-8') // 不缩进，节省磁盘
    return true
  } catch (e) {
    console.error('[Activity] 追加记录失败:', e)
    return false
  }
}

/** 兼容旧版 inputs 记录，统一归一化为 activeRatio 结构 */
function normalizeActivityRecord(raw: unknown): ActivityRecord | null {
  if (!raw || typeof raw !== 'object') return null

  const r = raw as Record<string, unknown>
  if (typeof r.ts !== 'number' || typeof r.idle !== 'number') return null

  if (
    typeof r.activeSamples === 'number' &&
    typeof r.totalSamples === 'number' &&
    typeof r.activeRatio === 'number'
  ) {
    return {
      ts: r.ts,
      idle: r.idle,
      activeSamples: r.activeSamples,
      totalSamples: r.totalSamples,
      activeRatio: r.activeRatio,
    }
  }

  // 旧版数据只有 inputs。这里用一个保守的近似映射，避免历史数据直接消失。
  const legacyInputs = typeof r.inputs === 'number' ? r.inputs : 0
  const approxRatio = Math.max(0, Math.min(legacyInputs / 4, 1))
  const totalSamples = 15
  const activeSamples = Math.round(approxRatio * totalSamples)

  return {
    ts: r.ts,
    idle: r.idle,
    activeSamples,
    totalSamples,
    activeRatio: approxRatio,
  }
}

/** 读取指定日期的所有活跃度记录 */
function loadActivityData(date: string): ActivityRecord[] {
  try {
    const p = getActivityPath(date)
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown[]
      return raw.map(normalizeActivityRecord).filter((r): r is ActivityRecord => r !== null)
    }
  } catch (e) { console.error('[Activity] 读取数据失败:', e) }
  return []
}

// ===================== 行为追踪数据存储 =====================

/** 获取某天的追踪日志文件路径，如 tracker-2026-02-21.json */
const getTrackerPath = (date: string): string =>
  join(app.getPath('userData'), `tracker-${date}.json`)

/**
 * 追加事件到指定日期的日志文件
 * 采用"读取→合并→写入"策略，保证幂等性
 */
function appendTrackerEvents(date: string, events: unknown[]): boolean {
  try {
    const p = getTrackerPath(date)
    let existing: unknown[] = []
    if (fs.existsSync(p)) {
      existing = JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
    const merged = [...existing, ...events]
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('[Tracker] 追加事件失败:', e)
    return false
  }
}

/**
 * 读取指定日期的所有事件
 */
function loadTrackerEvents(date: string): unknown[] {
  try {
    const p = getTrackerPath(date)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[Tracker] 读取事件失败:', e) }
  return []
}

// ===================== 窗口尺寸常量 =====================

const MAIN_WIDTH  = 480
const MAIN_HEIGHT = 680
const WIDGET_WIDTH  = 380
const WIDGET_HEIGHT = 66

// ===================== 活跃度采样引擎 =====================

/**
 * 高频空闲采样器
 *
 * 原理：
 *   - 每 2 秒读取 powerMonitor.getSystemIdleTime()
 *   - 如果 idle 小于阈值，说明用户刚刚有过操作 → 记为一次活跃采样
 *   - 每 30 秒聚合为一条 ActivityRecord，写入磁盘缓冲
 *   - 每 5 分钟（或缓冲满 20 条）批量持久化到 JSON 文件
 */
const activitySampler = {
  /** 高频采样定时器（2 秒） */
  fastTimer: null as ReturnType<typeof setInterval> | null,
  /** 聚合写入定时器（5 分钟） */
  flushTimer: null as ReturnType<typeof setInterval> | null,

  /** 判定为“活跃”的 idle 阈值（秒） */
  ACTIVE_IDLE_THRESHOLD: 2,
  /** 当前 30 秒窗口内活跃采样次数 */
  activeSamples: 0,
  /** 当前 30 秒窗口内总采样次数 */
  totalSamples: 0,
  /** 当前 30 秒窗口的开始时间 */
  windowStart: Date.now(),
  /** 内存缓冲区 */
  buffer: [] as ActivityRecord[],

  /** 采样间隔（ms） */
  SAMPLE_INTERVAL: 2000,
  /** 聚合窗口大小（ms） */
  WINDOW_SIZE: 30_000,
  /** 磁盘写入间隔（ms） */
  FLUSH_INTERVAL: 5 * 60_000,
  /** 缓冲区满多少条就写入 */
  FLUSH_THRESHOLD: 20,

  /** 启动采样 */
  start(): void {
    this.activeSamples = 0
    this.totalSamples = 0
    this.windowStart = Date.now()

    // 每 2 秒采样一次
    this.fastTimer = setInterval(() => this.sample(), this.SAMPLE_INTERVAL)

    // 每 5 分钟落盘一次
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL)

    console.log('[ActivitySampler] 启动，采样间隔', this.SAMPLE_INTERVAL, 'ms')
  },

  /** 停止采样 */
  stop(): void {
    if (this.fastTimer) { clearInterval(this.fastTimer); this.fastTimer = null }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    this.flush() // 退出前写入残余数据
    console.log('[ActivitySampler] 已停止')
  },

  /** 单次采样（每 2 秒调用） */
  sample(): void {
    const currentIdle = powerMonitor.getSystemIdleTime()

    this.totalSamples++
    // idle 很小，说明用户最近仍在持续操作电脑
    if (currentIdle <= this.ACTIVE_IDLE_THRESHOLD) {
      this.activeSamples++
    }

    // 检查是否到了 30 秒窗口边界
    const now = Date.now()
    if (now - this.windowStart >= this.WINDOW_SIZE) {
      this.aggregate(now, currentIdle)
    }
  },

  /** 聚合一个 30 秒窗口 */
  aggregate(now: number, currentIdle: number): void {
    const activeRatio =
      this.totalSamples > 0 ? this.activeSamples / this.totalSamples : 0

    const record: ActivityRecord = {
      ts: now,
      idle: currentIdle,
      activeSamples: this.activeSamples,
      totalSamples: this.totalSamples,
      activeRatio,
    }
    this.buffer.push(record)

    // 重置窗口
    this.activeSamples = 0
    this.totalSamples = 0
    this.windowStart = now

    // 缓冲区满就写入
    if (this.buffer.length >= this.FLUSH_THRESHOLD) {
      this.flush()
    }
  },

  /** 强制聚合当前未满的窗口（在 flush 前调用，确保不丢数据） */
  drainCurrentWindow(): void {
    const now = Date.now()
    if (this.totalSamples > 0) {
      const currentIdle = powerMonitor.getSystemIdleTime()
      this.aggregate(now, currentIdle)
    }
  },

  /** 批量写入磁盘 */
  flush(): void {
    // 先把当前未满窗口也聚合进来
    this.drainCurrentWindow()

    if (this.buffer.length === 0) return

    const records = [...this.buffer]
    this.buffer = []

    // 按日期分组
    const byDate = new Map<string, ActivityRecord[]>()
    for (const r of records) {
      const d = new Date(r.ts)
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const list = byDate.get(dateStr) || []
      list.push(r)
      byDate.set(dateStr, list)
    }

    for (const [date, recs] of byDate) {
      if (!appendActivityRecords(date, recs)) {
        // 写入失败 → 放回缓冲区
        this.buffer.push(...recs)
      }
    }
  },
}

// ===================== 全局状态 =====================

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isWidgetMode = false
let pendingCount = 0   // 当前待办任务数（用于更新托盘提示）
let forceQuit = false  // 标记是否真正退出（区分"关闭"和"退出"）

// ===================== 每日反思提醒 =====================

let cachedReflectionTime: string | null = null  // 缓存的提醒时间（如 "21:30"）
let lastNotifiedDate: string | null = null      // 上次提醒的日期（防止同一天重复提醒）
let reflectionTimer: ReturnType<typeof setInterval> | null = null  // 定时器引用

/** 获取当前日期字符串，如 "2026-02-26" */
function getTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 获取当前时间字符串，如 "21:30" */
function getNowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 显示主窗口并通知前端打开反思页面
 * 如果在小组件模式会先退出小组件
 */
function showReflectionView(): void {
  if (!mainWindow) return
  // 如果在小组件模式，先退出
  if (isWidgetMode) {
    exitWidget()
    mainWindow.webContents.send('widget:exit')
  }
  // 显示并聚焦窗口
  mainWindow.show()
  mainWindow.focus()
  updateTrayMenu()
  // 通知前端打开反思页面
  mainWindow.webContents.send('navigate:reflection')
}

/** 每分钟检查一次是否到了反思提醒时间 */
function checkReflectionTime(): void {
  if (!cachedReflectionTime) return
  const today = getTodayStr()
  const now = getNowHHMM()
  // 今天已经提醒过了，跳过
  if (lastNotifiedDate === today) return
  // 时间匹配！
  if (now === cachedReflectionTime) {
    lastNotifiedDate = today
    // 发送系统通知
    const notification = new Notification({
      title: '🌙 该反思了',
      body: '今天辛苦了，花几分钟回顾一下吧',
      silent: false,
    })
    // 用户点击通知 → 打开反思页面
    notification.on('click', () => showReflectionView())
    notification.show()
  }
}

/** 启动反思提醒定时器（每 30 秒检查一次） */
function startReflectionTimer(): void {
  // 先清理旧定时器
  if (reflectionTimer) clearInterval(reflectionTimer)
  // 从 profile 读取提醒时间
  const profile = loadProfile()
  cachedReflectionTime = profile.reflectionTime ? String(profile.reflectionTime) : null
  if (!cachedReflectionTime) {
    reflectionTimer = null
    return
  }
  // 立即检查一次，然后每 30 秒检查
  checkReflectionTime()
  reflectionTimer = setInterval(checkReflectionTime, 30_000)
}

// ===================== 小组件位置记忆 =====================

const getWidgetPosPath = (): string => join(app.getPath('userData'), 'widget-pos.json')

function loadWidgetPos(): { x: number; y: number } | null {
  try {
    const p = getWidgetPosPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { /* 忽略 */ }
  return null
}

function saveWidgetPos(x: number, y: number): void {
  try { fs.writeFileSync(getWidgetPosPath(), JSON.stringify({ x, y }), 'utf-8') }
  catch { /* 忽略 */ }
}

// ===================== 托盘图标（32×32 PNG，任务清单样式）=====================

/**
 * 用纯像素数据生成托盘图标
 * 紫色圆角背景 + 白色勾选符号
 */
function buildTrayIcon(): Electron.NativeImage {
  // 一个 16×16 的简洁 PNG（indigo 背景 + 白色 ✓）
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAB' +
    'AElEQVR4nO2WMQrCQBBFZ9cj6Bm8gCdhwMJCsLGwt/EAFnoCL2BhIXgCCwsLwcLCQrC2sLDY' +
    '2VhY2FgEQf8gIYSQkJA3mQlhd3d2Z/5/dxJCCCGEEEIIIYQQQgghhBBC/jVJkrRVVe29956q' +
    'qqrqvffee++99957773333vvvffee++99957773333vvvffee++99957773333vvvffee++99957' +
    '773333vvvffee++99957773333vvvffee++99957773333vvvffee++99957773333vvvffee++9' +
    '9957773333vvvffee++99957773333vvvffee++99957773333vvvffee++99957773333vvvffe' +
    'e++9RQghJABeP3UBMgAAAABJRU5ErkJggg=='
  )
}

// ===================== 创建主窗口 =====================

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    show: false,
    frame: false,
    resizable: true,   // ★ 必须为 true，否则 Windows 系统最小高度限制会阻止 setSize() 缩小到 44px
    transparent: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // ★ 关键改动：点「×」关闭时不退出，而是隐藏到托盘
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()       // 阻止真正关闭
      mainWindow?.hide()       // 隐藏到托盘
      updateTrayMenu()         // 更新菜单显示"显示窗口"
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ===================== 系统托盘 =====================

/** 刷新托盘右键菜单（窗口显示/隐藏状态变化时调用）*/
function updateTrayMenu(): void {
  if (!tray) return

  const isVisible = mainWindow?.isVisible() ?? false
  const isAutoStart = app.getLoginItemSettings().openAtLogin

  const menu = Menu.buildFromTemplate([
    // 第一行：显示当前任务数量（不可点击，只作提示）
    {
      label: pendingCount > 0 ? `📋 待办任务：${pendingCount} 项` : '✅ 所有任务已完成',
      enabled: false,
    },
    { type: 'separator' },

    // 显示/隐藏主窗口
    {
      label: isVisible ? '隐藏主窗口' : '显示主窗口',
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow?.show()
          mainWindow?.focus()
          // 如果在小组件模式，先退出小组件
          if (isWidgetMode) exitWidget()
        }
        updateTrayMenu()
      },
    },

    // 切换小组件模式
    {
      label: isWidgetMode ? '退出小组件模式' : '切换为小组件置顶',
      click: () => {
        if (isWidgetMode) {
          exitWidget()
          mainWindow?.webContents.send('widget:exit') // 通知前端切换 UI
        } else {
          enterWidget()
          mainWindow?.webContents.send('widget:enter') // 通知前端切换 UI
        }
        updateTrayMenu()
      },
    },

    { type: 'separator' },

    // 开机自启开关
    {
      label: isAutoStart ? '✓ 开机自动启动' : '开机自动启动',
      click: () => {
        const newValue = !isAutoStart
        app.setLoginItemSettings({ openAtLogin: newValue })
        updateTrayMenu() // 立刻更新菜单勾选状态
      },
    },

    { type: 'separator' },

    // 退出
    {
      label: '退出应用',
      click: () => {
        forceQuit = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
  // 托盘悬停提示也同步更新
  tray.setToolTip(
    pendingCount > 0 ? `任务管理器 · ${pendingCount} 项待办` : '任务管理器 · 全部完成 🎉'
  )
}

function createTray(): void {
  // 尝试加载 resources 目录的图标，否则用内置图标
  let icon: Electron.NativeImage
  const iconPath = join(__dirname, '../../resources/icon.png')
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } else {
    icon = buildTrayIcon()
  }

  tray = new Tray(icon)
  updateTrayMenu()

  // 双击托盘图标：显示/隐藏主窗口
  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
    updateTrayMenu()
  })
}

// ===================== 小组件模式核心逻辑 =====================

function onWidgetMoved(): void {
  if (!mainWindow || !isWidgetMode) return
  const [x, y] = mainWindow.getPosition()
  saveWidgetPos(x, y)
}

function enterWidget(): void {
  if (!mainWindow || isWidgetMode) return
  isWidgetMode = true

  const { screen } = require('electron')
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize
  const saved = loadWidgetPos()
  const x = saved ? saved.x : Math.round((sw - WIDGET_WIDTH) / 2)
  const y = saved ? saved.y : 8

  mainWindow.setMinimumSize(WIDGET_WIDTH, WIDGET_HEIGHT)
  mainWindow.setMaximumSize(WIDGET_WIDTH, WIDGET_HEIGHT)  // 固定小组件大小，防止用户拖拽缩放
  mainWindow.setAlwaysOnTop(true, 'floating')
  mainWindow.setVisibleOnAllWorkspaces(true)
  mainWindow.setSize(WIDGET_WIDTH, WIDGET_HEIGHT)
  mainWindow.setPosition(x, y)
  mainWindow.show()
  mainWindow.on('moved', onWidgetMoved)
}

function exitWidget(): void {
  if (!mainWindow || !isWidgetMode) return
  isWidgetMode = false

  const [cx, cy] = mainWindow.getPosition()
  saveWidgetPos(cx, cy)
  mainWindow.off('moved', onWidgetMoved)

  const { screen } = require('electron')
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  mainWindow.setMaximumSize(0, 0)    // 0,0 表示取消最大尺寸限制
  mainWindow.setMinimumSize(MAIN_WIDTH, MAIN_HEIGHT)
  mainWindow.setAlwaysOnTop(false)
  mainWindow.setVisibleOnAllWorkspaces(false)
  mainWindow.setSize(MAIN_WIDTH, MAIN_HEIGHT)
  mainWindow.setPosition(Math.round((sw - MAIN_WIDTH) / 2), Math.round((sh - MAIN_HEIGHT) / 2))
}

// ===================== IPC 通信 =====================

function setupIPC(): void {
  ipcMain.handle('tasks:load', () => loadTasks())

  ipcMain.handle('tasks:save', (_, tasks: unknown[]) => saveTasks(tasks))

  // 前端同步待办数量，用于更新托盘提示
  ipcMain.on('tray:updateCount', (_, count: number) => {
    pendingCount = count
    updateTrayMenu()
  })

  // 渲染进程启动时查询当前窗口模式（解决睡眠唤醒后状态不同步）
  ipcMain.handle('window:getMode', () => ({ isWidgetMode }))

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:hide',     () => { mainWindow?.hide(); updateTrayMenu() })
  ipcMain.on('window:quit',     () => { forceQuit = true; app.quit() })

  ipcMain.on('window:enterWidget', () => { enterWidget(); updateTrayMenu() })
  ipcMain.on('window:exitWidget',  () => { exitWidget();  updateTrayMenu() })

  // -------- 小组件动态调整大小 --------
  ipcMain.on('window:resizeWidget', (_, width: number, height: number) => {
    if (!mainWindow || !isWidgetMode) return
    mainWindow.setMinimumSize(width, height)
    mainWindow.setMaximumSize(width, height)
    mainWindow.setSize(width, height)
  })

  // -------- 主窗口动态调整大小（反思侧边栏展开/收起） --------
  ipcMain.on('window:resizeMain', (_, width: number, height: number) => {
    if (!mainWindow || isWidgetMode) return
    const [, curH] = mainWindow.getSize()
    // 左边缘不动，向右侧扩展/收缩
    mainWindow.setMinimumSize(Math.min(width, MAIN_WIDTH), MAIN_HEIGHT)
    mainWindow.setSize(width, height || curH)
  })

  // -------- 用户个人资料 --------
  ipcMain.handle('profile:load', () => loadProfile())
  ipcMain.handle('profile:save', (_, profile: Record<string, unknown>) => {
    const result = saveProfile(profile)
    // 保存后同步更新反思提醒定时器（用户可能改了提醒时间）
    startReflectionTimer()
    return result
  })

  // -------- AI 配置 --------
  ipcMain.handle('ai:loadConfig', () => loadAIConfig())
  ipcMain.handle('ai:saveConfig', (_, config: Record<string, string>) => saveAIConfig(config))

  // -------- AI 请求代理（绕过 CORS） --------
  ipcMain.handle('ai:request', async (_, payload: { url: string; apiKey: string; body: string }) => {
    try {
      const resp = await net.fetch(payload.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${payload.apiKey}`,
        },
        body: payload.body,
      })

      const text = await resp.text()

      if (!resp.ok) {
        return { ok: false, status: resp.status, body: text }
      }
      return { ok: true, status: resp.status, body: text }
    } catch (e) {
      return { ok: false, status: 0, body: String(e) }
    }
  })

  // -------- 行为追踪数据 --------
  ipcMain.handle('tracker:append', (_, date: string, events: unknown[]) =>
    appendTrackerEvents(date, events))
  ipcMain.handle('tracker:load', (_, date: string) =>
    loadTrackerEvents(date))

  // -------- 活跃度数据 --------
  /** 先把内存缓冲区 flush 到磁盘，再读取 → 保证数据最新 */
  ipcMain.handle('activity:load', (_, date: string) => {
    activitySampler.flush()
    return loadActivityData(date)
  })
}

// ===================== 应用生命周期 =====================

app.whenReady().then(() => {
  app.setAppUserModelId('com.taskmanager.app')
  setupIPC()
  createMainWindow()
  createTray()
  // 启动每日反思提醒定时器
  startReflectionTimer()

  // 启动活跃度采样
  activitySampler.start()

  // ---- 系统唤醒后重新同步窗口状态 ----
  powerMonitor.on('resume', () => {
    if (!mainWindow) return
    if (isWidgetMode) {
      // ★ 只恢复置顶和可见性，不强制重置尺寸
      // 因为 FocusDynamicBar 有自己的 phase 尺寸管理（executing=66, relay=自适应, stuck=340）
      // 强制锁死 380×66 会导致 relay/stuck 面板被截断
      mainWindow.setAlwaysOnTop(true, 'floating')
      mainWindow.show()
    }
    // 通知渲染进程重新同步模式（触发前端 session 恢复）
    mainWindow.webContents.send('window:modeSync', { isWidgetMode })
  })

  // ---- 锁屏解锁后也同步一次（Windows 按电源键可能只锁屏不睡眠） ----
  powerMonitor.on('unlock-screen', () => {
    if (!mainWindow) return
    if (isWidgetMode) {
      mainWindow.setAlwaysOnTop(true, 'floating')
      mainWindow.show()
    }
    mainWindow.webContents.send('window:modeSync', { isWidgetMode })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// 退出前停止活跃度采样，确保数据落盘
app.on('before-quit', () => {
  activitySampler.stop()
})

// 所有窗口关闭时：只有 forceQuit=true 才真正退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && forceQuit) {
    app.quit()
  }
})
