'use client'

import { useState, useMemo, Fragment } from 'react'
import { buildCSVFilename, exportCSV } from '@/lib/export-csv'

interface EventRow {
  id: number
  event_id: string
  event_type: string
  timestamp: number
  payload: Record<string, unknown>
  date: string
}

interface Props {
  events: EventRow[]
  initialTypeFilter?: string
  exportUserLabel?: string
}

const PAGE_SIZE = 50

const EVENT_DOMAINS = ['task', 'session', 'stuck', 'plan', 'reflect', 'nav', 'mode', 'memory', 'daily', 'manual', 'settings', 'auth', 'app']

export default function EventTable({ events, initialTypeFilter, exportUserLabel = 'all-users' }: Props) {
  const [typeFilter, setTypeFilter] = useState<string>(initialTypeFilter ?? '')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const allTypes = useMemo(() => {
    const set = new Set(events.map(e => e.event_type))
    return Array.from(set).sort()
  }, [events])

  const typeDomains = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const t of allTypes) {
      const domain = t.split('.')[0]
      if (!groups[domain]) groups[domain] = []
      groups[domain].push(t)
    }
    return groups
  }, [allTypes])

  const filtered = useMemo(() => {
    if (!typeFilter) return events
    return events.filter(e => e.event_type.startsWith(typeFilter))
  }, [events, typeFilter])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleExport = () => {
    exportCSV(
      filtered.map(e => ({
        date: e.date,
        time: new Date(e.timestamp).toLocaleString('zh-CN'),
        event_type: e.event_type,
        payload: JSON.stringify(e.payload),
      })),
      buildCSVFilename(exportUserLabel, `events_${typeFilter || 'all'}`)
    )
  }

  return (
    <div>
      {/* 筛选器 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => { setTypeFilter(''); setPage(0) }}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${!typeFilter ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
        >
          全部 ({events.length})
        </button>
        {EVENT_DOMAINS.filter(d => typeDomains[d]).map(domain => (
          <button
            key={domain}
            onClick={() => { setTypeFilter(domain + '.'); setPage(0) }}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${typeFilter === domain + '.' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
          >
            {domain}.* ({typeDomains[domain]?.length ?? 0})
          </button>
        ))}
        <button onClick={handleExport} className="ml-auto text-xs text-blue-600 hover:underline">
          导出 CSV
        </button>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">时间</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">事件类型</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">Payload 摘要</th>
            </tr>
          </thead>
          <tbody>
            {pageData.map(e => (
              <Fragment key={e.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                    {new Date(e.timestamp).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 font-mono">
                      {e.event_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-600 max-w-md truncate">
                    {summarizePayload(e.payload)}
                  </td>
                </tr>
                {expandedId === e.id && (
                  <tr className="bg-gray-50">
                    <td colSpan={3} className="px-4 py-3">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-white p-3 rounded border border-gray-200">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center py-8 text-gray-400">无数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>共 {filtered.length} 条，第 {page + 1}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function summarizePayload(payload: Record<string, unknown>): string {
  if (!payload) return ''
  const keys = Object.keys(payload)
  if (keys.length === 0) return '{}'
  const parts = keys.slice(0, 3).map(k => {
    const v = payload[k]
    const str = typeof v === 'string' ? v : JSON.stringify(v)
    return `${k}: ${str?.slice(0, 30)}`
  })
  return parts.join(' | ') + (keys.length > 3 ? ' ...' : '')
}
