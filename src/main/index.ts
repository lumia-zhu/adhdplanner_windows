import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, net, Notification, powerMonitor, screen } from 'electron'
import { join } from 'path'
import fs from 'fs'
import os from 'os'

// ===================== 安全写入工具 =====================

/**
 * 原子写入 JSON：先写临时文件 → fsync 确保落盘 → rename 覆盖目标。
 * rename 在同一磁盘分区上是原子操作，断电/崩溃时不会产生半截文件。
 */
function safeWriteJSON(filePath: string, data: unknown, pretty = true): void {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
  const tmpPath = filePath + '.tmp'
  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeSync(fd, content, undefined, 'utf-8')
    fs.fdatasyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmpPath, filePath)
}

// ===================== 全局异常兜底（防止闪退） =====================

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason)
})

// ===================== Chromium flags (must be set before app.whenReady) =====================

// Disable GPU shader disk cache to avoid "Unable to create cache" errors on Windows
// Our app doesn't need heavy 3D rendering, so shader caching is unnecessary
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// ===================== Single Instance Lock =====================

// Ensure only one instance of the app is running at a time
// This prevents cache file conflicts when multiple processes try to access the same data
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Another instance is already running → quit this one immediately
  app.quit()
}

// ===================== 数据存储相关 =====================

const getAIConfigPath = (): string => join(app.getPath('userData'), 'ai-config.json')
const getProfilePath = (): string => join(app.getPath('userData'), 'profile.json')

/** 旧版单文件路径（用于一次性迁移） */
const getLegacyTasksPath = (): string => join(app.getPath('userData'), 'tasks.json')

/** 按日期的任务文件路径，如 tasks-2026-03-13.json */
const getDailyTasksPath = (date: string): string =>
  join(app.getPath('userData'), `tasks-${date}.json`)

/** 反思聊天记录路径，如 reflection-2026-03-20.json 或 reflection-week-2026-03-20.json */
const getReflectionChatPath = (key: string): string =>
  join(app.getPath('userData'), `reflection-${key}.json`)

/**
 * 一次性迁移：如果旧的 tasks.json 存在，把内容写入今天的每日文件，然后重命名旧文件为备份。
 * 这样老用户升级后不会丢数据。
 */
function migrateTasksIfNeeded(): void {
  const legacyPath = getLegacyTasksPath()
  if (!fs.existsSync(legacyPath)) return

  try {
    const data = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
    if (Array.isArray(data) && data.length > 0) {
      const today = getTodayStr()
      const todayPath = getDailyTasksPath(today)
      // 只在今天的文件不存在时才迁移（避免重复）
      if (!fs.existsSync(todayPath)) {
        safeWriteJSON(todayPath, data)
        console.log(`[Migration] Migrated tasks.json (${data.length} items) to tasks-${today}.json`)
      }
    }
    // 重命名旧文件为备份
    const backupPath = legacyPath + '.bak'
    if (!fs.existsSync(backupPath)) {
      fs.renameSync(legacyPath, backupPath)
      console.log('[Migration] Old tasks.json backed up as tasks.json.bak')
    }
  } catch (e) {
    console.error('[Migration] Migration failed:', e)
  }
}

function loadAIConfig(): Record<string, string> {
  try {
    const p = getAIConfigPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadAIConfig]', e) }
  return {}
}

function saveAIConfig(config: Record<string, string>): boolean {
  try {
    safeWriteJSON(getAIConfigPath(), config)
    return true
  } catch (e) { console.error('[saveAIConfig]', e); return false }
}

/** 加载指定日期的任务列表 */
function loadTasks(date: string): unknown[] {
  try {
    const p = getDailyTasksPath(date)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadTasks]', e) }
  return []
}

/** 保存任务列表到指定日期的文件 */
function saveTasks(date: string, tasks: unknown[]): boolean {
  try {
    safeWriteJSON(getDailyTasksPath(date), tasks)
    return true
  } catch (e) { console.error('[saveTasks]', e); return false }
}

/**
 * 扫描最近 N 天，找到有未完成任务的最近日期。
 * 返回 { fromDate, tasks } 或 null（没有可搬迁的任务）。
 * 接口设计为通用的：将来上云只需替换扫描逻辑。
 */
