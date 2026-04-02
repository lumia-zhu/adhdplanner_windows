'use client'

import { useState, useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { humanizeEvent } from '@/lib/research-export'

interface Props {
  events: RawEvent[]
  sessions: Array<Record<string, unknown>>
  users: Array<{ user_id: string; email: string }>
  selectedUserId: string | null
  onSelectUser: (uid: string | null) => void
}

const DOMAIN_COLORS: Record<string, string> = {
  task: 'border-green-500 bg-green-100',
  session: 'border-blue-500 bg-blue-100',
  stuck: 'border-red-500 bg-red-100',
  plan: 'border-yellow-500 bg-yellow-100',
  reflect: 'border-purple-500 bg-purple-100',
  exec: 'border-cyan-500 bg-cyan-100',
  nav: 'border-gray-500 bg-gray-100',
  mode: 'border-indigo-500 bg-indigo-100',
  memory: 'border-pink-500 bg-pink-100',
  abandon: 'border-orange-500 bg-orange-100',
  app: 'border-slate-500 bg-slate-100',
  auth: 'border-violet-500 bg-violet-100',
}

const ALL_DOMAINS = Object.keys(DOMAIN_COLORS)

export default function UserTimelineTab({ events, sessions, users, selectedUserId, onSelectUser }: Props) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set(ALL_DOMAINS))

  const toggle = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleDomain = (d: string) => {
    setDomainFilter(prev => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })
  }

  // 按会话分组 + 按时间排序
  const timelineItems = useMemo(() => {
    if (!selectedUserId) return []

    const userEvents = events.filter(e => e.user_id === selectedUserId)
    const userSessions = sessions.filter(s => s.user_id === selectedUserId)

    // 建立 session 查找表
    const sessionMap = new Map<string, Record<string, unknown>>()
    for (const s of userSessions) {
      sessionMap.set(s.session_key as string, s)
    }

    type Item = {
      kind: 'event'
      ts: number
      event: RawEvent
      humanLabel: string
      domain: string
      sessionId?: string
    } | {
      kind: 'chat'
      ts: number
      session: Record<string, unknown>
    }

    const items: Item[] = []

    for (const e of userEvents) {
      const domain = e.event_type.split('.')[0]
      if (!domainFilter.has(domain)) continue
      items.push({
        kind: 'event',
        ts: e.timestamp,
        event: e,
        humanLabel: humanizeEvent(e),
        domain,
        sessionId: (e.payload?.sessionId as string) ?? undefined,
      })
    }

    // 插入反思对话块
    if (domainFilter.has('reflect')) {
      for (const s of userSessions) {
        items.push({ kind: 'chat', ts: s.started_at as number, session: s })
      }
    }

    items.sort((a, b) => a.ts - b.ts)

    // 按日期分组
    const groups: { date: string; items: Item[] }[] = []
    let curDate = ''
    for (const item of items) {
      const d = new Date(item.ts).toISOString().slice(0, 10)
      if (d !== curDate) {
        curDate = d
        groups.push({ date: d, items: [] })
      }
      groups[groups.length - 1].items.push(item)
    }

    return groups
  }, [events, sessions, selectedUserId, domainFilter])

  if (!selectedUserId) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">请选择一个用户查看其操作时间线</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {users.map(u => (
            <button
              key={u.user_id}
              onClick={() => onSelectUser(u.user_id)}
              className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition-all"
            >
              {u.email}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* 领域筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-gray-500">筛选领域：</span>
        {ALL_DOMAINS.map(d => (
          <button
            key={d}
            onClick={() => toggleDomain(d)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              domainFilter.has(d)
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => setDomainFilter(new Set(ALL_DOMAINS))}
          className="px-2 py-1 text-xs text-blue-600 hover:underline"
        >全选</button>
        <button
          onClick={() => setDomainFilter(new Set())}
          className="px-2 py-1 text-xs text-blue-600 hover:underline"
        >清空</button>
      </div>

      {/* 时间线 */}
      {timelineItems.length === 0 ? (
        <div className="text-center py-12 text-gray-400">无时间线数据</div>
      ) : (
        <div className="space-y-6">
          {timelineItems.map(group => (
            <div key={group.date}>
              {/* 日期标题 */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-bold text-gray-700">{group.date}</span>
                <span className="text-xs text-gray-400">{group.items.length} 条记录</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {/* 该日事件 */}
              <div className="relative pl-8">
                <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-200" />
                {group.items.map((item, idx) => {
                  if (item.kind === 'chat') {
                    const s = item.session
                    const key = `chat-${s.session_key}`
                    const isExpanded = expandedKeys.has(key)
                    const msgs = (s.messages as Array<{ role: string; content: string; ts?: number }>) ?? []
                    return (
                      <div key={key} className="relative mb-2">
                        <div className="absolute left-[-20px] top-2 w-2.5 h-2.5 rounded-full border-2 border-purple-500 bg-purple-100" />
                        <div
                          onClick={() => toggle(key)}
                          className="bg-purple-50 rounded-lg border border-purple-200 p-3 cursor-pointer hover:shadow-sm transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400 whitespace-nowrap">
                              {new Date(item.ts).toLocaleTimeString('zh-CN')}
                            </span>
                            <span className="text-xs font-medium text-purple-700">
                              反思对话 ({s.mode as string})
                            </span>
                            <span className="text-xs text-gray-500">{msgs.length} 条消息</span>
                          </div>
                          {isExpanded && (
                            <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
                              {msgs.map((msg, mi) => (
                                <div key={mi} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                                    msg.role === 'user'
                                      ? 'bg-blue-100 text-blue-900'
                                      : 'bg-white text-gray-800 border border-gray-200'
                                  }`}>
                                    <p className="font-medium text-[10px] text-gray-400 mb-0.5">
                                      {msg.role === 'user' ? '用户' : 'AI'}
                                      {msg.ts ? ` · ${new Date(msg.ts).toLocaleTimeString('zh-CN')}` : ''}
                                    </p>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  }

                  const key = `evt-${group.date}-${idx}`
                  const isExpanded = expandedKeys.has(key)
                  const color = DOMAIN_COLORS[item.domain] ?? 'border-gray-400 bg-gray-100'
                  return (
                    <div key={key} className="relative mb-2">
                      <div className={`absolute left-[-20px] top-2 w-2.5 h-2.5 rounded-full border-2 ${color}`} />
                      <div
                        onClick={() => toggle(key)}
                        className="bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm cursor-pointer transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {new Date(item.ts).toLocaleTimeString('zh-CN')}
                          </span>
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            {item.event.event_type}
                          </span>
                          <span className="text-sm text-gray-700 truncate">
                            {item.humanLabel}
                          </span>
                        </div>
                        {isExpanded && (
                          <pre className="mt-2 text-xs text-gray-600 font-mono bg-gray-50 rounded p-2 whitespace-pre-wrap">
                            {JSON.stringify(item.event.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
