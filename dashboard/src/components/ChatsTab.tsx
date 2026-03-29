'use client'

import { useState } from 'react'
import ChatViewer from './ChatViewer'
import { exportCSV } from '@/lib/export-csv'

interface SessionRow {
  session_key: string
  date: string
  mode: string
  messages: Array<{ role: string; content: string; ts?: number }>
  started_at: number
}

interface Props {
  sessions: SessionRow[]
}

export default function ChatsTab({ sessions }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const sorted = [...sessions].sort((a, b) => b.started_at - a.started_at)
  const selected = sorted.find(s => s.session_key === selectedKey)

  const handleExport = () => {
    const rows = sorted.flatMap(s =>
      (s.messages ?? []).map((m, i) => ({
        session_key: s.session_key,
        date: s.date,
        mode: s.mode,
        msg_index: i,
        role: m.role,
        content: m.content,
      }))
    )
    exportCSV(rows, 'chats.csv')
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={handleExport} className="text-xs text-blue-600 hover:underline">
          导出所有对话 CSV
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4" style={{ minHeight: 400 }}>
        {/* 左侧：对话列表 */}
        <div className="col-span-1 border border-gray-200 rounded-lg overflow-y-auto max-h-[calc(100vh-320px)]">
          {sorted.length === 0 && (
            <div className="text-center py-8 text-gray-400">无对话记录</div>
          )}
          {sorted.map(s => (
            <div
              key={s.session_key}
              onClick={() => setSelectedKey(s.session_key)}
              className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                selectedKey === s.session_key ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-medium text-gray-800">{s.date}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {s.mode === 'daily' ? '日反思' : '周反思'}
                </span>
                <span className="text-xs text-gray-400">
                  {(s.messages ?? []).length} 条消息
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 右侧：聊天内容 */}
        <div className="col-span-2 border border-gray-200 rounded-lg bg-white">
          {selected ? (
            <ChatViewer messages={selected.messages ?? []} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              点击左侧对话查看内容
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