function findCarryOverTasks(today: string): { fromDate: string; tasks: unknown[] } | null {
  const SCAN_DAYS = 7  // 最多往前扫 7 天
  const todayDate = new Date(today + 'T00:00:00')

  for (let i = 1; i <= SCAN_DAYS; i++) {
    const d = new Date(todayDate)
    d.setDate(d.getDate() - i)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    const tasks = loadTasks(dateStr) as Array<Record<string, unknown>>
    const incomplete = tasks.filter(t => !t.completed)
    if (incomplete.length > 0) {
      return { fromDate: dateStr, tasks: incomplete }
    }
  }
  return null
}

/**
 * 执行搬迁：把指定日期的未完成任务复制到今天的文件中。
 * - 生成新的 id（避免冲突）
 * - 添加 carriedFrom 标记（方便 UI 显示来源）
 * - 清空 pausedSession（跨天的暂停状态没意义）
 * - 不修改源文件（保留历史记录完整性）
 */
function executeCarryOver(fromDate: string, taskIds: string[], today: string): boolean {
  try {
    const sourceTasks = loadTasks(fromDate) as Array<Record<string, unknown>>
    const todayTasks = loadTasks(today) as Array<Record<string, unknown>>

    // 用 title 集合去重，避免重复搬迁
    const existingTitles = new Set(todayTasks.map(t => String(t.title || '')))

    const toCarry = sourceTasks.filter(t =>
      !t.completed && taskIds.includes(String(t.id))
    )

    let addedCount = 0
    for (const task of toCarry) {
      if (existingTitles.has(String(task.title || ''))) continue  // 标题重复则跳过

      const newTask = {
        ...task,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        carriedFrom: fromDate,
        pausedSession: null,   // 跨天的暂停状态清空
        createdAt: Date.now(), // 重置创建时间为今天
      }
      todayTasks.push(newTask)
      existingTitles.add(String(task.title || ''))
      addedCount++
    }

    if (addedCount > 0) {
      saveTasks(today, todayTasks)
      console.log(`[CarryOver] Carried over ${addedCount} tasks from ${fromDate} to ${today}`)
    }
    return true
  } catch (e) {
    console.error('[CarryOver] Carry-over failed:', e)
    return false
  }
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
    safeWriteJSON(getProfilePath(), profile)
    return true
  } catch (e) { console.error('[saveProfile]', e); return false }
}

// ===================== 活跃度采样数据存储 =====================

/** 使用时长记录：每 30 秒聚合一条 */
interface ActivityRecord {
  /** Unix 时间戳（ms） */
  ts: number
  /** 采样时刻的系统空闲时间（秒） */
  idle: number
  /** 该 30 秒窗口内"使用中"采样次数（idle ≤ 60 秒） */
  activeSamples: number
  /** 该 30 秒窗口内总采样次数 */
  totalSamples: number
  /** 该 30 秒窗口内的使用时间占比，范围 0-1（1 分钟无操作 → 未使用） */
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
    safeWriteJSON(p, merged, false) // 不缩进，节省磁盘
    return true
  } catch (e) {
    console.error('[Activity] Failed to append records:', e)
    return false
  }
}

/** 兼容旧版 inputs 记录，统一归一化为 activeRatio（使用占比）结构 */
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
  } catch (e) { console.error('[Activity] Failed to load data:', e) }
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
    safeWriteJSON(p, merged)
    return true
  } catch (e) {
    console.error('[Tracker] Failed to append events:', e)
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
  } catch (e) { console.error('[Tracker] Failed to load events:', e) }
  return []
}

// ===================== 窗口尺寸常量 =====================

const MAIN_WIDTH  = 480
const MAIN_HEIGHT = 680
const WIDGET_WIDTH  = 380
const WIDGET_HEIGHT = 66

// ===================== 屏幕自适应缩放 =====================

let uiScale = 1.0

/**
 * 根据主显示器的「逻辑工作区宽度」（已经过系统 DPI 缩放）计算 UI 缩放因子。
 * 小屏 / 低分辨率保持 1.0，大屏高分辨率适度放大，确保文字和控件不会因为
 * 屏幕物理尺寸增大而显得过小。
 */
