import type { ActivityRecord } from '../components/ActivityHeatmap'
import { getActiveRatio } from '../components/ActivityHeatmap'

const EXPECTED_RECORDS_PER_BLOCK = 120
const MIN_SPAN = 12
const DEFAULT_START = 7
const DEFAULT_END = 23

/**
 * 根据活跃度数据计算自适应的可见时间范围。
 * 被电脑活动图和活动分布条共用，确保横轴一致。
 */
export function computeActiveTimeRange(
  data: ActivityRecord[],
): { rangeStart: number; rangeEnd: number } {
  const buckets: number[] = Array(24).fill(0)
  for (const r of data) {
    const h = new Date(r.ts).getHours()
    buckets[h] += getActiveRatio(r)
  }

  let firstActive = 24
  let lastActive = -1
  for (let i = 0; i < 24; i++) {
    if (buckets[i] / EXPECTED_RECORDS_PER_BLOCK > 0) {
      firstActive = Math.min(firstActive, i)
      lastActive = Math.max(lastActive, i)
    }
  }

  if (firstActive > lastActive) {
    return { rangeStart: DEFAULT_START, rangeEnd: DEFAULT_END }
  }

  let start = Math.max(0, firstActive - 1)
  let end = Math.min(24, lastActive + 2)
  const span = end - start
  if (span < MIN_SPAN) {
    const deficit = MIN_SPAN - span
    const padBefore = Math.floor(deficit / 2)
    const padAfter = deficit - padBefore
    start = Math.max(0, start - padBefore)
    end = Math.min(24, end + padAfter)
    if (end - start < MIN_SPAN) {
      if (start === 0) end = Math.min(24, start + MIN_SPAN)
      else start = Math.max(0, end - MIN_SPAN)
    }
  }
  return { rangeStart: start, rangeEnd: end }
}
