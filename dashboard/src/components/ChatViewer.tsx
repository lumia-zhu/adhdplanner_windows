'use client'

interface Message {
  role: string
  content: string
  ts?: number
}

interface Props {
  messages: Message[]
}

export default function ChatViewer({ messages }: Props) {
  if (messages.length === 0) {
    return <div className="text-center py-12 text-gray-400">选择左侧对话查看内容</div>
  }

  return (
    <div className="space-y-3 max-h-[calc(100vh-300px)] overflow-y-auto p-4">
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
            msg.role === 'user'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-800'
          }`}>
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            {msg.ts && (
              <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                {new Date(msg.ts).toLocaleTimeString('zh-CN')}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
