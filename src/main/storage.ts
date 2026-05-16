import { app, powerMonitor } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { markDirty } from './sync'

// ===================== 安全写入工具 =====================

export function safeWriteJSON(filePath: string, data: unknown, pretty = true): void {
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

// ===================== 日期工具 =====================

export function getTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getNowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ===================== 用户数据目录 =====================

let userDataDir: string | null = null

/** 切换当前用户的数据目录。传 null 回退到根目录（未登录状态）。 */
export function setUserDataDir(userId: string | null): void {
  if (userId) {
    userDataDir = join(app.getPath('userData'), 'users', userId)
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true })
    }
  } else {
    userDataDir = null
  }
}

/** 获取当前用户的数据根目录 */
export function getUserDir(): string {
  return userDataDir ?? app.getPath('userData')
}

/**
 * 把根目录下的旧数据文件迁移到指定用户目录。
 * 只在用户首次登录时执行一次。
 */
export function migrateRootDataToUser(userId: string): void {
  const rootDir = app.getPath('userData')
  const targetDir = join(rootDir, 'users', userId)

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const markerPath = join(targetDir, '.migrated')
  if (fs.existsSync(markerPath)) return

  try {
    const files = fs.readdirSync(rootDir)
    const dataPatterns = [
      /^tasks-.*\.json$/,
      /^activity-.*\.json$/,
      /^tracker-.*\.json$/,
      /^reflection-.*\.json$/,
      /^profile\.json$/,
      /^moods\.json$/,
      /^ai-config\.json$/,
      /^widget-pos\.json$/,
      /^tasks\.json$/,
      /^tasks\.json\.bak$/,
    ]

    let movedCount = 0
    for (const file of files) {
      if (dataPatterns.some(p => p.test(file))) {
        const src = join(rootDir, file)
        const dst = join(targetDir, file)
        if (!fs.existsSync(dst)) {
          fs.copyFileSync(src, dst)
          movedCount++
        }
      }
    }

    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
    console.log(`[Migration] Moved ${movedCount} data files to user dir: ${userId}`)
  } catch (e) {
    console.error('[Migration] Failed to migrate root data:', e)
  }
}

// ===================== 路径 =====================

const getAIConfigPath = (): string => join(getUserDir(), 'ai-config.json')
const getProfilePath = (): string => join(getUserDir(), 'profile.json')
const getMoodRecordsPath = (): string => join(getUserDir(), 'moods.json')
const getLegacyTasksPath = (): string => join(getUserDir(), 'tasks.json')
const getDailyTasksPath = (date: string): string =>
  join(getUserDir(), `tasks-${date}.json`)
export const getReflectionChatPath = (key: string): string =>
  join(getUserDir(), `reflection-${key}.json`)
const getActivityPath = (date: string): string =>
  join(getUserDir(), `activity-${date}.json`)
const getTrackerPath = (date: string): string =>
  join(getUserDir(), `tracker-${date}.json`)
const getWidgetPosPath = (): string => join(getUserDir(), 'widget-pos.json')

// Memory 相关路径
const getMemoryDir = (): string => {
  const dir = join(getUserDir(), 'memory')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}
const getRawSessionPath = (key: string): string =>
  join(getMemoryDir(), `raw-session-${key}.json`)
const getMemoryStorePath = (): string =>
  join(getMemoryDir(), 'memory.json')
const getAIConversationsDir = (): string => {
  const dir = join(getUserDir(), 'ai-conversations')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}
const getAIConversationPath = (conversationId: string): string =>
  join(getAIConversationsDir(), `${conversationId}.json`)

// ===================== 一次性迁移 =====================

