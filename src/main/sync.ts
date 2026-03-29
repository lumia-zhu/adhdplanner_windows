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
} from './storage'
import { getReflectionChatPath } from './storage'
import fs from 'fs'

const SYNC_INTERVAL = 30_000

const dirtySet = new Map<string, Set<string>>()
let syncTimer: ReturnType<typeof setInterval> | null = null

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

      const { error: delErr } = await sb
        .from('tasks')
        .delete()
        .eq('user_id', userId)
        .eq('date', date)
      if (delErr) throw delErr

      if (tasks.length > 0) {
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
        const { error } = await sb.from('tasks').insert(rows)
        if (error) throw error
      }
      console.log(`[Sync] tasks/${date}: ${tasks.length} rows`)
      break
    }

    case 'profile': {
      const profile = loadProfile()
      const { error } = await sb.from('profiles').upsert({
        user_id: userId,
        major: String(profile.major || ''),
        grade: String(profile.grade || ''),
        challenges: Array.isArray(profile.challenges) ? profile.challenges : [],
        workplaces: Array.isArray(profile.workplaces) ? profile.workplaces : [],
        reflection_time: profile.reflectionTime ? String(profile.reflectionTime) : null,
        updated_at: new Date().toISOString(),
      })
      if (error) throw error
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
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
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

      const rows = records.map(r => ({
        user_id: userId,
        date,
        ts: r.ts,
        idle: r.idle,
        active_samples: r.activeSamples,
        total_samples: r.totalSamples,
        active_ratio: r.activeRatio,
      }))

      // 先删旧的再插入，避免重复
      await sb.from('activity_records').delete().eq('user_id', userId).eq('date', date)
      const { error } = await sb.from('activity_records').insert(rows)
      if (error) throw error
      console.log(`[Sync] activity/${date}: ${rows.length} rows`)
      break
    }

    case 'tracker': {
      const date = key
      const events = loadTrackerEvents(date) as Array<Record<string, unknown>>
      if (events.length === 0) break

      const rows = events.map(ev => ({
        user_id: userId,
        date,
        event_id: String(ev.id || ''),
        event_type: String(ev.type || ''),
        timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : null,
        payload: ev.payload ?? null,
      }))

      await sb.from('tracker_events').delete().eq('user_id', userId).eq('date', date)
      const { error } = await sb.from('tracker_events').insert(rows)
      if (error) throw error
      console.log(`[Sync] tracker/${date}: ${rows.length} rows`)
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
