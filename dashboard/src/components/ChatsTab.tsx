'use client'

import { useState } from 'react'
import ChatViewer from './ChatViewer'
import { exportCSV } from '@/lib/export-csv'
import type { ConversationType, DashboardConversation } from '@/lib/conversations'

interface Props {
  conversations: DashboardConversation[]
}

const TYPE_META: Record<ConversationType, { label: string; activeClass: string; badgeClass: string; emptyText: string }> = {
  reflection: {
    label: '复盘对话',
    activeClass: 'bg-blue-600 text-white shadow-sm',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-100',
    emptyText: '暂无复盘对话',
  },
  stuck: {
    label: '卡顿对话',
    activeClass: 'bg-orange-500 text-white shadow-sm',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-100',
    emptyText: '暂无卡顿对话',
  },
}

function modeLabel(conversation: DashboardConversation): string {
  if (conversation.type === 'stuck') return '卡顿急救'
  if (conversation.mode === 'weekly') return '周反思'
  return '日反思'
}

function getStuckSummary(conversation: DashboardConversation): string {
  const metadata = conversation.metadata ?? {}
  const reason = typeof metadata.stuckReason === 'string' ? metadata.stuckReason : ''
  const microTask = typeof metadata.currentMicroTask === 'string' ? metadata.currentMicroTask : ''
  return reason || microTask || '未记录卡顿原因'
}

export default function ChatsTab({ conversations }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeType, setActiveType] = useState<ConversationType>('reflection')
  const sorted = [...conversations].sort((a, b) => b.startedAt - a.startedAt)
  const counts = {
    reflection: sorted.filter(conversation => conversation.type === 'reflection').length,
    stuck: sorted.filter(conversation => conversation.type === 'stuck').length,
  }
  const visible = sorted.filter(conversation => conversation.type === activeType)
  const selected = visible.find(conversation => conversation.id === selectedKey)

  const handleExport = () => {
    const rows = visible.flatMap(conversation =>
      (conversation.messages ?? []).map((m, i) => ({
        conversation_id: conversation.id,
        conversation_type: conversation.type,
        date: conversation.date,
        mode: conversation.mode,
        task_title: conversation.taskTitle ?? '',
        session_id: conversation.sessionId ?? '',
        msg_index: i,
        role: m.role,
        content: m.content,
        ts: m.ts ?? '',
      }))
    )
    exportCSV(rows, `${activeType}_chats.csv`)
  }

  const handleSwitchType = (type: ConversationType) => {
    setActiveType(type)
    setSelectedKey(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="bg-gray-100 rounded-lg p-0.5 flex">
          {(['reflection', 'stuck'] as ConversationType[]).map(type => (
            <button
              key={type}
              onClick={() => handleSwitchType(type)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeType === type ? TYPE_META[type].activeClass : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {TYPE_META[type].label}
              <span className={`ml-1.5 text-xs ${activeType === type ? 'text-white/80' : 'text-gray-400'}`}>
                {counts[type]}
              </span>
            </button>
          ))}
        </div>
        <button onClick={handleExport} className="text-xs text-blue-600 hover:underline">
          导出当前对话 CSV
        </button>
      </div>
      <div className="grid grid-cols-3 gap-4" style={{ minHeight: 400 }}>
        {/* 左侧：对话列表 */}
        <div className="col-span-1 border border-gray-200 rounded-lg overflow-y-auto max-h-[calc(100vh-320px)]">
          {visible.length === 0 && (
            <div className="text-center py-8 text-gray-400">{TYPE_META[activeType].emptyText}</div>
          )}
          {visible.map(conversation => (
            <div
              key={conversation.id}
              onClick={() => setSelectedKey(conversation.id)}
              className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                selectedKey === conversation.id
                  ? activeType === 'stuck'
                    ? 'bg-orange-50 border-l-2 border-l-orange-500'
                    : 'bg-blue-50 border-l-2 border-l-blue-500'
                  : 'hover:bg-gray-50'
              }`}
            >
              <p className="text-sm font-medium text-gray-800">{conversation.date}</p>
              {conversation.type === 'stuck' && (
                <p className="text-xs text-gray-600 mt-1 truncate">
                  {conversation.taskTitle || '未命名任务'}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs px-1.5 py-0.5 rounded border ${TYPE_META[conversation.type].badgeClass}`}>
                  {modeLabel(conversation)}
                </span>
                <span className="text-xs text-gray-400">
                  {(conversation.messages ?? []).length} 条消息
                </span>
              </div>
              {conversation.type === 'stuck' && (
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {getStuckSummary(conversation)}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* 右侧：聊天内容 */}
        <div className="col-span-2 border border-gray-200 rounded-lg bg-white">
          {selected ? (
            <ChatViewer conversation={selected} />
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
