'use client'

import type { DashboardConversation, DashboardMessage } from '@/lib/conversations'

interface Props {
  conversation: DashboardConversation
}

function modeLabel(conversation: DashboardConversation): string {
  if (conversation.type === 'stuck') return '卡顿急救'
  if (conversation.mode === 'weekly') return '周复盘'
  return '日复盘'
}

function getMetadataText(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : ''
}

function cleanMessageContent(message: DashboardMessage): string {
  return message.content
    .replace(/^【首轮卡住反思】\s*/u, '')
    .replace(/^【情绪来源追问】\s*/u, '')
    .trim()
}

export default function ChatViewer({ conversation }: Props) {
  const messages = conversation.messages ?? []
  const isStuck = conversation.type === 'stuck'
  const stuckReason = getMetadataText(conversation.metadata, 'stuckReason')
  const currentMicroTask = getMetadataText(conversation.metadata, 'currentMicroTask')
  const accent = isStuck
    ? { shell: 'border-orange-100 bg-orange-50/70', pill: 'bg-orange-500 text-white', text: 'text-orange-700' }
    : { shell: 'border-blue-100 bg-blue-50/70', pill: 'bg-blue-600 text-white', text: 'text-blue-700' }

  if (messages.length === 0) {
    return <div className="text-center py-12 text-gray-400">选择左侧对话查看内容</div>
  }

  return (
    <div className="h-full flex flex-col">
      <div className={`m-4 mb-0 rounded-xl border px-4 py-3 ${accent.shell}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${accent.pill}`}>
            {modeLabel(conversation)}
          </span>
          <span className="text-sm font-medium text-gray-800">{conversation.date}</span>
          <span className="text-xs text-gray-400">{messages.length} 条消息</span>
        </div>
        {isStuck ? (
          <div className="mt-2 space-y-1 text-xs text-gray-600">
            <p>
              任务：
              <span className={`font-medium ${accent.text}`}>{conversation.taskTitle || '未命名任务'}</span>
            </p>
            {(stuckReason || currentMicroTask) && (
              <p>
                {stuckReason ? '卡住原因：' : '当前步骤：'}
                <span className={accent.text}>{stuckReason || currentMicroTask}</span>
              </p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            {conversation.mode === 'weekly' ? '一周复盘对话' : '每日复盘对话'}
          </p>
        )}
      </div>

      <div className="space-y-3 max-h-[calc(100vh-380px)] overflow-y-auto p-4">
        {messages.map((msg, i) => {
          const content = cleanMessageContent(msg)
          if (!content) return null
          return (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                <p className="text-sm whitespace-pre-wrap">{content}</p>
                {msg.ts && (
                  <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                    {new Date(msg.ts).toLocaleTimeString('zh-CN')}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
