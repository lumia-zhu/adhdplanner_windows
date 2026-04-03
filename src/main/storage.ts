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
function getUserDir(): string {
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

// ===================== 活跃度采样数据 =====================

interface ActivityRecord {
  ts: number
  idle: number
  activeSamples: number
  totalSamples: number
  activeRatio: number
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

export function loadActivityData(date: string): ActivityRecord[] {
  try {
    const p = getActivityPath(date)
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown[]
      return raw.map(normalizeActivityRecord).filter((r): r is ActivityRecord => r !== null)
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

  SAMPLE_INTERVAL: 2000,
  WINDOW_SIZE: 30_000,
  FLUSH_INTERVAL: 5 * 60_000,
  FLUSH_THRESHOLD: 20,

  start(): void {
    this.activeSamples = 0
    this.totalSamples = 0
    this.windowStart = Date.now()
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
    if (currentIdle <= this.ACTIVE_IDLE_THRESHOLD) {
      this.activeSamples++
    }
    const now = Date.now()
    if (now - this.windowStart >= this.WINDOW_SIZE) {
      this.aggregate(now, currentIdle)
    }
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
    this.buffer.push(record)

    this.activeSamples = 0
    this.totalSamples = 0
    this.windowStart = now

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
    const merged = [...existing, ...events]
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
  source: 'self' | 'ai_chip' | 'skip'
  subtaskTitle?: string
  date: string
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
        stuckReasons: raw.stuckReasons ?? [],
        hintFeedback: raw.hintFeedback ?? [],
        lastUpdated: raw.lastUpdated ?? 0,
      }
    }
  } catch (e) { console.error('[loadMemoryStore]', e) }
  return { sessions: [], commitments: [], firstSteps: [], stuckReasons: [], hintFeedback: [], lastUpdated: 0 }
}

export function saveMemoryStore(store: MemoryStore): boolean {
  try {
    store.lastUpdated = Date.now()
    safeWriteJSON(getMemoryStorePath(), store)
    markDirty('memory')
    return true
  } catch (e) { console.error('[saveMemoryStore]', e); return false }
}
