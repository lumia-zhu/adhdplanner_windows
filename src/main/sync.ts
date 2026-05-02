/**
 * 云端同步引擎 —— 本地优先架构
 *
 * 工作方式：
 *   1. storage.ts 写入本地文件后调用 markDirty(entity, key)
 *   2. 同步引擎每 30 秒检查脏标记，把有变更的数据推送到 Supabase
 *   3. 推送失败时把标记放回，下一轮重试
 *   4. 未登录时不做任何操作
 */

import { getSupabase, getCurrentUserId } from './supabase'
import {
  loadTasks, loadProfile, loadAIConfig,
  loadActivityData, loadTrackerEvents,
  loadRawSession, loadMemoryStore,
  safeWriteJSON, getUserDir,
} from './storage'
import { getReflectionChatPath } from './storage'
import { join } from 'path'
import fs from 'fs'

const SYNC_INTERVAL = 30_000

const dirtySet = new Map<string, Set<string>>()
let syncTimer: ReturnType<typeof setInterval> | null = null

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return JSON.stringify(error)
}

function isMissingAppUsageColumn(error: unknown): boolean {
  const msg = getErrorMessage(error)
  return msg.includes('app_usage') && msg.includes('schema cache')
}

function isMissingPlanTimeColumn(error: unknown): boolean {
  const msg = getErrorMessage(error)
  return msg.includes('plan_time') && msg.includes('schema cache')
}

/** 标记某个实体有变更，需要同步到云端。不阻塞调用方。 */
export function markDirty(entity: string, key: string = ''): void {
  if (!dirtySet.has(entity)) dirtySet.set(entity, new Set())
  dirtySet.get(entity)!.add(key)
}

/** 启动同步定时器 */
export function startSync(): void {
  if (syncTimer) return
  syncTimer = setInterval(() => syncLoop(), SYNC_INTERVAL)
  console.log('[Sync] Started, interval', SYNC_INTERVAL, 'ms')
}

/** 停止同步定时器，并做最后一次同步 */
export function stopSync(): void {
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null }
  syncLoop()
  console.log('[Sync] Stopped')
}

/** 立即触发一次同步（用于退出前） */
export function flushSync(): void {
  syncLoop()
}

// ===================== 同步循环 =====================

async function syncLoop(): Promise<void> {
  const userId = getCurrentUserId()
  if (!userId) return
  if (dirtySet.size === 0) return

  const snapshot = new Map(dirtySet)
  dirtySet.clear()

  for (const [entity, keys] of snapshot) {
    for (const key of keys) {
      try {
        await pushToCloud(userId, entity, key)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message
          : (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message)
          : JSON.stringify(e)
        const isNetwork = msg.includes('fetch') || msg.includes('ECONNR') || msg.includes('network')
        if (!isNetwork) {
          console.error(`[Sync] Failed to push ${entity}/${key}:`, msg)
        } else {
          console.warn(`[Sync] Network unavailable, will retry ${entity}/${key}`)
        }
        markDirty(entity, key)
      }
    }
  }
}

// ===================== 推送逻辑 =====================

