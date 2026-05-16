export type DailyStatusDefinitionKey =
  | 'mood'
  | 'planStarted'
  | 'reflectionStarted'
  | 'planTime'
  | 'reflectionTime'
  | 'lastActivityAt'

export const DAILY_STATUS_DEFINITIONS: Record<DailyStatusDefinitionKey, { label: string; description: string }> = {
  mood: {
    label: '情绪记录',
    description: '来自 mood_records。所选日期有一条 mood 记录就算已记录；有记录时显示对应情绪图标和 1-5 数值。',
  },
  planStarted: {
    label: '计划状态',
    description: '当天 tasks 至少有一条任务，并且 tracker_events 里存在 session.started、exec.micro_started 或 plan.first_micro，才算计划已开始。',
  },
  reflectionStarted: {
    label: '反思状态',
    description: '当天存在 reflect.opened，并且存在 reflect.message_sent，才算反思已开始。点击探索方向和手动输入都算用户主动发送。',
  },
  planTime: {
    label: '计划提醒时间',
    description: '来自 profiles.plan_time。为空时显示未设置。',
  },
  reflectionTime: {
    label: '反思提醒时间',
    description: '来自 profiles.reflection_time。为空时显示未设置。',
  },
  lastActivityAt: {
    label: '最后活动时间',
    description: '取当天相关 tracker_events 的最大 timestamp，用来粗略判断这个账号当天数据是否已经同步上来。',
  },
}

export const MOOD_EMOJI: Record<number, string> = {
  1: '😢',
  2: '😟',
  3: '😐',
  4: '🙂',
  5: '😄',
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted'

export interface DashboardUser {
  user_id: string
  email: string
}

export interface DailyStatusRow {
  userId: string
  email: string
  mood: number | null
  moodText: string
  taskCount: number
  hasTaskInput: boolean
  hasTaskStart: boolean
  planStatusText: string
  planTone: StatusTone
  reflectOpened: boolean
  reflectMessageSent: boolean
  reflectionStatusText: string
  reflectionTone: StatusTone
  planTimeText: string
  reflectionTimeText: string
  lastActivityAt: number | null
  lastActivityText: string
}

interface BuildRowsParams {
  users: DashboardUser[]
  profiles: Array<Record<string, unknown>>
  moods: Array<Record<string, unknown>>
  tasks: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
}

const PLAN_START_EVENTS = new Set(['session.started', 'exec.micro_started', 'plan.first_micro'])

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function buildDailyStatusRows({
  users,
  profiles,
  moods,
  tasks,
  events,
}: BuildRowsParams): DailyStatusRow[] {
  const rows = new Map<string, DailyStatusRow>()

  for (const user of users) {
    rows.set(user.user_id, {
      userId: user.user_id,
      email: user.email,
      mood: null,
      moodText: '未记录',
      taskCount: 0,
      hasTaskInput: false,
      hasTaskStart: false,
      planStatusText: '未开始',
      planTone: 'danger',
      reflectOpened: false,
      reflectMessageSent: false,
      reflectionStatusText: '未开始',
      reflectionTone: 'danger',
      planTimeText: '未设置',
      reflectionTimeText: '未设置',
      lastActivityAt: null,
      lastActivityText: '-',
    })
  }

  const ensure = (userId: string): DailyStatusRow => {
    if (!rows.has(userId)) {
      rows.set(userId, {
        userId,
        email: `${userId.slice(0, 12)}...`,
        mood: null,
        moodText: '未记录',
        taskCount: 0,
        hasTaskInput: false,
        hasTaskStart: false,
        planStatusText: '未开始',
        planTone: 'danger',
        reflectOpened: false,
        reflectMessageSent: false,
        reflectionStatusText: '未开始',
        reflectionTone: 'danger',
        planTimeText: '未设置',
        reflectionTimeText: '未设置',
        lastActivityAt: null,
        lastActivityText: '-',
      })
    }
    return rows.get(userId)!
  }

  for (const profile of profiles) {
    const userId = String(profile.user_id || '')
    if (!userId) continue
    const row = ensure(userId)
    row.planTimeText = profile.plan_time ? String(profile.plan_time) : '未设置'
    row.reflectionTimeText = profile.reflection_time ? String(profile.reflection_time) : '未设置'
  }

  for (const mood of moods) {
    const userId = String(mood.user_id || '')
    if (!userId) continue
    const row = ensure(userId)
    const value = Number(mood.mood)
    row.mood = Number.isInteger(value) ? value : null
    row.moodText = row.mood ? `${MOOD_EMOJI[row.mood] ?? '🙂'} ${row.mood}` : '已记录'
  }

  for (const task of tasks) {
    const userId = String(task.user_id || '')
    if (!userId) continue
    const row = ensure(userId)
    row.taskCount += 1
    row.hasTaskInput = true
  }

  for (const event of events) {
    const userId = String(event.user_id || '')
    if (!userId) continue
    const row = ensure(userId)
    const type = String(event.event_type || '')
    const timestamp = typeof event.timestamp === 'number' ? event.timestamp : Number(event.timestamp) || null

    if (PLAN_START_EVENTS.has(type)) row.hasTaskStart = true
    if (type === 'reflect.opened') row.reflectOpened = true
    if (type === 'reflect.message_sent') row.reflectMessageSent = true
    if (timestamp && (!row.lastActivityAt || timestamp > row.lastActivityAt)) {
      row.lastActivityAt = timestamp
      row.lastActivityText = formatTime(timestamp)
    }
  }

  return Array.from(rows.values()).map(row => {
    if (row.hasTaskInput && row.hasTaskStart) {
      row.planStatusText = `已开始（${row.taskCount} 个任务）`
      row.planTone = 'success'
    } else if (row.hasTaskInput) {
      row.planStatusText = `有任务，未开始（${row.taskCount} 个）`
      row.planTone = 'warning'
    } else if (row.hasTaskStart) {
      row.planStatusText = '有启动事件，缺任务记录'
      row.planTone = 'warning'
    }

    if (row.reflectOpened && row.reflectMessageSent) {
      row.reflectionStatusText = '已开始'
      row.reflectionTone = 'success'
    } else if (row.reflectOpened) {
      row.reflectionStatusText = '已进入，未发消息'
      row.reflectionTone = 'warning'
    } else if (row.reflectMessageSent) {
      row.reflectionStatusText = '有消息，缺打开事件'
      row.reflectionTone = 'warning'
    }

    return row
  }).sort((a, b) => a.email.localeCompare(b.email))
}

export function buildDailyStatusMetrics(rows: DailyStatusRow[]) {
  const moodCount = rows.filter(r => r.mood !== null).length
  const planCount = rows.filter(r => r.hasTaskInput && r.hasTaskStart).length
  const reflectionCount = rows.filter(r => r.reflectOpened && r.reflectMessageSent).length

  return [
    { label: '账号总数', value: String(rows.length), detail: '当前看板可见账号', definitionKey: undefined },
    { label: '已记录情绪', value: `${moodCount}/${rows.length}`, detail: '当天 mood_records 有记录', definitionKey: 'mood' as const },
    { label: '已开始计划', value: `${planCount}/${rows.length}`, detail: '有任务且有启动事件', definitionKey: 'planStarted' as const },
    { label: '已开始反思', value: `${reflectionCount}/${rows.length}`, detail: '进入反思且发送消息', definitionKey: 'reflectionStarted' as const },
  ]
}
