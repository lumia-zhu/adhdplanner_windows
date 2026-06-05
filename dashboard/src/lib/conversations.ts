export type ConversationType = 'reflection' | 'stuck'

export interface DashboardMessage {
  role: string
  content: string
  ts?: number
}

export interface DashboardConversation {
  id: string
  type: ConversationType
  date: string
  mode: string
  startedAt: number
  messages: DashboardMessage[]
  taskTitle?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  source: 'ai_conversations' | 'reflection_sessions'
}

function asMessages(value: unknown): DashboardMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((message): message is Record<string, unknown> =>
      !!message && typeof message === 'object'
    )
    .map(message => ({
      role: typeof message.role === 'string' ? message.role : 'assistant',
      content: typeof message.content === 'string' ? message.content : '',
      ts: typeof message.ts === 'number' ? message.ts : undefined,
    }))
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric

    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function getSortDate(conversation: DashboardConversation): string {
  return conversation.date || ''
}

export function compareConversationsDesc(a: DashboardConversation, b: DashboardConversation): number {
  const dateCompare = getSortDate(b).localeCompare(getSortDate(a))
  if (dateCompare !== 0) return dateCompare

  const timeCompare = b.startedAt - a.startedAt
  if (timeCompare !== 0) return timeCompare

  return b.id.localeCompare(a.id)
}

export function normalizeAIConversations(rows: Array<Record<string, unknown>>): DashboardConversation[] {
  return rows
    .map((row): DashboardConversation | null => {
      const id = String(row.conversation_id ?? '')
      if (!id) return null

      const type: ConversationType = row.conversation_type === 'stuck' ? 'stuck' : 'reflection'
      return {
        id,
        type,
        date: String(row.logical_date ?? row.date ?? ''),
        mode: String(row.mode ?? type),
        startedAt: asTimestamp(row.started_at ?? row.saved_at),
        messages: asMessages(row.messages),
        taskTitle: typeof row.task_title === 'string' ? row.task_title : undefined,
        sessionId: typeof row.session_id === 'string' ? row.session_id : undefined,
        metadata: asMetadata(row.metadata),
        source: 'ai_conversations',
      }
    })
    .filter((conversation): conversation is DashboardConversation => !!conversation)
}

export function normalizeLegacyReflectionSessions(
  rows: Array<Record<string, unknown>>,
  aiConversations: DashboardConversation[],
): DashboardConversation[] {
  const existingReflectionKeys = new Set(
    aiConversations
      .filter(conversation => conversation.type === 'reflection')
      .flatMap(conversation => [
        conversation.id,
        conversation.id.replace(/^reflection-/, ''),
      ])
  )

  return rows
    .map((row): DashboardConversation | null => {
      const sessionKey = String(row.session_key ?? '')
      if (!sessionKey || existingReflectionKeys.has(sessionKey)) return null

      return {
        id: sessionKey,
        type: 'reflection',
        date: String(row.date ?? ''),
        mode: String(row.mode ?? 'daily'),
        startedAt: asTimestamp(row.started_at ?? row.saved_at),
        messages: asMessages(row.messages),
        source: 'reflection_sessions',
      }
    })
    .filter((conversation): conversation is DashboardConversation => !!conversation)
}

export function normalizeConversations(
  aiRows: Array<Record<string, unknown>>,
  legacyReflectionRows: Array<Record<string, unknown>>,
): DashboardConversation[] {
  const aiConversations = normalizeAIConversations(aiRows)
  const legacyReflections = normalizeLegacyReflectionSessions(legacyReflectionRows, aiConversations)
  return [...aiConversations, ...legacyReflections].sort(compareConversationsDesc)
}
