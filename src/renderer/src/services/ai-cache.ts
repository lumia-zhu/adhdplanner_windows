/**
 * AI 建议缓存 + 预加载服务
 *
 * 核心思路（类比外卖预点）：
 *   - 用户还没点 ▶ 的时候，我们就提前去请求 AI 建议
 *   - 请求回来的结果存在内存里（就像外卖放在保温箱里）
 *   - 等用户真正点击时，直接从"保温箱"拿出来 → 0 等待
 *   - 结果有保质期（默认 5 分钟），过期了再重新请求
 *
 * 使用方式：
 *   import { aiCache } from './ai-cache'
 *
 *   // 预加载（静默，不影响 UI）
 *   aiCache.prefetch(taskId, taskTitle, aiConfig, subtaskTitle)
 *
 *   // 获取建议（优先用缓存，缓存没有再发请求）
 *   const result = await aiCache.get(taskId, taskTitle, aiConfig, subtaskTitle, lastStep)
 */

import type { AIConfig, MicroActionChip } from './ai'
import { generateMicroActions } from './ai'

// ===================== 类型 =====================

/** 缓存条目 */
interface CacheEntry {
  /** AI 返回的微动作建议 */
  chips: MicroActionChip[]
  /** 错误信息（如果有） */
  error?: string
  /** 缓存写入时间戳（毫秒） */
  timestamp: number
}

/** 缓存配置 */
const CACHE_TTL = 15 * 60 * 1000  // ★ 缓存有效期：15 分钟（延长以提高命中率）
const MAX_CACHE_SIZE = 80          // 最多缓存 80 条（配合更大预加载范围）

// ===================== 内部状态 =====================

/** 已完成的缓存结果 */
const cache = new Map<string, CacheEntry>()

/** 正在进行中的请求（防止同一个任务重复请求） */
const inflight = new Map<string, Promise<{ chips: MicroActionChip[]; error?: string }>>()

// ===================== 工具函数 =====================

/**
 * 生成缓存 key
 * - 开始任务时 key = taskId:subtaskTitle（没有 lastStep）
 * - 接力时 key = taskId:subtaskTitle:lastStep
 */
function buildKey(taskId: string, subtaskTitle?: string, lastStep?: string): string {
  const parts = [taskId]
  if (subtaskTitle) parts.push(subtaskTitle)
  if (lastStep) parts.push(lastStep)
  return parts.join(':')
}

/** 检查缓存是否过期 */
function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > CACHE_TTL
}

/** 清理过期条目 + 限制总数 */
function cleanup(): void {
  // 删除过期的
  for (const [key, entry] of cache) {
    if (isExpired(entry)) cache.delete(key)
  }
  // 超出上限时删除最旧的
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toDelete = entries.slice(0, cache.size - MAX_CACHE_SIZE)
    toDelete.forEach(([key]) => cache.delete(key))
  }
}

// ===================== 核心 API =====================

/**
 * 预加载 AI 建议（静默执行，不阻塞 UI）
 *
 * 适用场景：
 *   - 任务列表渲染完成时，为第一个待办任务预加载（不传 lastStep）
 *   - hover 到 ▶ 按钮时，为该任务预加载（不传 lastStep）
 *   - ★ 执行阶段进入时，为 relay 接力预加载（传 lastStep = currentMicroTask）
 *
 * @param taskId        任务 ID
 * @param taskTitle     任务标题
 * @param config        AI 配置
 * @param subtaskTitle  当前子任务标题（可选）
 * @param lastStep      用户正在做的微任务（可选，传了才能命中 relay 缓存）
 */
function prefetch(
  taskId: string,
  taskTitle: string,
  config: AIConfig,
  subtaskTitle?: string,
  lastStep?: string,
  memoryHint?: string,
): void {
  if (!config.apiKey || !config.modelId) return

  const key = buildKey(taskId, subtaskTitle, lastStep)

  const existing = cache.get(key)
  if (existing && !isExpired(existing)) return

  if (inflight.has(key)) return

  console.log('[AI Cache] 预加载:', taskTitle, subtaskTitle ?? '', lastStep ? `(lastStep: ${lastStep})` : '')

  const promise = generateMicroActions(taskTitle, lastStep, config, subtaskTitle, undefined, memoryHint)
    .then(result => {
      cache.set(key, {
        chips: result.chips,
        error: result.error,
        timestamp: Date.now(),
      })
      cleanup()
      console.log('[AI Cache] 预加载完成:', key, result.chips)
      return result
    })
    .catch(err => {
      console.warn('[AI Cache] 预加载失败:', err)
      return { chips: [] as MicroActionChip[], error: String(err) }
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
}

/**
 * 获取 AI 建议（优先缓存 → 在途请求 → 新请求）
 *
 * 适用场景：
 *   - FocusFlow 打开时
 *   - Widget relay 阶段需要接力建议
 *
 * @param taskId        任务 ID
 * @param taskTitle     任务标题
 * @param config        AI 配置
 * @param subtaskTitle  当前子任务标题（可选）
 * @param lastStep      上一步完成的动作（可选，接力用）
 * @returns             { chips, error, fromCache }
 */
async function get(
  taskId: string,
  taskTitle: string,
  config: AIConfig,
  subtaskTitle?: string,
  lastStep?: string,
  memoryHint?: string,
): Promise<{ chips: MicroActionChip[]; error?: string; fromCache: boolean }> {
  const key = buildKey(taskId, subtaskTitle, lastStep)

  const existing = cache.get(key)
  if (existing && !isExpired(existing)) {
    console.log('[AI Cache] 命中缓存:', key)
    return { chips: existing.chips, error: existing.error, fromCache: true }
  }

  const pending = inflight.get(key)
  if (pending) {
    console.log('[AI Cache] 等待在途请求:', key)
    const result = await pending
    return { ...result, fromCache: true }
  }

  console.log('[AI Cache] 发起新请求:', key)
  const promise = generateMicroActions(taskTitle, lastStep, config, subtaskTitle, undefined, memoryHint)
    .then(result => {
      cache.set(key, {
        chips: result.chips,
        error: result.error,
        timestamp: Date.now(),
      })
      cleanup()
      return result
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
  const result = await promise
  return { ...result, fromCache: false }
}

/**
 * 清除指定任务的所有缓存（包括正在进行中的请求）
 * 当任务标题或内容发生变化时调用
 */
function invalidate(taskId: string): void {
  // 清除已完成的缓存
  for (const key of cache.keys()) {
    if (key.startsWith(taskId + ':') || key === taskId) {
      cache.delete(key)
    }
  }
  // ★ 同时清除正在进行中的请求，避免旧请求完成后又写入过期缓存
  for (const key of inflight.keys()) {
    if (key.startsWith(taskId + ':') || key === taskId) {
      inflight.delete(key)
    }
  }
}

/**
 * 清除所有缓存（AI 配置变更时调用）
 */
function clearAll(): void {
  cache.clear()
  inflight.clear()
  console.log('[AI Cache] 已清除全部缓存')
}

// ===================== 导出 =====================

export const aiCache = {
  prefetch,
  get,
  invalidate,
  clearAll,
}