async function pushToCloud(userId: string, entity: string, key: string): Promise<void> {
  const sb = getSupabase()

  switch (entity) {
    case 'tasks': {
      const date = key
      const tasks = loadTasks(date) as Array<Record<string, unknown>>

      const rows = tasks.map(t => ({
        id: String(t.id || ''),
        user_id: userId,
        date,
        title: String(t.title || ''),
        note: String(t.note || ''),
        priority: String(t.priority || 'medium'),
        completed: !!t.completed,
        subtasks: t.subtasks ?? [],
        paused_session: t.pausedSession ?? null,
        carried_from: t.carriedFrom ? String(t.carriedFrom) : null,
        focus_duration: typeof t.focusDuration === 'number' ? t.focusDuration : 0,
        created_at: typeof t.createdAt === 'number' ? t.createdAt : null,
      }))

      // upsert 当前任务（新增 + 修改）
      if (rows.length > 0) {
        const { error } = await sb.from('tasks').upsert(rows, { onConflict: 'user_id,date,id' })
        if (error) throw error
      }

      // 删除本地已移除的任务
      const localIds = new Set(rows.map(r => r.id))
      const { data: remote } = await sb
        .from('tasks').select('id')
        .eq('user_id', userId).eq('date', date)
      const toDelete = (remote ?? []).filter(r => !localIds.has(r.id)).map(r => r.id)
      if (toDelete.length > 0) {
        await sb.from('tasks').delete()
          .eq('user_id', userId).eq('date', date)
          .in('id', toDelete)
      }

      console.log(`[Sync] tasks/${date}: ${rows.length} upserted, ${toDelete.length} deleted`)
      break
    }

    case 'profile': {
      const profile = loadProfile()
      const row = {
        user_id: userId,
        major: String(profile.major || ''),
        grade: String(profile.grade || ''),
        challenges: Array.isArray(profile.challenges) ? profile.challenges : [],
        workplaces: Array.isArray(profile.workplaces) ? profile.workplaces : [],
        plan_time: profile.planTime ? String(profile.planTime) : null,
        reflection_time: profile.reflectionTime ? String(profile.reflectionTime) : null,
        updated_at: new Date().toISOString(),
      }
      const { error } = await sb.from('profiles').upsert(row)
      if (error) {
        if (!isMissingPlanTimeColumn(error)) throw error

        // 线上库还没执行 plan_time migration 时，先同步其他个人资料字段。
        // 等数据库列补上后，新版本会自动恢复上传 planTime。
        console.warn('[Sync] profile: plan_time column unavailable, retrying without plan time')
        const { plan_time: _planTime, ...rowWithoutPlanTime } = row
        const { error: retryError } = await sb.from('profiles').upsert(rowWithoutPlanTime)
        if (retryError) throw retryError
      }
      console.log('[Sync] profile synced')
      break
    }

    case 'aiConfig': {
      const config = loadAIConfig()
      const { error } = await sb.from('ai_configs').upsert({
        user_id: userId,
        api_url: config.apiUrl || '',
        api_key: config.apiKey || '',
        model_id: config.modelId || '',
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
      console.log('[Sync] aiConfig synced')
      break
    }

    case 'reflection': {
      const chatKey = key
      try {
        const filePath = getReflectionChatPath(chatKey)
        if (!fs.existsSync(filePath)) break
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        const data = parsed && typeof parsed === 'object' ? parsed as {
          bubbles?: unknown[]
          messages?: unknown[]
          step?: unknown
          savedAt?: unknown
        } : {}
        const { error } = await sb.from('reflection_chats').upsert({
          user_id: userId,
          chat_key: chatKey,
          bubbles: data.bubbles ?? [],
          messages: data.messages ?? [],
          step: typeof data.step === 'number' ? data.step : 0,
          saved_at: typeof data.savedAt === 'number' ? data.savedAt : Date.now(),
        })
        if (error) throw error
        console.log(`[Sync] reflection/${chatKey} synced`)
      } catch (e) {
        console.error(`[Sync] reflection/${chatKey} read failed:`, e)
      }
      break
    }

    case 'activity': {
      const date = key
      const records = loadActivityData(date)
      if (records.length === 0) break

      // 先删除云端该天的全部记录，再插入本地的全量数据（避免分页去重缺陷导致重复膨胀）
      const { error: delErr } = await sb
        .from('activity_records').delete()
        .eq('user_id', userId).eq('date', date)
      if (delErr) throw delErr

      const rows = records.map(r => ({
        user_id: userId, date,
        ts: r.ts, idle: r.idle,
        active_samples: r.activeSamples,
        total_samples: r.totalSamples,
        active_ratio: r.activeRatio,
        app_usage: r.appUsage || {},
      }))

      // 分批插入（Supabase 单次 insert 有体积限制）
      const BATCH = 500
      const insertRows = async (payloadRows: Array<Record<string, unknown>>) => {
        for (let i = 0; i < payloadRows.length; i += BATCH) {
          const batch = payloadRows.slice(i, i + BATCH)
          const { error } = await sb.from('activity_records').insert(batch)
          if (error) throw error
        }
      }

      try {
        await insertRows(rows)
      } catch (error) {
        if (!isMissingAppUsageColumn(error)) throw error

        // 线上库还没执行 app_usage migration 时，先保证基础活跃度数据能同步。
        // 等数据库列补上后，新版本会自动恢复上传 app_usage。
        console.warn(`[Sync] activity/${date}: app_usage column unavailable, retrying without app usage`)
        const rowsWithoutAppUsage = rows.map(({ app_usage: _appUsage, ...rest }) => rest)
        await sb.from('activity_records').delete().eq('user_id', userId).eq('date', date)
        await insertRows(rowsWithoutAppUsage)
      }
      console.log(`[Sync] activity/${date}: replaced with ${rows.length} records`)
      break
    }

    case 'tracker': {
      const date = key
      const events = loadTrackerEvents(date) as Array<Record<string, unknown>>
      if (events.length === 0) break

      // 先删除云端该天的全部事件，再插入本地的全量数据
      const { error: delErr } = await sb
        .from('tracker_events').delete()
        .eq('user_id', userId).eq('date', date)
      if (delErr) throw delErr

      const rows = events.map(ev => ({
        user_id: userId, date,
        event_id: String(ev.id || ''),
        event_type: String(ev.type || ''),
        timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : null,
        payload: ev.payload ?? null,
      }))

      const BATCH = 500
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const { error } = await sb.from('tracker_events').insert(batch)
        if (error) throw error
      }
      console.log(`[Sync] tracker/${date}: replaced with ${rows.length} events`)
      break
    }

    case 'rawSession': {
      const sessionKey = key
      const data = loadRawSession(sessionKey)
      if (!data) break
      const { error } = await sb.from('reflection_sessions').upsert({
        user_id: userId,
        session_key: sessionKey,
        date: data.date,
        mode: data.mode,
        status: data.status,
        messages: data.messages,
        started_at: data.startedAt,
        saved_at: Date.now(),
      })
      if (error) throw error
      console.log(`[Sync] rawSession/${sessionKey} synced`)
      break
    }

    case 'memory': {
      const store = loadMemoryStore()
      const { error } = await sb.from('memory_store').upsert({
        user_id: userId,
        sessions: store.sessions,
        commitments: store.commitments,
        last_updated: store.lastUpdated,
        saved_at: Date.now(),
      })
      if (error) throw error
      console.log('[Sync] memory store synced')
      break
    }

    default:
      console.warn(`[Sync] Unknown entity: ${entity}`)
  }
}

// ===================== 云端拉取（新设备首次登录） =====================

const PULL_PAGE_SIZE = 1000

/** 分页拉取 Supabase 表的全部行 */
async function fetchAllRows(
  table: string,
  userId: string,
  selectCols: string = '*',
): Promise<Record<string, unknown>[]> {
  const sb = getSupabase()
  const all: Record<string, unknown>[] = []
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from(table).select(selectCols)
      .eq('user_id', userId)
      .range(from, from + PULL_PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Record<string, unknown>[]))
    if (data.length < PULL_PAGE_SIZE) break
    from += PULL_PAGE_SIZE
  }
  return all
}