function computeUIScale(): number {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  if (width <= 1920) return 1.0
  if (width <= 2560) return 1.1
  if (width <= 3200) return 1.2
  return 1.3
}

/** 将设计尺寸乘以 uiScale 并取整 */
function scaled(n: number): number {
  return Math.round(n * uiScale)
}

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

  /**
   * 判定为"使用中"的 idle 阈值（秒）
   * 规则：连续 60 秒无任何键鼠操作 → "未使用"，否则算"使用中"
   */
  ACTIVE_IDLE_THRESHOLD: 60,
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

    console.log('[ActivitySampler] Started, interval', this.SAMPLE_INTERVAL, 'ms')
  },

  /** 停止采样 */
  stop(): void {
    if (this.fastTimer) { clearInterval(this.fastTimer); this.fastTimer = null }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    this.flush() // 退出前写入残余数据
    console.log('[ActivitySampler] Stopped')
  },

  /** 单次采样（每 2 秒调用） */
  sample(): void {
    const currentIdle = powerMonitor.getSystemIdleTime()

    this.totalSamples++
    // idle ≤ 60 秒，说明用户 1 分钟内有过操作 → 算"使用中"
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
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 如果在小组件模式，先退出
  if (isWidgetMode) {
    exitWidget()
    safeWinOp('showReflection:exitWidget', (win) => win.webContents.send('widget:exit'))
  }
  // 显示并聚焦窗口
  safeWinOp('showReflection', (win) => {
    win.show()
    win.focus()
    win.webContents.send('navigate:reflection')
  })
  updateTrayMenu()
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
  try { safeWriteJSON(getWidgetPosPath(), { x, y }) }
  catch (e) { console.error('[saveWidgetPos]', e) }
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
    width: scaled(MAIN_WIDTH),
    height: scaled(MAIN_HEIGHT),
    show: false,
    frame: false,
    resizable: true,   // ★ 必须为 true，否则 Windows 系统最小高度限制会阻止 setSize() 缩小到 44px
    transparent: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.webContents.setZoomFactor(uiScale)
    mainWindow?.show()
  })

  // ★ 渲染进程崩溃自动恢复：重新加载页面而非白屏
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Crash] Render process gone:', details.reason)
    if (mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        mainWindow?.webContents.reload()
        console.log('[Crash] Page reloaded after render-process-gone')
      }, 500)
    }
  })
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[Crash] Renderer unresponsive, reloading...')
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  // ★ 关键改动：点「×」关闭时不退出，而是隐藏到托盘
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()       // 阻止真正关闭
      // ★ 如果在 widget 模式，先退出（停止心跳守护，否则心跳会 3 秒后把窗口拉回来）
      if (isWidgetMode) {
        stopWidgetHeartbeat()
        isWidgetMode = false
        mainWindow?.off('moved', onWidgetMoved)
        mainWindow?.off('minimize', onWidgetMinimize)
        mainWindow?.webContents.send('widget:exit')
      }
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
        safeWinOp('tray:toggleVisible', (win) => {
          if (win.isVisible()) {
            win.hide()
          } else {
            win.show()
            win.focus()
            if (isWidgetMode) exitWidget()
          }
        })
        updateTrayMenu()
      },
    },

    // 切换小组件模式
    {
      label: isWidgetMode ? '退出小组件模式' : '切换为小组件置顶',
      click: () => {
        if (isWidgetMode) {
          exitWidget()
          safeWinOp('tray:exitWidget', (win) => win.webContents.send('widget:exit'))
        } else {
          enterWidget()
          safeWinOp('tray:enterWidget', (win) => win.webContents.send('widget:enter'))
        }
        updateTrayMenu()
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
    safeWinOp('tray:dblclick', (win) => {
      if (win.isVisible()) {
        win.hide()
      } else {
        win.show()
        win.focus()
      }
    })
    updateTrayMenu()
  })
}

// ===================== 小组件模式核心逻辑 =====================

/**
 * 安全窗口操作：所有对 mainWindow 的操作都走这个包装器
 * 防止窗口被销毁后操作抛异常导致后续逻辑全部中断
 */
function safeWinOp(label: string, fn: (win: BrowserWindow) => void): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      fn(mainWindow)
    }
  } catch (e) {
    console.error(`[safeWinOp:${label}]`, e)
  }
}

