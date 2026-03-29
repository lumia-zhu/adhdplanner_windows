/**
 * 合并 tracker_events 和 reflection_sessions 为统一时间线
 */

export interface TimelineEvent {
  kind: 'event'
  id: string
  type: string
  timestamp: number
  payload: Record<string, unknown>
}

export interface TimelineChat {
  kind: 'chat'
  sessionKey: string
  date: string
  mode: string
  startedAt: number
  messageCount: number
  messages: Array<{ role: string; content: string; ts?: number }>
}

export type TimelineItem = TimelineEvent | TimelineChat

export function mergeTimeline(
  events: Array<{ event_id: string; event_type: string; timestamp: number; payload: Record<string, unknown> }>,
  sessions: Array<{ session_key: string; date: string; mode: string; started_at: number; messages: Array<{ role: string; content: string; ts?: number }> }>
): TimelineItem[] {
  const items: TimelineItem[] = []

  for (const e of events) {
    items.push({
      kind: 'event',
      id: e.event_id,
      type: e.event_type,
      timestamp: e.timestamp,
      payload: e.payload ?? {},
    })
  }

  for (const s of sessions) {
    items.push({
      kind: 'chat',
      sessionKey: s.session_key,
      date: s.date,
      mode: s.mode,
      startedAt: s.started_at,
      messageCount: (s.messages ?? []).length,
      messages: s.messages ?? [],
    })
  }

  items.sort((a, b) => {
    const ta = a.kind === 'event' ? a.timestamp : a.startedAt
    const tb = b.kind === 'event' ? b.timestamp : b.startedAt
    return ta - tb
  })

  return items
}
