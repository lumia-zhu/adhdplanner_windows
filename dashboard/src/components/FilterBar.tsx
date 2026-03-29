'use client'

import { format, subDays } from 'date-fns'

interface User {
  user_id: string
  email: string
}

interface FilterBarProps {
  users: User[]
  selectedUserId: string | null
  onSelectUser: (userId: string | null) => void
  dateFrom: string
  dateTo: string
  onDateFromChange: (d: string) => void
  onDateToChange: (d: string) => void
  onExportCSV?: () => void
}

export default function FilterBar({
  users, selectedUserId, onSelectUser,
  dateFrom, dateTo, onDateFromChange, onDateToChange,
  onExportCSV,
}: FilterBarProps) {
  const today = format(new Date(), 'yyyy-MM-dd')

  const setQuickRange = (days: number) => {
    onDateToChange(today)
    onDateFromChange(format(subDays(new Date(), days - 1), 'yyyy-MM-dd'))
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm px-6 py-3">
      <div className="flex items-center gap-4 flex-wrap">
        {/* 用户选择 */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">用户</label>
          <select
            value={selectedUserId ?? '__all__'}
            onChange={e => onSelectUser(e.target.value === '__all__' ? null : e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="__all__">全部用户</option>
            {users.map(u => (
              <option key={u.user_id} value={u.user_id}>
                {u.email || u.user_id.slice(0, 8)}
              </option>
            ))}
          </select>
          {selectedUserId && (
            <button
              onClick={() => onSelectUser(null)}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              清除
            </button>
          )}
        </div>

        {/* 日期范围 */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">日期</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => onDateFromChange(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <span className="text-gray-400">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => onDateToChange(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {/* 快捷日期按钮 */}
        <div className="flex items-center gap-1">
          {[
            { label: '今天', days: 1 },
            { label: '7天', days: 7 },
            { label: '30天', days: 30 },
          ].map(({ label, days }) => (
            <button
              key={days}
              onClick={() => setQuickRange(days)}
              className="px-2.5 py-1 text-xs rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        {/* 导出 */}
        {onExportCSV && (
          <button
            onClick={onExportCSV}
            className="ml-auto px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            导出 CSV
          </button>
        )}
      </div>
    </header>
  )
}
