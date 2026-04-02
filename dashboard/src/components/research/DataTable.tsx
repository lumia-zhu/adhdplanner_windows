'use client'

import { useState, useMemo, useCallback, Fragment } from 'react'
import { exportCSV } from '@/lib/export-csv'
import type { Column, Row, RawEvent } from '@/lib/research-export'

interface Props {
  columns: Column[]
  rows: Row[]
  csvFilename?: string
  /** 是否支持展开行查看原始事件 */
  expandable?: boolean
  /** 是否支持展开行查看聊天记录 */
  chatExpandable?: boolean
  pageSize?: number
}

const PAGE_SIZE_DEFAULT = 30

export default function DataTable({
  columns,
  rows,
  csvFilename = 'export.csv',
  expandable = false,
  chatExpandable = false,
  pageSize = PAGE_SIZE_DEFAULT,
}: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(0)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va
      return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
    })
  }, [rows, sortKey, sortAsc])

  const totalPages = Math.ceil(sorted.length / pageSize)
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize)

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) { setSortAsc(a => !a) }
    else { setSortKey(key); setSortAsc(true) }
  }, [sortKey])

  const handleExport = useCallback(() => {
    const exportRows = sorted.map(r => {
      const obj: Record<string, unknown> = {}
      for (const c of columns) obj[c.label] = r[c.key]
      return obj
    })
    exportCSV(exportRows, csvFilename)
  }, [sorted, columns, csvFilename])

  const renderExpanded = (row: Row) => {
    if (chatExpandable && row._messages) {
      const msgs = row._messages as Array<{ role: string; content: string; ts?: number }>
      return (
        <div className="max-h-80 overflow-y-auto space-y-2 p-3">
          {msgs.length === 0 && <p className="text-gray-400 text-xs">无消息记录</p>}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${m.role === 'user' ? 'bg-blue-100 text-blue-900' : 'bg-gray-100 text-gray-800'}`}>
                <p className="font-medium text-[10px] text-gray-400 mb-0.5">
                  {m.role === 'user' ? '用户' : 'AI'}
                  {m.ts ? ` · ${new Date(m.ts).toLocaleTimeString('zh-CN')}` : ''}
                </p>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ))}
        </div>
      )
    }

    if (expandable && row._rawEvents) {
      const evts = row._rawEvents as RawEvent[]
      return (
        <div className="max-h-60 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left px-3 py-1 font-medium text-gray-500">时间</th>
                <th className="text-left px-3 py-1 font-medium text-gray-500">事件</th>
                <th className="text-left px-3 py-1 font-medium text-gray-500">Payload</th>
              </tr>
            </thead>
            <tbody>
              {evts.map((e, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-1 text-gray-400 whitespace-nowrap">{new Date(e.timestamp).toLocaleString('zh-CN')}</td>
                  <td className="px-3 py-1 font-mono text-gray-600">{e.event_type}</td>
                  <td className="px-3 py-1 text-gray-500 max-w-xs truncate">{JSON.stringify(e.payload)}</td>
                </tr>
              ))}
              {evts.length === 0 && <tr><td colSpan={3} className="text-center py-2 text-gray-400">无原始事件</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }

    return null
  }

  const canExpand = expandable || chatExpandable

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">共 {rows.length} 行</span>
        <button onClick={handleExport} className="text-xs text-blue-600 hover:underline">导出 CSV</button>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {canExpand && <th className="w-8" />}
              {columns.map(c => (
                <th
                  key={c.key}
                  onClick={() => handleSort(c.key)}
                  className="text-left px-4 py-2.5 font-medium text-gray-600 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                >
                  {c.label}
                  {sortKey === c.key && <span className="ml-1 text-blue-500">{sortAsc ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((row, ri) => {
              const globalIdx = page * pageSize + ri
              const isExpanded = expandedIdx === globalIdx
              return (
                <Fragment key={globalIdx}>
                  <tr
                    onClick={() => canExpand && setExpandedIdx(isExpanded ? null : globalIdx)}
                    className={`border-b border-gray-100 transition-colors ${canExpand ? 'cursor-pointer hover:bg-blue-50' : ''} ${isExpanded ? 'bg-blue-50' : ''}`}
                  >
                    {canExpand && (
                      <td className="px-2 text-center text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</td>
                    )}
                    {columns.map(c => (
                      <td key={c.key} className="px-4 py-2 text-gray-700 whitespace-nowrap">
                        {formatCell(row[c.key])}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50">
                      <td colSpan={columns.length + (canExpand ? 1 : 0)} className="p-0">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {pageData.length === 0 && (
              <tr>
                <td colSpan={columns.length + (canExpand ? 1 : 0)} className="text-center py-8 text-gray-400">
                  无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
          <span>第 {page + 1}/{totalPages} 页</span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
            >上一页</button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40"
            >下一页</button>
          </div>
        </div>
      )}
    </div>
  )
}

function formatCell(val: unknown): string {
  if (val == null) return '-'
  if (typeof val === 'boolean') return val ? '是' : '否'
  if (typeof val === 'number') return String(val)
  return String(val)
}