// ===================== Widget 心跳守护 =====================
// 每 3 秒检查一次：如果处于 widget 模式，确保窗口可见、置顶、在屏幕内
// 防止 Windows DWM 重置、Win+D 最小化、系统事件导致 widget 消失

let widgetHeartbeatTimer: ReturnType<typeof setInterval> | null = null

/**
 * 通知渲染进程刷新 -webkit-app-region 拖拽区域
 * ★ Windows/Chromium bug: setAlwaysOnTop / setSize / restore 等操作
 *   会使 Chromium 缓存的拖拽命中区域失效，必须延迟触发重算
 */
function refreshDragRegion(): void {
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('widget:refreshDrag')
    }
  }, 80)
}

function startWidgetHeartbeat(): void {
  stopWidgetHeartbeat()
  widgetHeartbeatTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !isWidgetMode) return

    try {
      // ① 如果被最小化了 → 恢复
      if (mainWindow.isMinimized()) {
        console.log('[Heartbeat] Widget was minimized, restoring')
        mainWindow.restore()
        refreshDragRegion()  // 恢复后刷新拖拽区域
      }

      // ② 如果不可见了 → 重新显示
      if (!mainWindow.isVisible()) {
        console.log('[Heartbeat] Widget not visible, showing')
        mainWindow.show()
        refreshDragRegion()
      }

      // ③ 仅在 alwaysOnTop 真正丢失时才重新设置
      //    ★ 不能无条件调用 setAlwaysOnTop —— Windows/Chromium 会使 -webkit-app-region
      //      的拖拽命中区域缓存失效，导致 widget 完全无法拖动
      if (!mainWindow.isAlwaysOnTop()) {
        console.log('[Heartbeat] alwaysOnTop lost, re-applying')
        mainWindow.setAlwaysOnTop(true, 'floating')
        refreshDragRegion()  // setAlwaysOnTop 后也需要刷新拖拽区域
      }

      // ★ 注意：不在心跳中做 validateWidgetBounds()
      //   边界校验只在 显示器变化/系统唤醒/锁屏解锁 时触发
      //   避免在用户拖拽过程中干扰窗口位置
    } catch (e) {
      console.error('[Heartbeat] Error:', e)
    }
  }, 3000)
}

function stopWidgetHeartbeat(): void {
  if (widgetHeartbeatTimer) {
    clearInterval(widgetHeartbeatTimer)
    widgetHeartbeatTimer = null
  }
}

/**
 * 校验当前 widget 位置是否在可见屏幕范围内
 * 如果不在（比如外接显示器断了），自动重置到主屏幕顶部居中
 */
function validateWidgetBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isWidgetMode) return

  try {
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
    const [x, y] = mainWindow.getPosition()
    const [w, h] = mainWindow.getSize()

    const halfW = Math.round(w / 2)
    if (x < -halfW || x > sw - halfW || y < -10 || y > sh - 10) {
      // 跑到屏幕外了 → 重置到屏幕顶部居中
      const defaultX = Math.round((sw - w) / 2)
      const defaultY = 8
      console.log(`[BoundsCheck] Widget out of screen (${x},${y}), resetting to (${defaultX},${defaultY})`)
      mainWindow.setPosition(defaultX, defaultY)
      saveWidgetPos(defaultX, defaultY)
    }
  } catch (e) {
    console.error('[BoundsCheck] Error:', e)
  }
}

function onWidgetMoved(): void {
  if (!mainWindow || !isWidgetMode) return
  const [x, y] = mainWindow.getPosition()
  saveWidgetPos(x, y)
}

/** widget 模式下拦截最小化：立刻恢复，不让 widget 消失 */
function onWidgetMinimize(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isWidgetMode) return
  // 延迟一帧恢复，避免与系统动画冲突
  setTimeout(() => {
    safeWinOp('anti-minimize', (win) => {
      if (isWidgetMode && win.isMinimized()) {
        win.restore()
        win.setAlwaysOnTop(true, 'floating')
        refreshDragRegion()  // ★ 恢复后刷新拖拽区域
      }
    })
  }, 50)
}

