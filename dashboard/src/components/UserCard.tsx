'use client'

import { LineChart, Line, ResponsiveContainer } from 'recharts'

export interface UserCardData {
  userId: string
  email: string
  eventCount: number
  chatCount: number
  taskCompletionRate: number | null
  activeDays: number
  dailyTrend: Array<{ date: string; count: number }>
}

interface Props {
  data: UserCardData
  onClick: () => void
}

export default function UserCard({ data, onClick }: Props) {
  const rate = data.taskCompletionRate
  const rateStr = rate !== null ? `${Math.round(rate * 100)}%` : '-'

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg hover:border-blue-300 cursor-pointer transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 truncate max-w-[200px]">
            {data.email || data.userId.slice(0, 12)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{data.activeDays} 天活跃</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center mb-3">
        <div>
          <p className="text-lg font-bold text-gray-800">{data.eventCount}</p>
          <p className="text-xs text-gray-500">事件</p>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-800">{data.chatCount}</p>
          <p className="text-xs text-gray-500">对话</p>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-800">{rateStr}</p>
          <p className="text-xs text-gray-500">完成率</p>
        </div>
      </div>

      {data.dailyTrend.length > 1 && (
        <div className="h-10">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.dailyTrend}>
              <Line
                type="monotone"
                dataKey="count"
                stroke="#3b82f6"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