/**
 * 从 Supabase 拉取该用户的全部数据到本地。
 * 仅在本地用户目录无 `.cloud-pulled` 标记时执行（新设备首次登录）。
 * 拉取完成后写入标记，后续启动不会重复拉取。
 */
export async function pullFromCloud(userId: string): Promise<void> {
  const userDir = getUserDir()
  const markerPath = join(userDir, '.cloud-pulled')
  if (fs.existsSync(markerPath)) return

  console.log('[Sync] Pull from cloud started for user:', userId)
  const startTime = Date.now()

  try {
    // 1. Profile
    const profiles = await fetchAllRows('profiles', userId)
    if (profiles.length > 0) {
      const p = profiles[0]
      const profile = {
        major: p.major || '',
        grade: p.grade || '',
        challenges: p.challenges ?? [],
        workplaces: p.workplaces ?? [],
        planTime: p.plan_time || null,
        reflectionTime: p.reflection_time || null,
      }
      safeWriteJSON(join(userDir, 'profile.json'), profile)
      console.log('[Pull] profile restored')
    }

    // 2. AI Config
    const configs = await fetchAllRows('ai_configs', userId)
    if (configs.length > 0) {
      const c = configs[0]
      const config = {
        apiUrl: c.api_url || '',
        apiKey: c.api_key || '',
        modelId: c.model_id || '',
      }
      safeWriteJSON(join(userDir, 'ai-config.json'), config)
      console.log('[Pull] aiConfig restored')
    }

    // 3. Memory Store
    const memRows = await fetchAllRows('memory_store', userId)
    if (memRows.length > 0) {
      const m = memRows[0]
      const memDir = join(userDir, 'memory')
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
      safeWriteJSON(join(memDir, 'memory.json'), {
        sessions: m.sessions ?? [],
        commitments: m.commitments ?? [],
        lastUpdated: m.last_updated ?? 0,
      })
      console.log('[Pull] memory store restored')
    }

    // 4. Tasks（按 date 分组写文件）
    const allTasks = await fetchAllRows('tasks', userId)
    const tasksByDate = new Map<string, unknown[]>()
    for (const row of allTasks) {
      const date = String(row.date)
      if (!tasksByDate.has(date)) tasksByDate.set(date, [])
      tasksByDate.get(date)!.push({
        id: row.id,
        title: row.title || '',
        note: row.note || '',
        priority: row.priority || 'medium',
        completed: !!row.completed,
        subtasks: row.subtasks ?? [],
        pausedSession: row.paused_session ?? null,
        carriedFrom: row.carried_from || null,
        focusDuration: row.focus_duration ?? 0,
        createdAt: row.created_at ?? Date.now(),
      })
    }
    for (const [date, tasks] of tasksByDate) {
      safeWriteJSON(join(userDir, `tasks-${date}.json`), tasks)
    }
    console.log(`[Pull] tasks restored: ${allTasks.length} items across ${tasksByDate.size} days`)

    // 5. Tracker Events（按 date 分组，按 event_id 去重后写文件）
    const allEvents = await fetchAllRows('tracker_events', userId)
    const eventsByDate = new Map<string, Map<string, unknown>>()
    for (const row of allEvents) {
      const date = String(row.date)
      const eventId = String(row.event_id || '')
      if (!eventsByDate.has(date)) eventsByDate.set(date, new Map())
      if (!eventsByDate.get(date)!.has(eventId)) {
        eventsByDate.get(date)!.set(eventId, {
          id: eventId,
          type: row.event_type || '',
          date,
          timestamp: row.timestamp ?? 0,
          payload: row.payload ?? {},
        })
      }
    }
    let trackerDeduped = 0
    for (const [date, evMap] of eventsByDate) {
      const events = [...evMap.values()]
      trackerDeduped += events.length
      safeWriteJSON(join(userDir, `tracker-${date}.json`), events)
    }
    console.log(`[Pull] tracker events restored: ${trackerDeduped} unique (${allEvents.length} raw) across ${eventsByDate.size} days`)

    // 6. Activity Records（按 date 分组，按 ts 去重后写文件，不 pretty-print）
    const allActivity = await fetchAllRows('activity_records', userId)
    const actByDate = new Map<string, Map<number, unknown>>()
    for (const row of allActivity) {
      const date = String(row.date)
      const ts = Number(row.ts)
      if (!actByDate.has(date)) actByDate.set(date, new Map())
      if (!actByDate.get(date)!.has(ts)) {
        const appUsage = row.app_usage && typeof row.app_usage === 'object' && Object.keys(row.app_usage).length > 0
          ? row.app_usage
          : undefined
        actByDate.get(date)!.set(ts, {
          ts,
          idle: row.idle,
          activeSamples: row.active_samples,
          totalSamples: row.total_samples,
          activeRatio: row.active_ratio,
          ...(appUsage ? { appUsage } : {}),
        })
      }
    }
    let actDeduped = 0
    for (const [date, tsMap] of actByDate) {
      const records = [...tsMap.values()]
      actDeduped += records.length
      safeWriteJSON(join(userDir, `activity-${date}.json`), records, false)
    }
    console.log(`[Pull] activity restored: ${actDeduped} unique (${allActivity.length} raw) across ${actByDate.size} days`)

    // 7. Reflection Chats
    const allChats = await fetchAllRows('reflection_chats', userId)
    for (const row of allChats) {
      const chatKey = String(row.chat_key)
      safeWriteJSON(join(userDir, `reflection-${chatKey}.json`), {
        bubbles: row.bubbles ?? [],
        messages: row.messages ?? [],
        step: row.step ?? 0,
        savedAt: row.saved_at ?? Date.now(),
      })
    }
    console.log(`[Pull] reflection chats restored: ${allChats.length}`)

    // 8. Raw Sessions（反思对话原始记录）
    const allSessions = await fetchAllRows('reflection_sessions', userId)
    if (allSessions.length > 0) {
      const memDir = join(userDir, 'memory')
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
      for (const row of allSessions) {
        const key = String(row.session_key)
        safeWriteJSON(join(memDir, `raw-session-${key}.json`), {
          date: row.date,
          mode: row.mode,
          status: row.status,
          messages: row.messages ?? [],
          startedAt: row.started_at ?? 0,
        })
      }
    }
    console.log(`[Pull] raw sessions restored: ${allSessions.length}`)

    // 写标记：后续不再重复拉取
    fs.writeFileSync(markerPath, new Date().toISOString(), 'utf-8')
    console.log(`[Sync] Pull from cloud completed in ${Date.now() - startTime}ms`)
  } catch (e) {
    console.error('[Sync] Pull from cloud failed:', e)
  }
}
