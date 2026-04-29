import type { MicroActionChip } from './ai'

export type FirstStepSource = 'self' | 'ai_chip' | 'memory_chip' | 'skip'

export interface FirstStepRecord {
  taskTitle: string
  microAction: string
  source: FirstStepSource
  subtaskTitle?: string
  date: string
}

export interface FirstStepStableMemory {
  taskKey: string
  microAction: string
  source: Exclude<FirstStepSource, 'skip'>
  taskExamples: string[]
  count: number
  acceptedCount: number
  rejectedCount: number
  firstUsedAt: string
  lastUsedAt: string
  lastShownAt?: string
  confidence: number
}

export interface StartupMemoryStore {
  firstSteps?: FirstStepRecord[]
  stableFirstSteps?: FirstStepStableMemory[]
  lastUpdated?: number
}

const SHORT_TERM_LIMIT = 30
const SHORT_TERM_DAYS = 14
const STABLE_MIN_COUNT = 2

function toTime(date: string | undefined): number {
  if (!date) return 0
  const time = new Date(date).getTime()
  return Number.isFinite(time) ? time : 0
}

function todayTime(): number {
  return new Date().getTime()
}

function unique<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function normalizeTaskKey(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[0-9０-９]+/g, ' ')
    .replace(/[（(].*?[）)]/g, ' ')
    .replace(/[第套遍次个篇道题]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const keywords = cleaned.match(/[\u4e00-\u9fa5a-zA-Z]+/g) ?? []
  return keywords
    .filter(word => word.length > 1)
    .slice(0, 3)
    .join(' ')
}

function similarity(currentTitle: string, memoryKey: string, examples: string[]): number {
  const currentKey = normalizeTaskKey(currentTitle)
  if (!currentKey || !memoryKey) return 0
  if (currentKey === memoryKey) return 1
  if (currentKey.includes(memoryKey) || memoryKey.includes(currentKey)) return 0.82

  if (examples.some(example => example === currentTitle)) return 1
  if (examples.some(example => example.includes(currentTitle) || currentTitle.includes(example))) return 0.8

  const currentWords = new Set(currentKey.split(' ').filter(Boolean))
  const memoryWords = new Set(memoryKey.split(' ').filter(Boolean))
  if (currentWords.size === 0 || memoryWords.size === 0) return 0

  let overlap = 0
  for (const word of currentWords) {
    if (memoryWords.has(word)) overlap++
  }
  return overlap / Math.max(currentWords.size, memoryWords.size)
}

function recencyPenalty(lastUsedAt: string): number {
  const ageDays = (todayTime() - toTime(lastUsedAt)) / 86_400_000
  if (ageDays <= 30) return 0
  if (ageDays <= 60) return 0.2
  return 0.5
}

function scoreMemory(taskTitle: string, memory: FirstStepStableMemory): number {
  const sim = similarity(taskTitle, memory.taskKey, memory.taskExamples)
  if (sim < 0.45) return 0

  const countWeight = Math.min(memory.count, 8) * 0.08
  const acceptedWeight = Math.min(memory.acceptedCount, 6) * 0.1
  const sourceWeight = memory.source === 'self' || memory.source === 'memory_chip' ? 0.2 : 0
  const rejectionPenalty = Math.min(memory.rejectedCount, 5) * 0.12

  return sim + countWeight + acceptedWeight + sourceWeight - rejectionPenalty - recencyPenalty(memory.lastUsedAt)
}

function scoreRecentRecord(taskTitle: string, record: FirstStepRecord): number {
  if (record.source === 'skip') return 0
  const memoryKey = normalizeTaskKey(record.subtaskTitle || record.taskTitle)
  const sim = similarity(taskTitle, memoryKey, [record.taskTitle])
  if (sim < 0.45) return 0

  const ageDays = (todayTime() - toTime(record.date)) / 86_400_000
  const recencyBoost = ageDays <= 1 ? 0.28 : ageDays <= 7 ? 0.16 : 0.06
  const sourceBoost = record.source === 'self' || record.source === 'memory_chip' ? 0.12 : 0

  return sim + recencyBoost + sourceBoost
}

function normalizeRecord(record: FirstStepRecord): FirstStepRecord | null {
  if (!record?.taskTitle || !record?.microAction || !record?.date) return null
  return {
    taskTitle: String(record.taskTitle),
    microAction: String(record.microAction),
    source: (record.source || 'self') as FirstStepSource,
    subtaskTitle: record.subtaskTitle ? String(record.subtaskTitle) : undefined,
    date: String(record.date),
  }
}

export function compactFirstStepRecords(records: FirstStepRecord[], now = new Date()): FirstStepRecord[] {
  const normalized = records
    .map(normalizeRecord)
    .filter((r): r is FirstStepRecord => !!r)
    .sort((a, b) => toTime(b.date) - toTime(a.date))

  const latest = normalized.slice(0, SHORT_TERM_LIMIT)
  const cutoff = now.getTime() - SHORT_TERM_DAYS * 86_400_000
  const recent = normalized.filter(record => toTime(record.date) >= cutoff)

  return unique([...latest, ...recent], record =>
    `${record.date}|${record.taskTitle}|${record.subtaskTitle ?? ''}|${record.microAction}|${record.source}`,
  ).sort((a, b) => toTime(b.date) - toTime(a.date))
}

