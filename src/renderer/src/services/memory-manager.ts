import type { ExtractedMemory } from './ai'
import {
  updateStartupMemory,
  type FirstStepRecord,
  type FirstStepStableMemory,
} from './startup-memory'

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
  status: string
  createdAt: number
}

export interface StuckReasonRecord {
  taskTitle: string
  microAction: string
  reason: string
  date: string
}

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

export type MemoryItemType =
  | 'session'
  | 'commitment'
  | 'firstStep'
  | 'stableFirstStep'
  | 'stuckReason'
  | 'hintFeedback'

export interface ReflectionMemoryMeta {
  date: string
  mode: 'daily' | 'weekly'
}

export interface MemoryPromptScope {
  phase?: 'planning' | 'execution' | 'reflection'
  maxItems?: number
}

const EMPTY_MEMORY_STORE: MemoryStore = {
  sessions: [],
  commitments: [],
  firstSteps: [],
  stableFirstSteps: [],
  stuckReasons: [],
  hintFeedback: [],
  lastUpdated: 0,
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function normalizeMode(mode: unknown): 'daily' | 'weekly' {
  return mode === 'weekly' ? 'weekly' : 'daily'
}

function dedupeSessions(sessions: MemorySessionSummary[]): MemorySessionSummary[] {
  const map = new Map<string, MemorySessionSummary>()
  for (const session of sessions) {
    if (!session?.summary) continue
    const id = session.id || `${session.date}-${session.mode}`
    const normalized: MemorySessionSummary = {
      id,
      date: String(session.date ?? ''),
      mode: normalizeMode(session.mode),
      summary: String(session.summary),
      createdAt: Number(session.createdAt) || Date.now(),
    }
    const existing = map.get(id)
    if (!existing || normalized.createdAt > existing.createdAt) map.set(id, normalized)
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-20)
}

function normalizeCommitments(commitments: MemoryCommitment[]): MemoryCommitment[] {
  return commitments
    .filter(item => item?.text)
    .map(item => ({
      id: item.id || nowId('commitment'),
      text: String(item.text),
      sourceDate: String(item.sourceDate ?? ''),
      status: String(item.status || 'active'),
      createdAt: Number(item.createdAt) || Date.now(),
    }))
}

export function normalizeMemoryStore(raw: unknown): MemoryStore {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MEMORY_STORE }
  const store = raw as Partial<MemoryStore>
  return {
    sessions: dedupeSessions(asArray<MemorySessionSummary>(store.sessions)),
    commitments: normalizeCommitments(asArray<MemoryCommitment>(store.commitments)),
    firstSteps: asArray<FirstStepRecord>(store.firstSteps),
    stableFirstSteps: asArray<FirstStepStableMemory>(store.stableFirstSteps),
    stuckReasons: asArray<StuckReasonRecord>(store.stuckReasons).slice(-30),
    hintFeedback: asArray<HintFeedbackRecord>(store.hintFeedback).slice(-50),
    lastUpdated: Number(store.lastUpdated) || 0,
  }
}

export async function loadMemory(): Promise<MemoryStore> {
  const raw = await window.electronAPI.loadMemoryStore()
  return normalizeMemoryStore(raw)
}

export async function saveMemory(store: MemoryStore): Promise<boolean> {
  return window.electronAPI.saveMemoryStore({
    ...normalizeMemoryStore(store),
    lastUpdated: Date.now(),
  })
}

export async function updateMemory(updater: (store: MemoryStore) => MemoryStore | Promise<MemoryStore>): Promise<MemoryStore> {
  const current = await loadMemory()
  const next = normalizeMemoryStore(await updater(current))
  await saveMemory(next)
  return next
}

export async function recordFirstStep(record: FirstStepRecord): Promise<MemoryStore> {
  return updateMemory(store => updateStartupMemory(store, record) as MemoryStore)
}

export async function recordReflectionMemory(result: ExtractedMemory, meta: ReflectionMemoryMeta): Promise<MemoryStore> {
  return updateMemory(store => {
    const next = normalizeMemoryStore(store)
    const createdAt = Date.now()

    if (result.summary) {
      const id = `${meta.date}-${meta.mode}`
      next.sessions = dedupeSessions([
        ...next.sessions.filter(session => session.id !== id),
        { id, date: meta.date, mode: meta.mode, summary: result.summary, createdAt },
      ])
    }

    if (result.commitments.length > 0) {
      next.commitments = normalizeCommitments([
        ...next.commitments,
        ...result.commitments.map(text => ({
          id: nowId(meta.date),
          text,
          sourceDate: meta.date,
          status: 'active',
          createdAt,
        })),
      ])
    }

    return next
  })
}

