import type { ExtractedMemory } from './ai'
import type { Task } from '../types'
import type { DailySummary, TrackEvent } from './tracker'
import {
  normalizeTaskKey,
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

export interface ReflectionMemoryContext {
  date: string
  mode: 'daily' | 'weekly'
  tasks: Pick<Task, 'title' | 'completed'>[]
  summary: DailySummary | null
  events: TrackEvent[]
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

const MEMORY_CACHE_TTL_MS = 1500
let memoryCache: { store: MemoryStore; loadedAt: number } | null = null

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function normalizeMode(mode: unknown): 'daily' | 'weekly' {
  return mode === 'weekly' ? 'weekly' : 'daily'
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()\[\]【】\s]/g, '')
    .trim()
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[\u4e00-\u9fa5a-zA-Z]+/g) ?? [])
    .filter(word => word.length > 1)
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a))
  const bTokens = new Set(tokenize(b))
  if (aTokens.size === 0 || bTokens.size === 0) return 0
  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++
  }
  return overlap / Math.max(aTokens.size, bTokens.size)
}

function isLowValueSummary(summary: string): boolean {
  const text = summary.trim()
  if (text.length < 8 || text.length > 180) return true
  const normalized = normalizeText(text)
  const vagueWords = ['讨论了', '聊了', '反思了', '看了图表', '进行了反思', '本次反思']
  const hasSpecificAction = /先|打开|写|列|拆|记录|暂停|继续|开始|卡住|关键词|文档|资料|步骤/.test(text)
  return vagueWords.some(word => normalized.includes(normalizeText(word))) && !hasSpecificAction
}

function trimMemoryText(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned
}

function dedupeSessions(sessions: MemorySessionSummary[]): MemorySessionSummary[] {
  const byId = new Map<string, MemorySessionSummary>()
  const result: MemorySessionSummary[] = []
  for (const session of sessions) {
    if (!session?.summary) continue
    const summary = trimMemoryText(String(session.summary), 160)
    if (isLowValueSummary(summary)) continue
    const id = session.id || `${session.date}-${session.mode}`
    const normalized: MemorySessionSummary = {
      id,
      date: String(session.date ?? ''),
      mode: normalizeMode(session.mode),
      summary,
      createdAt: Number(session.createdAt) || Date.now(),
    }
    const existing = byId.get(id)
    if (!existing || normalized.createdAt > existing.createdAt) byId.set(id, normalized)
  }
  for (const session of [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)) {
    const duplicate = result.some(item =>
      normalizeText(item.summary) === normalizeText(session.summary) ||
      tokenSimilarity(item.summary, session.summary) >= 0.75
    )
    if (!duplicate) result.push(session)
  }
  return result.sort((a, b) => a.createdAt - b.createdAt).slice(-16)
}

function normalizeCommitments(commitments: MemoryCommitment[]): MemoryCommitment[] {
  const result: MemoryCommitment[] = []
  const sorted = commitments
    .filter(item => item?.text)
    .map(item => ({
      id: item.id || nowId('commitment'),
      text: trimMemoryText(String(item.text), 80),
      sourceDate: String(item.sourceDate ?? ''),
      status: String(item.status || 'active'),
      createdAt: Number(item.createdAt) || Date.now(),
    }))
    .sort((a, b) => b.createdAt - a.createdAt)

  for (const item of sorted) {
    const key = normalizeText(item.text)
    if (!key || key.length < 4) continue
    const duplicate = result.some(existing =>
      normalizeText(existing.text) === key ||
      tokenSimilarity(existing.text, item.text) >= 0.8
    )
    if (!duplicate) result.push(item)
  }

  return result.sort((a, b) => a.createdAt - b.createdAt).slice(-20)
}