function enterWidget(): void {
  if (!mainWindow || isWidgetMode) return
  isWidgetMode = true

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const saved = loadWidgetPos()

  // ★ 默认位置：屏幕顶部水平居中（用缩放后的实际窗口宽度计算）
  const scaledW = scaled(WIDGET_WIDTH)
  const scaledH = scaled(WIDGET_HEIGHT)
  const defaultX = Math.round((sw - scaledW) / 2)
  const defaultY = 8

  let x = saved ? saved.x : defaultX
  let y = saved ? saved.y : defaultY

  // ★ 边界校验：确保 widget 在可见屏幕范围内（至少露出一半宽度 + 完整高度）
  const halfW = Math.round(scaledW / 2)
  if (x < -halfW || x > sw - halfW || y < 0 || y > sh - scaledH) {
    x = defaultX
    y = defaultY
    saveWidgetPos(x, y)
  }

  // ★ 先放开约束 → 设置新尺寸 → 再锁定，避免 min>max 冲突导致 Windows 上窗口消失
  safeWinOp('enterWidget', (win) => {
    win.setMinimumSize(1, 1)
    win.setMaximumSize(9999, 9999)
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true)
    win.setSize(scaledW, scaledH)
    win.setMinimumSize(scaledW, scaledH)
    win.setMaximumSize(scaledW, scaledH)
    win.setPosition(x, y)
    win.show()
  })

  mainWindow.on('moved', onWidgetMoved)
  mainWindow.on('minimize', onWidgetMinimize)   // ★ 拦截最小化

  // ★ 启动心跳守护
  startWidgetHeartbeat()
}

function exitWidget(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !isWidgetMode) return
  isWidgetMode = false

  // ★ 停止心跳守护
  stopWidgetHeartbeat()

  try {
    const [cx, cy] = mainWindow.getPosition()
    saveWidgetPos(cx, cy)
  } catch { /* 窗口已销毁时忽略 */ }
  mainWindow.off('moved', onWidgetMoved)
  mainWindow.off('minimize', onWidgetMinimize)  // ★ 移除最小化拦截

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  // ★ 先放开约束 → 设置新尺寸 → 再锁定，避免 min>max 冲突
  safeWinOp('exitWidget', (win) => {
    win.setMinimumSize(1, 1)
    win.setMaximumSize(0, 0)    // 0,0 表示取消最大尺寸限制
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(false)
    win.setSize(scaled(MAIN_WIDTH), scaled(MAIN_HEIGHT))
    win.setMinimumSize(scaled(MAIN_WIDTH), scaled(MAIN_HEIGHT))
    win.setPosition(Math.round((sw - scaled(MAIN_WIDTH)) / 2), Math.round((sh - scaled(MAIN_HEIGHT)) / 2))
  })
}

// ===================== IPC 通信 =====================