export function migrateTasksIfNeeded(): void {
  const legacyPath = getLegacyTasksPath()
  if (!fs.existsSync(legacyPath)) return

  try {
    const data = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'))
    if (Array.isArray(data) && data.length > 0) {
      const today = getTodayStr()
      const todayPath = getDailyTasksPath(today)
      if (!fs.existsSync(todayPath)) {
        safeWriteJSON(todayPath, data)
        console.log(`[Migration] Migrated tasks.json (${data.length} items) to tasks-${today}.json`)
      }
    }
    const backupPath = legacyPath + '.bak'
    if (!fs.existsSync(backupPath)) {
      fs.renameSync(legacyPath, backupPath)
      console.log('[Migration] Old tasks.json backed up as tasks.json.bak')
    }
  } catch (e) {
    console.error('[Migration] Migration failed:', e)
  }
}

// ===================== AI 配置 =====================

export function loadAIConfig(): Record<string, string> {
  try {
    const p = getAIConfigPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadAIConfig]', e) }
  return {}
}

export function saveAIConfig(config: Record<string, string>): boolean {
  try {
    safeWriteJSON(getAIConfigPath(), config)
    markDirty('aiConfig')
    return true
  } catch (e) { console.error('[saveAIConfig]', e); return false }
}

// ===================== 任务数据 =====================

export function loadTasks(date: string): unknown[] {
  try {
    const p = getDailyTasksPath(date)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadTasks]', e) }
  return []
}

export function saveTasks(date: string, tasks: unknown[]): boolean {
  try {
    safeWriteJSON(getDailyTasksPath(date), tasks)
    markDirty('tasks', date)
    return true
  } catch (e) { console.error('[saveTasks]', e); return false }
}

/**
 * 扫描最近 7 天，聚合所有日期中的未完成任务（旧版兼容接口）。
 * 返回第一天有未完成任务的结果，与旧调用方签名一致。
 */
export function findCarryOverTasks(today: string): { fromDate: string; tasks: unknown[] } | null {
  const result = findAllCarryOverTasks(today)
  if (result.length === 0) return null
  return { fromDate: result[0].fromDate, tasks: result[0].tasks }
}

export interface CarryOverGroup {
  fromDate: string
  tasks: unknown[]
}

/**
 * 扫描最近 7 天，聚合所有日期中的未完成任务。
 * 返回按日期从近到远排列的分组数组。
 */
export function findAllCarryOverTasks(today: string): CarryOverGroup[] {
  const SCAN_DAYS = 7
  const todayDate = new Date(today + 'T00:00:00')
  const groups: CarryOverGroup[] = []

  for (let i = 1; i <= SCAN_DAYS; i++) {
    const d = new Date(todayDate)
    d.setDate(d.getDate() - i)
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    const tasks = loadTasks(dateStr) as Array<Record<string, unknown>>
    const incomplete = tasks.filter(t => !t.completed)
    if (incomplete.length > 0) {
      groups.push({ fromDate: dateStr, tasks: incomplete })
    }
  }
  return groups
}

/**
 * 执行多天搬迁：接受 { fromDate → taskIds[] } 的映射，逐天搬迁。
 */
export function executeMultiCarryOver(
  dateTaskMap: Record<string, string[]>,
  today: string,
): boolean {
  let ok = true
  for (const [fromDate, taskIds] of Object.entries(dateTaskMap)) {
    if (!executeCarryOver(fromDate, taskIds, today)) ok = false
  }
  return ok
}

