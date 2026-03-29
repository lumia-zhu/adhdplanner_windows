'use client'

import { useState } from 'react'
import type { TimelineItem } from '@/lib/merge-timeline'

interface Props {
  items: TimelineItem[]
}

export default function TimelineView({ items }: Props) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const toggle = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (items.length === 0) {
    return <div className="text-center py-12 text-gray-400">无时间线数据</div>
  }

  return (
    <div className="relative pl-8">
      {/* 竖线 */}
      <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-200" />

      {items.map((item, idx) => {
        if (item.kind === 'event') {
          const key = `evt-${item.id}`
          const expanded = expandedKeys.has(key)
          const domain = item.type.split('.')[0]
          return (
            <div key={key} className="relative mb-3 group">
              <div className={`absolute left-[-20px] top-2 w-2.5 h-2.5 rounded-full border-2 ${domainColor(domain)}`} />
              <div
                onClick={() => toggle(key)}
                className="bg-white rounded-lg border border-gray-100 p-3 hover:shadow-sm cursor-pointer transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(item.timestamp).toLocaleTimeString('zh-CN')}
                  </span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                    {item.type}
                  </span>
                  <span className="text-xs text-gray-500 truncate">
                    {Object.entries(item.payload).slice(0, 2).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ')}
                  </span>
                </div>
                {expanded && (
                  <pre className="mt-2 text-xs text-gray-600 font-mono bg-gray-50 rounded p-2 whitespace-pre-wrap">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )
        }

        // Chat block
        const key = `chat-${item.sessionKey}`
        const expanded = expandedKeys.has(key)
        return (
          <div key={key} className="relative mb-3">
            <div className="absolute left-[-20px] top-2 w-2.5 h-2.5 rounded-full border-2 border-purple-500 bg-purple-100" />
            <div
              onClick={() => toggle(key)}
              className="bg-purple-50 rounded-lg border border-purple-200 p-3 cursor-pointer hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(item.startedAt).toLocaleTimeString('zh-CN')}
                </span>
                <span className="text-xs font-medium text-purple-700">
                  反思对话 ({item.mode})
                </span>
                <span className="text-xs text-gray-500">{item.messageCount} 条消息</span>
              </div>

              {expanded && (
                <div className="mt-3 space-y-2 max-h-96 overflow-y-auto">
                  {item.messages.map((msg, mi) => (
                    <div
                      key={mi}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                          msg.role === 'user'
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-white text-gray-800 border border-gray-200'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function domainColor(domain: string): string {
  const map: Record<string, string> = {
    task: 'border-green-500 bg-green-100',
    session: 'border-blue-500 bg-blue-100',
    stuck: 'border-red-500 bg-red-100',
    plan: 'border-yellow-500 bg-yellow-100',
    reflect: 'border-purple-500 bg-purple-100',
    nav: 'border-gray-500 bg-gray-100',
    mode: 'border-indigo-500 bg-indigo-100',
    memory: 'border-pink-500 bg-pink-100',
    daily: 'border-teal-500 bg-teal-100',
  }
  return map[domain] ?? 'border-gray-400 bg-gray-100'
}