export async function recordStuckReason(record: StuckReasonRecord): Promise<MemoryStore> {
  return updateMemory(store => ({
    ...store,
    stuckReasons: [...store.stuckReasons, record].slice(-30),
  }))
}

export async function recordHintFeedback(record: HintFeedbackRecord): Promise<MemoryStore> {
  return updateMemory(store => ({
    ...store,
    hintFeedback: [...store.hintFeedback, record].slice(-50),
  }))
}

export async function deleteMemoryItem(type: MemoryItemType, id: string): Promise<MemoryStore> {
  return updateMemory(store => {
    switch (type) {
      case 'session':
        return { ...store, sessions: store.sessions.filter(item => item.id !== id) }
      case 'commitment':
        return { ...store, commitments: store.commitments.filter(item => item.id !== id) }
      case 'firstStep':
        return { ...store, firstSteps: store.firstSteps.filter((item, index) => `${item.date}|${item.taskTitle}|${item.microAction}|${index}` !== id) }
      case 'stableFirstStep':
        return { ...store, stableFirstSteps: store.stableFirstSteps.filter(item => `${item.taskKey}|${item.microAction}` !== id) }
      case 'stuckReason':
        return { ...store, stuckReasons: store.stuckReasons.filter((item, index) => `${item.date}|${item.taskTitle}|${item.microAction}|${index}` !== id) }
      case 'hintFeedback':
        return { ...store, hintFeedback: store.hintFeedback.filter((item, index) => `${item.date}|${item.taskTitle}|${item.hintText}|${index}` !== id) }
      default:
        return store
    }
  })
}

export async function expireOldCommitments(maxAgeDays = 7): Promise<MemoryStore> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  return updateMemory(store => ({
    ...store,
    commitments: store.commitments.map(item =>
      item.status === 'active' && item.createdAt < cutoff ? { ...item, status: 'expired' } : item,
    ),
  }))
}

export function getMemorySummaryForPrompt(store: MemoryStore, scope: MemoryPromptScope = {}): string {
  const maxItems = scope.maxItems ?? 3
  const parts: string[] = []

  if (!scope.phase || scope.phase === 'planning') {
    const stable = [...store.stableFirstSteps].sort((a, b) => b.confidence - a.confidence).slice(0, maxItems)
    if (stable.length > 0) {
      parts.push('## 启动偏好')
      stable.forEach(item => parts.push(`- 类似「${item.taskExamples[0] ?? item.taskKey}」常用第一步：${item.microAction}`))
    }
  }

  if (!scope.phase || scope.phase === 'execution') {
    const stuck = [...store.stuckReasons].slice(-maxItems)
    if (stuck.length > 0) {
      parts.push('## 近期卡住模式')
      stuck.forEach(item => parts.push(`- [${item.date}] ${item.taskTitle} / ${item.microAction}：${item.reason}`))
    }
  }

  if (!scope.phase || scope.phase === 'reflection') {
    const sessions = [...store.sessions].sort((a, b) => a.createdAt - b.createdAt).slice(-maxItems)
    if (sessions.length > 0) {
      parts.push('## 近期反思摘要')
      sessions.forEach(item => parts.push(`- [${item.date}] ${item.summary}`))
    }

    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentCommitments = store.commitments
      .filter(item => item.status === 'active' && item.createdAt >= threeDaysAgo)
      .slice(-maxItems)
    const olderCommitments = store.commitments
      .filter(item => item.status === 'active' && item.createdAt < threeDaysAgo && item.createdAt >= sevenDaysAgo)
      .slice(-2)

    if (recentCommitments.length > 0) {
      parts.push('## 最近用户想尝试的事')
      recentCommitments.forEach(item => parts.push(`- [${item.sourceDate}] ${item.text}`))
    }
    if (olderCommitments.length > 0) {
      parts.push('## 稍早的承诺（只在自然相关时提）')
      olderCommitments.forEach(item => parts.push(`- [${item.sourceDate}] ${item.text}`))
    }
  }

  return parts.join('\n')
}