export function executeCarryOver(fromDate: string, taskIds: string[], today: string): boolean {
  try {
    const sourceTasks = loadTasks(fromDate) as Array<Record<string, unknown>>
    const todayTasks = loadTasks(today) as Array<Record<string, unknown>>

    const existingTitles = new Set(todayTasks.map(t => String(t.title || '')))

    const toCarry = sourceTasks.filter(t =>
      !t.completed && taskIds.includes(String(t.id))
    )

    let addedCount = 0
    for (const task of toCarry) {
      if (existingTitles.has(String(task.title || ''))) continue

      const newTask = {
        ...task,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        carriedFrom: fromDate,
        pausedSession: null,
        createdAt: Date.now(),
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

// ===================== 用户个人资料 =====================

export function loadProfile(): Record<string, unknown> {
  try {
    const p = getProfilePath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadProfile]', e) }
  return {}
}

export function saveProfile(profile: Record<string, unknown>): boolean {
  try {
    safeWriteJSON(getProfilePath(), profile)
    markDirty('profile')
    return true
  } catch (e) { console.error('[saveProfile]', e); return false }
}

// ===================== 每日心情记录 =====================

export interface DailyMoodRecord {
  date: string
  mood: 1 | 2 | 3 | 4 | 5
  note: string
  updatedAt: number
}

export function loadMoodRecords(): Record<string, DailyMoodRecord> {
  try {
    const p = getMoodRecordsPath()
    if (!fs.existsSync(p)) return {}
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: Record<string, DailyMoodRecord> = {}
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      const mood = Number(record.mood)
      if (!date || !Number.isInteger(mood) || mood < 1 || mood > 5) continue
      result[date] = {
        date: String(record.date || date),
        mood: mood as DailyMoodRecord['mood'],
        note: String(record.note || ''),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      }
    }
    return result
  } catch (e) {
    console.error('[loadMoodRecords]', e)
    return {}
  }
}

export function loadMoodRecord(date: string): DailyMoodRecord | null {
  return loadMoodRecords()[date] ?? null
}

export function saveMoodRecord(record: DailyMoodRecord): boolean {
  try {
    const records = loadMoodRecords()
    records[record.date] = {
      date: record.date,
      mood: record.mood,
      note: record.note,
      updatedAt: record.updatedAt,
    }
    safeWriteJSON(getMoodRecordsPath(), records)
    markDirty('moods')
    return true
  } catch (e) {
    console.error('[saveMoodRecord]', e)
    return false
  }
}

// ===================== 活跃度采样数据 =====================

interface ActivityRecord {
  ts: number
  idle: number
  activeSamples: number
  totalSamples: number
  activeRatio: number
  // 此 30 秒窗口里，每个前台应用被采到的次数（次数 × 2 ≈ 秒数）。可选以兼容老数据。
  appUsage?: Record<string, number>
}

// 缓存动态导入的 get-windows 模块；warnedOnce 避免日志刷屏
let getWindowsModule: typeof import('get-windows') | null = null
let getWindowsWarnedOnce = false

// 研究里只关心用户真正投入的应用，排除 MetaPlan 自身和常见系统工具。
const EXCLUDED_APP_NAMES = new Set([
  'electron',
  'metaplan',
  'task-manager',
  '任务管理器',
  'explorer',
  'windows explorer',
  'file explorer',
  '资源管理器',
  'windows terminal',
  'terminal',
  'powershell',
  'windows powershell',
  'command prompt',
  'cmd',
  'conhost',
  'openconsole',
])

function shouldTrackAppName(name: string): boolean {
  return !EXCLUDED_APP_NAMES.has(name.trim().toLowerCase())
}

/** 拿当前前台应用名；任何失败都静默返回 null，不影响主功能 */
async function getActiveAppName(): Promise<string | null> {
  try {
    if (!getWindowsModule) {
      getWindowsModule = await import('get-windows')
    }
    const win = await getWindowsModule.activeWindow()
    const name = win?.owner?.name?.trim()
    return name && name.length > 0 && shouldTrackAppName(name) ? name : null
  } catch (e) {
    if (!getWindowsWarnedOnce) {
      console.warn('[ActivitySampler] get-windows unavailable, app usage will not be tracked:', e)
      getWindowsWarnedOnce = true
    }
    return null
  }
}

export function appendActivityRecords(date: string, records: ActivityRecord[]): boolean {
  try {
    const p = getActivityPath(date)
    let existing: ActivityRecord[] = []
    if (fs.existsSync(p)) {
      existing = JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
    const merged = [...existing, ...records]
    safeWriteJSON(p, merged, false)
    markDirty('activity', date)
    return true
  } catch (e) {
    console.error('[Activity] Failed to append records:', e)
    return false
  }
}

function normalizeAppUsage(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'number' && v > 0) {
      out[k] = v
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeActivityRecord(raw: unknown): ActivityRecord | null {
  if (!raw || typeof raw !== 'object') return null

  const r = raw as Record<string, unknown>
  if (typeof r.ts !== 'number' || typeof r.idle !== 'number') return null

  const appUsage = normalizeAppUsage(r.appUsage)

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
      ...(appUsage ? { appUsage } : {}),
    }
  }

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
    ...(appUsage ? { appUsage } : {}),
  }
}

export function loadActivityData(date: string): ActivityRecord[] {
  try {
    const p = getActivityPath(date)
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown[]
      const records = raw.map(normalizeActivityRecord).filter((r): r is ActivityRecord => r !== null)

      // 按 ts 去重（修复云端同步曾产生的重复数据）
      if (records.length > 0) {
        const seen = new Set<number>()
        const deduped: ActivityRecord[] = []
        for (const r of records) {
          if (!seen.has(r.ts)) {
            seen.add(r.ts)
            deduped.push(r)
          }
        }
        if (deduped.length < records.length) {
          console.log(`[Activity] Deduped ${date}: ${records.length} → ${deduped.length}`)
          safeWriteJSON(p, deduped, false)
          return deduped
        }
      }

      return records
    }
  } catch (e) { console.error('[Activity] Failed to load data:', e) }
  return []
}

// ===================== 活跃度采样引擎 =====================

export const activitySampler = {
  fastTimer: null as ReturnType<typeof setInterval> | null,
  flushTimer: null as ReturnType<typeof setInterval> | null,

  ACTIVE_IDLE_THRESHOLD: 60,
  activeSamples: 0,
  totalSamples: 0,
  windowStart: Date.now(),
  buffer: [] as ActivityRecord[],
  // 当前 30 秒窗口内每个前台应用被采到的次数；aggregate 时清零
  currentWindowApps: new Map<string, number>(),

  SAMPLE_INTERVAL: 2000,
  WINDOW_SIZE: 30_000,
  FLUSH_INTERVAL: 5 * 60_000,
  FLUSH_THRESHOLD: 20,

  start(): void {
    this.activeSamples = 0
    this.totalSamples = 0
    this.windowStart = Date.now()
    this.currentWindowApps.clear()
    this.fastTimer = setInterval(() => this.sample(), this.SAMPLE_INTERVAL)
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_INTERVAL)
    console.log('[ActivitySampler] Started, interval', this.SAMPLE_INTERVAL, 'ms')
  },

  stop(): void {
    if (this.fastTimer) { clearInterval(this.fastTimer); this.fastTimer = null }
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    this.flush()
    console.log('[ActivitySampler] Stopped')
  },

  sample(): void {
    const currentIdle = powerMonitor.getSystemIdleTime()
    this.totalSamples++
    const isActive = currentIdle <= this.ACTIVE_IDLE_THRESHOLD
    if (isActive) {
      this.activeSamples++
    }

    // 仅在「活跃」状态下记录前台应用：避免把屏保/锁屏期间的最后一个应用算进时长
    if (isActive) {
      this.captureAppNameAsync()
    }

    const now = Date.now()
    if (now - this.windowStart >= this.WINDOW_SIZE) {
      this.aggregate(now, currentIdle)
    }
  },

  // fire-and-forget：异步获取前台应用名并累加。失败/慢都不阻塞 sample 主流程
  captureAppNameAsync(): void {
    void getActiveAppName().then((name) => {
      if (name) {
        this.currentWindowApps.set(name, (this.currentWindowApps.get(name) || 0) + 1)
      }
    })
  },

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

    if (this.currentWindowApps.size > 0) {
      const appUsage: Record<string, number> = {}
      for (const [name, count] of this.currentWindowApps) {
        appUsage[name] = count
      }
      record.appUsage = appUsage
    }

    this.buffer.push(record)

    this.activeSamples = 0
    this.totalSamples = 0
    this.windowStart = now
    this.currentWindowApps.clear()

    if (this.buffer.length >= this.FLUSH_THRESHOLD) {
      this.flush()
    }
  },

  drainCurrentWindow(): void {
    const now = Date.now()
    if (this.totalSamples > 0) {
      const currentIdle = powerMonitor.getSystemIdleTime()
      this.aggregate(now, currentIdle)
    }
  },

  flush(): void {
    this.drainCurrentWindow()
    if (this.buffer.length === 0) return

    const records = [...this.buffer]
    this.buffer = []

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
        this.buffer.push(...recs)
      }
    }
  },
}