function aggregateStableMemories(records: FirstStepRecord[]): FirstStepStableMemory[] {
  const groups = new Map<string, FirstStepStableMemory>()

  for (const record of records) {
    if (record.source === 'skip') continue
    const taskKey = normalizeTaskKey(record.subtaskTitle || record.taskTitle)
    if (!taskKey) continue
    const key = `${taskKey}|${record.microAction}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
      existing.acceptedCount += record.source === 'memory_chip' ? 1 : 0
      existing.firstUsedAt = toTime(record.date) < toTime(existing.firstUsedAt) ? record.date : existing.firstUsedAt
      existing.lastUsedAt = toTime(record.date) > toTime(existing.lastUsedAt) ? record.date : existing.lastUsedAt
      if (!existing.taskExamples.includes(record.taskTitle)) existing.taskExamples.push(record.taskTitle)
      if (existing.source !== 'self' && record.source === 'self') existing.source = 'self'
    } else {
      groups.set(key, {
        taskKey,
        microAction: record.microAction,
        source: record.source === 'skip' ? 'self' : record.source,
        taskExamples: [record.taskTitle],
        count: 1,
        acceptedCount: record.source === 'memory_chip' ? 1 : 0,
        rejectedCount: 0,
        firstUsedAt: record.date,
        lastUsedAt: record.date,
        confidence: 0,
      })
    }
  }

  return [...groups.values()]
    .filter(memory => memory.count >= STABLE_MIN_COUNT || memory.acceptedCount > 0)
    .map(memory => ({
      ...memory,
      taskExamples: memory.taskExamples.slice(0, 5),
      confidence: Math.min(1, 0.35 + memory.count * 0.12 + memory.acceptedCount * 0.15),
    }))
}

export function updateStartupMemory(
  store: StartupMemoryStore,
  record: FirstStepRecord,
): StartupMemoryStore {
  const nextRecords = compactFirstStepRecords([...(store.firstSteps ?? []), record])
  const stableFromRecent = aggregateStableMemories(nextRecords)
  const stableMap = new Map<string, FirstStepStableMemory>()

  for (const memory of store.stableFirstSteps ?? []) {
    stableMap.set(`${memory.taskKey}|${memory.microAction}`, { ...memory })
  }
  for (const memory of stableFromRecent) {
    const key = `${memory.taskKey}|${memory.microAction}`
    const existing = stableMap.get(key)
    if (!existing) {
      stableMap.set(key, memory)
      continue
    }
    stableMap.set(key, {
      ...existing,
      source: existing.source === 'self' ? existing.source : memory.source,
      taskExamples: unique([...memory.taskExamples, ...existing.taskExamples], item => item).slice(0, 5),
      count: Math.max(existing.count, memory.count),
      acceptedCount: Math.max(existing.acceptedCount, memory.acceptedCount),
      firstUsedAt: toTime(existing.firstUsedAt) < toTime(memory.firstUsedAt) ? existing.firstUsedAt : memory.firstUsedAt,
      lastUsedAt: toTime(existing.lastUsedAt) > toTime(memory.lastUsedAt) ? existing.lastUsedAt : memory.lastUsedAt,
      confidence: Math.max(existing.confidence, memory.confidence),
    })
  }

  return {
    ...store,
    firstSteps: nextRecords,
    stableFirstSteps: [...stableMap.values()],
    lastUpdated: Date.now(),
  }
}

export function findStartupMemoryMatches(
  taskTitle: string,
  subtaskTitle: string | undefined,
  store: StartupMemoryStore,
  maxCount = 2,
): MicroActionChip[] {
  const targetTitle = subtaskTitle || taskTitle
  const stable = store.stableFirstSteps && store.stableFirstSteps.length > 0
    ? store.stableFirstSteps
    : aggregateStableMemories(compactFirstStepRecords(store.firstSteps ?? []))
  const stableChips = stable
    .map(memory => ({ memory, score: scoreMemory(targetTitle, memory) }))
    .filter(item => item.score > 0.75)
    .sort((a, b) => b.score - a.score)
    .map(({ memory }) => ({
      action: memory.microAction,
      note: memory.count > 1 ? `你之前用过 ${memory.count} 次` : '你之前这样开始过',
      source: 'memory_chip',
    }))

  const recentChips = compactFirstStepRecords(store.firstSteps ?? [])
    .map(record => ({ record, score: scoreRecentRecord(targetTitle, record) }))
    .filter(item => item.score > 0.75)
    .sort((a, b) => b.score - a.score)
    .map(({ record }) => ({
      action: record.microAction,
      note: '最近类似任务这样开始过',
      source: 'memory_chip',
    }))

  return unique([...stableChips, ...recentChips], chip => chip.action.trim()).slice(0, maxCount)
}

export function mergeStartupSuggestions(
  memoryChips: MicroActionChip[],
  aiChips: MicroActionChip[],
  fallbackChips: MicroActionChip[],
  maxCount = 2,
): MicroActionChip[] {
  const merged = unique([...memoryChips, ...aiChips], chip => chip.action.trim())
  const filled = merged.length > 0 ? merged : fallbackChips
  return filled.slice(0, maxCount)
}