function normalizeStuckReasons(records: StuckReasonRecord[]): StuckReasonRecord[] {
  const seen = new Set<string>()
  const result: StuckReasonRecord[] = []
  for (const item of records.slice().reverse()) {
    if (!item?.reason || !item?.date) continue
    const normalized = {
      taskTitle: String(item.taskTitle || ''),
      microAction: String(item.microAction || ''),
      reason: trimMemoryText(String(item.reason), 80),
      date: String(item.date),
    }
    const key = `${normalized.date}|${normalizeText(normalized.taskTitle)}|${normalizeText(normalized.microAction)}|${normalizeText(normalized.reason)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result.reverse().slice(-30)
}

export function compactMemoryStore(store: MemoryStore): MemoryStore {
  return {
    sessions: dedupeSessions(store.sessions),
    commitments: normalizeCommitments(store.commitments),
    firstSteps: store.firstSteps,
    stableFirstSteps: store.stableFirstSteps,
    stuckReasons: normalizeStuckReasons(store.stuckReasons),
    hintFeedback: store.hintFeedback.slice(-20),
    lastUpdated: Number(store.lastUpdated) || 0,
  }
}

export function normalizeMemoryStore(raw: unknown): MemoryStore {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MEMORY_STORE }
  const store = raw as Partial<MemoryStore>
  return compactMemoryStore({
    sessions: dedupeSessions(asArray<MemorySessionSummary>(store.sessions)),
    commitments: normalizeCommitments(asArray<MemoryCommitment>(store.commitments)),
    firstSteps: asArray<FirstStepRecord>(store.firstSteps),
    stableFirstSteps: asArray<FirstStepStableMemory>(store.stableFirstSteps),
    stuckReasons: normalizeStuckReasons(asArray<StuckReasonRecord>(store.stuckReasons)),
    hintFeedback: asArray<HintFeedbackRecord>(store.hintFeedback).slice(-20),
    lastUpdated: Number(store.lastUpdated) || 0,
  })
}

export async function loadMemory(forceRefresh = false): Promise<MemoryStore> {
  if (!forceRefresh && memoryCache && Date.now() - memoryCache.loadedAt < MEMORY_CACHE_TTL_MS) {
    return memoryCache.store
  }
  const raw = await window.electronAPI.loadMemoryStore()
  const store = normalizeMemoryStore(raw)
  memoryCache = { store, loadedAt: Date.now() }
  return store
}

export async function saveMemory(store: MemoryStore): Promise<boolean> {
  const normalized = normalizeMemoryStore(store)
  const next = {
    ...normalized,
    lastUpdated: Date.now(),
  }
  const ok = await window.electronAPI.saveMemoryStore(next)
  if (ok) memoryCache = { store: next, loadedAt: Date.now() }
  return ok
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

    const summary = trimMemoryText(result.summary || '', 160)
    if (summary && !isLowValueSummary(summary)) {
      const id = `${meta.date}-${meta.mode}`
      next.sessions = dedupeSessions([
        ...next.sessions.filter(session => session.id !== id),
        { id, date: meta.date, mode: meta.mode, summary, createdAt },
      ])
    }

    if (result.commitments.length > 0) {
      next.commitments = normalizeCommitments([
        ...next.commitments,
        ...result.commitments.map(text => ({
          id: nowId(meta.date),
          text: trimMemoryText(text, 80),
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
    stuckReasons: normalizeStuckReasons([...store.stuckReasons, record]),
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
  const current = await loadMemory()
  if (!current.commitments.some(item => item.status === 'active' && item.createdAt < cutoff)) {
    return current
  }
  return updateMemory(store => {
    const commitments = store.commitments.map(item => {
      const expired = item.status === 'active' && item.createdAt < cutoff
      return expired ? { ...item, status: 'expired' } : item
    })
    return { ...store, commitments }
  })
}

function truncateMultiline(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
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

function daysBetween(date: string, now = new Date()): number {
  const time = new Date(date).getTime()
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.round((now.getTime() - time) / 86_400_000))
}

function collectContextKeywords(context: ReflectionMemoryContext): string[] {
  const texts = [
    ...context.tasks.map(task => task.title),
    ...(context.summary?.stuckEvents ?? []).flatMap(event => [event.taskTitle, event.microAction, event.reason]),
    ...(context.summary?.microStepTrail ?? []).map(step => step.microAction),
  ]
  return Array.from(new Set(texts.flatMap(tokenize))).slice(0, 20)
}

function relevanceToContext(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const tokens = new Set(tokenize(text))
  if (tokens.size === 0) return 0
  let overlap = 0
  for (const keyword of keywords) {
    if (tokens.has(keyword) || text.includes(keyword)) overlap++
  }
  return overlap / Math.max(tokens.size, keywords.length)
}

function formatMemoryDate(date: string): string {
  const parts = date.split('-')
  if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`
  return date
}

export function buildReflectionMemoryCapsule(store: MemoryStore, context: ReflectionMemoryContext): string {
  const normalized = normalizeMemoryStore(store)
  const keywords = collectContextKeywords(context)
  const parts: string[] = []

  const startup = [...normalized.stableFirstSteps]
    .map(item => ({
      item,
      score: Math.max(
        ...context.tasks.map(task => relevanceToContext(`${item.taskKey} ${item.taskExamples.join(' ')}`, tokenize(task.title))),
        0,
      ) + item.confidence,
    }))
    .filter(({ score }) => score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)

  if (startup.length > 0) {
    parts.push('## 启动偏好（类似任务时可参考）')
    startup.forEach(({ item }) => {
      parts.push(`- 类似「${item.taskExamples[0] ?? item.taskKey}」时，用户常用第一步：${item.microAction}`)
    })
  }

  const stuck = [...normalized.stuckReasons]
    .map(item => ({
      item,
      score: relevanceToContext(`${item.taskTitle} ${item.microAction} ${item.reason}`, keywords) + Math.max(0, 0.35 - daysBetween(item.date) * 0.03),
    }))
    .filter(({ score }) => score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)

  if (stuck.length > 0) {
    parts.push('## 卡顿线索（只是可能背景，不能当作今天原因）')
    stuck.forEach(({ item }) => {
      parts.push(`- [${formatMemoryDate(item.date)}] ${item.taskTitle || '某个任务'} / ${item.microAction || '某一步'}：${item.reason}`)
    })
  }

  const followUps = normalized.commitments
    .filter(item => item.status === 'active' && daysBetween(item.sourceDate) <= 14)
    .map(item => ({
      item,
      score: relevanceToContext(item.text, keywords) + Math.max(0, 0.4 - daysBetween(item.sourceDate) * 0.04),
    }))
    .filter(({ score }) => score > 0.16)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)

  if (followUps.length > 0) {
    parts.push('## 可选策略回访（仅当自然相关时使用，最多提一句）')
    followUps.forEach(({ item }) => {
      parts.push(`- [${formatMemoryDate(item.sourceDate)}] 用户曾说想尝试：${item.text}。如果当前任务确实相似，可以轻轻问这次有没有机会用上一点。`)
    })
  }

  const sessions = [...normalized.sessions]
    .map(item => ({
      item,
      score: relevanceToContext(item.summary, keywords) + Math.max(0, 0.25 - daysBetween(item.date) * 0.02),
    }))
    .filter(({ score }) => score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)

  if (sessions.length > 0) {
    parts.push('## 近期反思发现（相关时可承接）')
    sessions.forEach(({ item }) => parts.push(`- [${formatMemoryDate(item.date)}] ${item.summary}`))
  }

  if (parts.length === 0) return ''

  parts.unshift('## 用户模式线索（仅供理解，不要主动全部提起）')
  return truncateMultiline(parts.join('\n'), 1200)
}