// ===================== 行为追踪数据 =====================

export function appendTrackerEvents(date: string, events: unknown[]): boolean {
  try {
    const p = getTrackerPath(date)
    let existing: unknown[] = []
    if (fs.existsSync(p)) {
      existing = JSON.parse(fs.readFileSync(p, 'utf-8'))
    }
    const seen = new Set<string>()
    const merged: unknown[] = []
    for (const event of [...existing, ...events]) {
      const id = event && typeof event === 'object' && 'id' in event
        ? String((event as { id?: unknown }).id ?? '')
        : ''
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      merged.push(event)
    }
    safeWriteJSON(p, merged)
    markDirty('tracker', date)
    return true
  } catch (e) {
    console.error('[Tracker] Failed to append events:', e)
    return false
  }
}

export function loadTrackerEvents(date: string): unknown[] {
  try {
    const p = getTrackerPath(date)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[Tracker] Failed to load events:', e) }
  return []
}

// ===================== 小组件位置记忆 =====================

export function loadWidgetPos(): { x: number; y: number } | null {
  try {
    const p = getWidgetPosPath()
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch { /* 忽略 */ }
  return null
}

export function saveWidgetPos(x: number, y: number): void {
  try { safeWriteJSON(getWidgetPosPath(), { x, y }) }
  catch (e) { console.error('[saveWidgetPos]', e) }
}

// ===================== Memory: Raw Session =====================

export interface RawSessionMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface RawSessionData {
  date: string
  mode: 'daily' | 'weekly'
  status: 'in_progress' | 'processed'
  startedAt: number
  messages: RawSessionMessage[]
}

export function loadRawSession(key: string): RawSessionData | null {
  try {
    const p = getRawSessionPath(key)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadRawSession]', e) }
  return null
}

export function saveRawSession(key: string, data: RawSessionData): boolean {
  try {
    safeWriteJSON(getRawSessionPath(key), data)
    markDirty('rawSession', key)
    return true
  } catch (e) { console.error('[saveRawSession]', e); return false }
}

/** 列出所有 raw session 文件的 key（用于查找未处理的会话） */
export function listRawSessionKeys(): string[] {
  try {
    const dir = getMemoryDir()
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('raw-session-') && f.endsWith('.json'))
      .map(f => f.slice('raw-session-'.length, -'.json'.length))
  } catch { return [] }
}

// ===================== AI Conversations（原始对话记录） =====================

export interface AIConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
}

