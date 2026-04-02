/**
 * 论文指标计算函数
 * 7 个快速统计指标，对齐研究论文需求
 */

interface TrackerEvent {
  event_type: string
  payload: Record<string, unknown>
  timestamp: number
}

interface TaskRow {
  completed: boolean
  focus_duration: number
}

interface ActivityRow {
  active_ratio: number
  total_samples: number
}

export interface QuickStatsResult {
  aiSuggestionRate: number | null
  aiCompletionRate: number | null
  reflectionRate: number | null
  totalFocusMinutes: number
  taskCompletionRate: number | null
  stuckCount: number
  focusToComputerRatio: number | null
}

export function calcQuickStats(
  events: TrackerEvent[],
  tasks: TaskRow[],
  activities: ActivityRow[]
): QuickStatsResult {
  // #1 AI 建议使用率: plan.first_micro 中 source='ai_chip' / total
  const firstMicros = events.filter(e => e.event_type === 'plan.first_micro')
  const aiChipCount = firstMicros.filter(e => e.payload?.source === 'ai_chip').length
  const aiSuggestionRate = firstMicros.length > 0 ? aiChipCount / firstMicros.length : null

  // #2 AI 建议完成率: source='ai_chip' session 中有 macro_completed 的比例
  const sessionEndeds = events.filter(e => e.event_type === 'session.ended')
  const aiSessions = sessionEndeds.filter(e => e.payload?.chipSource === 'ai_chip')
  const aiCompleted = aiSessions.filter(e => {
    const taskId = e.payload?.taskId as string | undefined
    if (!taskId) return false
    return events.some(
      ev => ev.event_type === 'session.macro_completed' && ev.payload?.taskId === taskId
    )
  })
  const aiCompletionRate = aiSessions.length > 0 ? aiCompleted.length / aiSessions.length : null

  // #3 反思完成率: reflect.ended / reflect.opened
  const reflectOpened = events.filter(e => e.event_type === 'reflect.opened').length
  const reflectEnded = events.filter(e => e.event_type === 'reflect.ended').length
  const reflectionRate = reflectOpened > 0 ? reflectEnded / reflectOpened : null

  // #4 专注总时长 (分钟): session.ended 的 totalDurationSeconds 求和
  const totalFocusSec = sessionEndeds.reduce((sum, e) => {
    return sum + (Number(e.payload?.totalDurationSeconds) || 0)
  }, 0)
  const totalFocusMinutes = Math.round(totalFocusSec / 60)

  // #5 任务完成率
  const taskCompletionRate = tasks.length > 0
    ? tasks.filter(t => t.completed).length / tasks.length
    : null

  // #6 卡住次数
  const stuckCount = events.filter(e => e.event_type === 'stuck.triggered').length

  // #7 专注/电脑比: 专注时长 / activity 活跃时长
  const totalActiveSamples = activities.reduce((s, a) => s + (a.active_ratio * a.total_samples), 0)
  const totalSamples = activities.reduce((s, a) => s + a.total_samples, 0)
  const activeMinutes = totalSamples > 0 ? (totalActiveSamples / totalSamples) * totalSamples * 5 / 60 : 0
  const focusToComputerRatio = activeMinutes > 0 ? totalFocusMinutes / activeMinutes : null

  return {
    aiSuggestionRate,
    aiCompletionRate,
    reflectionRate,
    totalFocusMinutes,
    taskCompletionRate,
    stuckCount,
    focusToComputerRatio,
  }
}

// ===================== 事件配对完整性校验 =====================

export interface PairCheckItem {
  label: string
  started: number
  ended: number
  orphanCount: number
  rate: number | null
}

export interface PairCheckResult {
  checks: PairCheckItem[]
  totalEvents: number
}

export function calcPairChecks(events: TrackerEvent[]): PairCheckResult {
  // 1. session.started ↔ session.ended（按 sessionId 配对）
  const sessionStarted = events.filter(e => e.event_type === 'session.started')
  const sessionEndedIds = new Set(
    events.filter(e => e.event_type === 'session.ended')
      .map(e => e.payload?.sessionId as string)
  )
  const sessionOrphans = sessionStarted.filter(e => !sessionEndedIds.has(e.payload?.sessionId as string))

  // 2. stuck.triggered → stuck.reason / stuck.pivot_chosen（按 sessionId 配对）
  const stuckTriggered = events.filter(e => e.event_type === 'stuck.triggered')
  const stuckFollowUpIds = new Set(
    events.filter(e =>
      e.event_type === 'stuck.reason' ||
      e.event_type === 'stuck.pivot_chosen'
    ).map(e => e.payload?.sessionId as string)
  )
  const stuckOrphans = stuckTriggered.filter(e => !stuckFollowUpIds.has(e.payload?.sessionId as string))

  // 3. exec.micro_started → exec.micro_completed / stuck.triggered（按 sessionId 配对）
  const microStarted = events.filter(e => e.event_type === 'exec.micro_started')
  const microResolvedIds = new Set(
    events.filter(e =>
      e.event_type === 'exec.micro_completed' ||
      e.event_type === 'stuck.triggered'
    ).map(e => e.payload?.sessionId as string)
  )
  const microOrphans = microStarted.filter(e => !microResolvedIds.has(e.payload?.sessionId as string))

  // 4. reflect.opened → reflect.closed（整体计数配对）
  const reflectOpened = events.filter(e => e.event_type === 'reflect.opened').length
  const reflectClosed = events.filter(e => e.event_type === 'reflect.closed').length
  const reflectOrphans = Math.max(0, reflectOpened - reflectClosed)

  const checks: PairCheckItem[] = [
    {
      label: '会话 (started→ended)',
      started: sessionStarted.length,
      ended: sessionStarted.length - sessionOrphans.length,
      orphanCount: sessionOrphans.length,
      rate: sessionStarted.length > 0
        ? (sessionStarted.length - sessionOrphans.length) / sessionStarted.length
        : null,
    },
    {
      label: '卡顿 (triggered→reason)',
      started: stuckTriggered.length,
      ended: stuckTriggered.length - stuckOrphans.length,
      orphanCount: stuckOrphans.length,
      rate: stuckTriggered.length > 0
        ? (stuckTriggered.length - stuckOrphans.length) / stuckTriggered.length
        : null,
    },
    {
      label: '微步 (started→completed)',
      started: microStarted.length,
      ended: microStarted.length - microOrphans.length,
      orphanCount: microOrphans.length,
      rate: microStarted.length > 0
        ? (microStarted.length - microOrphans.length) / microStarted.length
        : null,
    },
    {
      label: '反思 (opened→closed)',
      started: reflectOpened,
      ended: reflectClosed,
      orphanCount: reflectOrphans,
      rate: reflectOpened > 0 ? reflectClosed / reflectOpened : null,
    },
  ]

  return { checks, totalEvents: events.length }
}
