/**
 * 行为追踪模块 —— 统一导出
 *
 * 使用方式：
 *   import { tracker } from '../services/tracker'
 *   tracker.track('exec.micro_completed', { ... })
 *
 *   import { buildDailySummary, summaryToLLMContext } from '../services/tracker'
 *   const summary = buildDailySummary(date, events)
 *   const context = summaryToLLMContext(summary)
 */

export { tracker } from './tracker'
export { buildDailySummary, summaryToLLMContext } from './summary'
export type {
  TrackEventType,
  TrackEventMap,
  TrackEvent,
  DailySummary,
} from './types'