export interface AIConversationData {
  conversationId: string
  conversationType: 'reflection' | 'stuck'
  date: string
  logicalDate: string
  mode: 'daily' | 'weekly' | 'stuck'
  sessionId?: string
  taskId?: string
  taskTitle?: string
  status: 'in_progress' | 'processed' | 'abandoned'
  startedAt: number
  endedAt?: number
  savedAt: number
  messages: AIConversationMessage[]
  metadata?: Record<string, unknown>
}

export function saveAIConversation(conversation: AIConversationData): boolean {
  try {
    safeWriteJSON(getAIConversationPath(conversation.conversationId), {
      ...conversation,
      savedAt: Date.now(),
    })
    markDirty('aiConversation', conversation.conversationId)
    return true
  } catch (e) { console.error('[saveAIConversation]', e); return false }
}

export function loadAIConversation(conversationId: string): AIConversationData | null {
  try {
    const p = getAIConversationPath(conversationId)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch (e) { console.error('[loadAIConversation]', e) }
  return null
}

export function listAIConversationIds(): string[] {
  try {
    return fs.readdirSync(getAIConversationsDir())
      .filter(f => f.endsWith('.json'))
      .map(f => f.slice(0, -'.json'.length))
  } catch { return [] }
}

// ===================== Memory: Structured Memory Store =====================

export interface MemorySessionSummary {
  id: string
  date: string
  mode: 'daily' | 'weekly'
  summary: string
  createdAt: number
}

export interface MemoryCommitment {
  id: string
  text: string
  sourceDate: string
  status: 'active' | 'followed_up' | 'expired'
  createdAt: number
}

/** 用户选择的第一步记录（用于个性化启动建议） */
export interface FirstStepRecord {
  taskTitle: string
  microAction: string
  source: 'self' | 'ai_chip' | 'memory_chip' | 'skip'
  subtaskTitle?: string
  date: string
}

/** 用户反复采用后沉淀下来的稳定第一步记忆 */
export interface FirstStepStableMemory {
  taskKey: string
  microAction: string
  source: 'self' | 'ai_chip' | 'memory_chip'
  taskExamples: string[]
  count: number
  acceptedCount: number
  rejectedCount: number
  firstUsedAt: string
  lastUsedAt: string
  lastShownAt?: string
  confidence: number
}

/** 用户提交的卡住原因记录（用于精准预测卡点） */
export interface StuckReasonRecord {
  taskTitle: string
  microAction: string
  reason: string
  date: string
}

/** 用户对建议的反馈记录（用于避免不喜欢的建议类型） */
export interface HintFeedbackRecord {
  taskTitle: string
  hintText: string
  feedback: 'up' | 'down'
  date: string
}

export interface MemoryStore {
  sessions: MemorySessionSummary[]
  commitments: MemoryCommitment[]
  firstSteps: FirstStepRecord[]
  stableFirstSteps: FirstStepStableMemory[]
  stuckReasons: StuckReasonRecord[]
  hintFeedback: HintFeedbackRecord[]
  lastUpdated: number
}

export function loadMemoryStore(): MemoryStore {
  try {
    const p = getMemoryStorePath()
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
      // 按 id 去重 sessions：同日期+模式只保留 createdAt 最大的那条
      let sessions: unknown[] = raw.sessions ?? []
      if (sessions.length > 0) {
        const map = new Map<string, Record<string, unknown>>()
        for (const s of sessions as Record<string, unknown>[]) {
          const id = String(s.id ?? `${s.date}-${s.mode}`)
          const existing = map.get(id)
          if (!existing || (Number(s.createdAt) || 0) > (Number(existing.createdAt) || 0)) {
            map.set(id, s)
          }
        }
        sessions = [...map.values()]
      }
      return {
        sessions,
        commitments: raw.commitments ?? [],
        firstSteps: raw.firstSteps ?? [],
        stableFirstSteps: raw.stableFirstSteps ?? [],
        stuckReasons: raw.stuckReasons ?? [],
        hintFeedback: raw.hintFeedback ?? [],
        lastUpdated: raw.lastUpdated ?? 0,
      }
    }
  } catch (e) { console.error('[loadMemoryStore]', e) }
  return { sessions: [], commitments: [], firstSteps: [], stableFirstSteps: [], stuckReasons: [], hintFeedback: [], lastUpdated: 0 }
}

export function saveMemoryStore(store: MemoryStore): boolean {
  try {
    store.lastUpdated = Date.now()
    safeWriteJSON(getMemoryStorePath(), store)
    markDirty('memory')
    return true
  } catch (e) { console.error('[saveMemoryStore]', e); return false }
}