function setupIPC(): void {
  // -------- 按日期的任务数据操作 --------
  /** 加载指定日期的任务，不传 date 则默认今天 */
  ipcMain.handle('tasks:load', (_, date?: string) => loadTasks(date || getTodayStr()))

  /** 保存任务到指定日期，不传 date 则默认今天 */
  ipcMain.handle('tasks:save', (_, date: string, tasks: unknown[]) => saveTasks(date, tasks))

  /** 查找可搬迁的任务（最近 7 天内的未完成任务） */
  ipcMain.handle('tasks:findCarryOver', (_, today?: string) =>
    findCarryOverTasks(today || getTodayStr()))

  /** 执行搬迁：把指定日期的指定任务复制到今天 */
  ipcMain.handle('tasks:carryOver', (_, fromDate: string, taskIds: string[], today?: string) =>
    executeCarryOver(fromDate, taskIds, today || getTodayStr()))

  // 前端同步待办数量，用于更新托盘提示
  ipcMain.on('tray:updateCount', (_, count: number) => {
    pendingCount = count
    updateTrayMenu()
  })

  // 渲染进程启动时查询当前窗口模式（解决睡眠唤醒后状态不同步）
  // rendererReady: 区分首次启动 vs 页面重载（锁屏后 GPU 重置等）
  let rendererReady = false
  ipcMain.handle('window:getMode', () => {
    const isFirstInit = !rendererReady
    rendererReady = true
    return { isWidgetMode, isFirstInit }
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:hide',     () => { mainWindow?.hide(); updateTrayMenu() })
  ipcMain.on('window:quit',     () => { forceQuit = true; app.quit() })

  ipcMain.on('window:enterWidget', () => { enterWidget(); updateTrayMenu() })
  ipcMain.on('window:exitWidget',  () => { exitWidget();  updateTrayMenu() })

  // -------- 小组件动态调整大小 --------
  ipcMain.on('window:resizeWidget', (_, width: number, height: number) => {
    if (!mainWindow || mainWindow.isDestroyed() || !isWidgetMode) return
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return

    const sw = scaled(width)
    const sh = scaled(height)

    safeWinOp('resizeWidget', (win) => {
      // ★ 先放开约束，再设置新尺寸，最后锁定 —— 避免 min>max 冲突导致 Windows 上窗口消失
      win.setMinimumSize(1, 1)
      win.setMaximumSize(9999, 9999)
      win.setSize(sw, sh)
      win.setMinimumSize(sw, sh)
      win.setMaximumSize(sw, sh)

      // ★ 每次 resize 后都刷新 alwaysOnTop（防止 Windows 在调整大小时丢失置顶）
      win.setAlwaysOnTop(true, 'floating')
    })

    // ★ Workaround: Chromium 在 Windows 上有 bug，-webkit-app-region 的命中区域
    // 在窗口 setSize 后不会自动重算，导致拖不动。这里延迟通知渲染进程刷新。
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('widget:refreshDrag')
      }
    }, 80)

    // ★ 延迟验证窗口可见性（有些 Windows 版本会在 resize 后让窗口消失）
    setTimeout(() => {
      safeWinOp('resizeWidget:verify', (win) => {
        if (isWidgetMode) {
          let needRefresh = false
          if (!win.isVisible()) {
            console.log('[resizeWidget] Window not visible, restoring')
            win.show()
            needRefresh = true
          }
          if (win.isMinimized()) {
            win.restore()
            needRefresh = true
          }
          if (needRefresh) refreshDragRegion()
        }
      })
    }, 200)
  })

  // -------- 主窗口动态调整大小（反思侧边栏展开/收起） --------
  ipcMain.on('window:resizeMain', (_, width: number, height: number) => {
    if (!mainWindow || mainWindow.isDestroyed() || isWidgetMode) return
    if (!Number.isFinite(width) || width < 1) return
    safeWinOp('resizeMain', (win) => {
      const [, curH] = win.getSize()
      const sw = scaled(width)
      const sh = height && Number.isFinite(height) ? scaled(height) : curH
      win.setMinimumSize(Math.min(sw, scaled(MAIN_WIDTH)), scaled(MAIN_HEIGHT))
      win.setSize(sw, sh)
    })
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

  // -------- AI 请求代理（绕过 CORS，30 秒超时） --------
  ipcMain.handle('ai:request', async (_, payload: { url: string; apiKey: string; body: string }) => {
    const AI_TIMEOUT_MS = 30_000
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
    try {
      const resp = await net.fetch(payload.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${payload.apiKey}`,
        },
        body: payload.body,
        signal: controller.signal as AbortSignal,
      })

      const text = await resp.text()

      if (!resp.ok) {
        return { ok: false, status: resp.status, body: text }
      }
      return { ok: true, status: resp.status, body: text }
    } catch (e: unknown) {
      const isTimeout = e instanceof Error && e.name === 'AbortError'
      return {
        ok: false,
        status: 0,
        body: isTimeout ? 'AI 请求超时（30 秒无响应）' : String(e),
      }
    } finally {
      clearTimeout(timer)
    }
  })

  // -------- 行为追踪数据 --------
  ipcMain.handle('tracker:append', (_, date: string, events: unknown[]) =>
    appendTrackerEvents(date, events))
  ipcMain.handle('tracker:load', (_, date: string) =>
    loadTrackerEvents(date))

  // -------- 反思聊天记录 --------
  ipcMain.handle('reflection:save', (_, key: string, data: unknown) => {
    try {
      safeWriteJSON(getReflectionChatPath(key), data)
      return true
    } catch (e) { console.error('[reflection:save]', e); return false }
  })
  ipcMain.handle('reflection:load', (_, key: string) => {
    try {
      const p = getReflectionChatPath(key)
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch (e) { console.error('[reflection:load]', e) }
    return null
  })

  // -------- 活跃度数据 --------
  /** 先把内存缓冲区 flush 到磁盘，再读取 → 保证数据最新 */
  ipcMain.handle('activity:load', (_, date: string) => {
    activitySampler.flush()
    return loadActivityData(date)
  })
}

// ===================== 应用生命周期 =====================

// When a second instance is launched, focus the existing window instead
app.on('second-instance', () => {
  safeWinOp('second-instance', (win) => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
})

app.whenReady().then(() => {
  app.setAppUserModelId('com.taskmanager.app')

  // ★ 正式打包版：强制开机自启动（实验需要持续追踪活跃度）
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  // ★ 一次性迁移：旧版 tasks.json → 按日期的 tasks-YYYY-MM-DD.json
  migrateTasksIfNeeded()

  uiScale = computeUIScale()
  console.log(`[UIScale] workArea=${screen.getPrimaryDisplay().workAreaSize.width}, uiScale=${uiScale}`)

  setupIPC()
  createMainWindow()
  createTray()
  // 启动每日反思提醒定时器
  startReflectionTimer()

  // 启动活跃度采样
  activitySampler.start()

  // ---- 显示器变化时重新校验 widget 位置 ----
  // 比如外接显示器断开，widget 飞到屏幕外
  screen.on('display-removed', () => {
    console.log('[Display] Display removed, validating widget bounds')
    validateWidgetBounds()
  })
  screen.on('display-metrics-changed', () => {
    console.log('[Display] Display metrics changed, validating widget bounds')
    validateWidgetBounds()
  })

  // ---- 系统唤醒后重新同步窗口状态 ----
  powerMonitor.on('resume', () => {
    if (!mainWindow) return
    safeWinOp('resume', (win) => {
      if (isWidgetMode) {
        // ★ 只恢复置顶和可见性，不强制重置尺寸
        // 因为 FocusDynamicBar 有自己的 phase 尺寸管理（executing=66, relay=自适应, stuck=340）
        // 强制锁死 380×66 会导致 relay/stuck 面板被截断
        win.setAlwaysOnTop(true, 'floating')
        if (win.isMinimized()) win.restore()
        win.show()
        refreshDragRegion()  // ★ 唤醒后刷新拖拽区域
        // ★ 唤醒后重启心跳守护（可能因休眠而暂停）
        startWidgetHeartbeat()
      }
      // ★ 重新应用 UI 缩放（Chromium 在休眠/唤醒后可能丢失 zoomFactor）
      win.webContents.setZoomFactor(uiScale)
      // 通知渲染进程重新同步模式（触发前端 session 恢复）
      win.webContents.send('window:modeSync', { isWidgetMode })
    })
    // 唤醒后校验 widget 位置
    validateWidgetBounds()
  })

  // ---- 锁屏解锁后也同步一次（Windows 按电源键可能只锁屏不睡眠） ----
  powerMonitor.on('unlock-screen', () => {
    if (!mainWindow) return
    safeWinOp('unlock-screen', (win) => {
      if (isWidgetMode) {
        win.setAlwaysOnTop(true, 'floating')
        if (win.isMinimized()) win.restore()
        win.show()
        refreshDragRegion()  // ★ 解锁后刷新拖拽区域
        startWidgetHeartbeat()
      }
      // ★ 重新应用 UI 缩放（锁屏解锁后 Chromium 渲染上下文可能重置）
      win.webContents.setZoomFactor(uiScale)
      // ★ 延迟强制重绘，防止渲染上下文未完全恢复导致白屏
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.invalidate()
          mainWindow.webContents.send('window:modeSync', { isWidgetMode })
        }
      }, 200)
    })
    validateWidgetBounds()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// 退出前停止活跃度采样，确保数据落盘；停止心跳守护
app.on('before-quit', () => {
  stopWidgetHeartbeat()
  activitySampler.stop()
})

// 所有窗口关闭时：只有 forceQuit=true 才真正退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && forceQuit) {
    app.quit()
  }
})
