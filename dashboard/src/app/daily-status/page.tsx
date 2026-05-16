'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import DefinitionTooltip from '@/components/DefinitionTooltip'
import { supabase } from '@/lib/supabase'
import {
  DAILY_STATUS_DEFINITIONS,
  buildDailyStatusMetrics,
  buildDailyStatusRows,
  type DailyStatusRow,
  type StatusTone,
} from '@/lib/daily-status'

const STATUS_EVENT_TYPES = [
  'session.started',
  'exec.micro_started',
  'plan.first_micro',
  'reflect.opened',
  'reflect.message_sent',
]

const pageStyle = {
  background: '#f8fafc',
  color: '#111827',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  minHeight: '100vh',
} satisfies React.CSSProperties

const headerStyle = {
  background: 'rgba(255, 255, 255, 0.96)',
  borderBottom: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
  padding: '16px 24px',
  position: 'sticky',
  top: 0,
  zIndex: 40,
} satisfies React.CSSProperties

const buttonStyle = {
  background: '#2563eb',
  border: 0,
  borderRadius: 10,
  color: '#fff',
  cursor: 'pointer',
  fontSize: 14,
  padding: '8px 14px',
} satisfies React.CSSProperties

const cardStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  padding: 16,
} satisfies React.CSSProperties

const tableCellStyle = {
  borderBottom: '1px solid #f1f5f9',
  padding: '12px 16px',
  whiteSpace: 'nowrap',
} satisfies React.CSSProperties

function toneClass(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'border-green-200 bg-green-50 text-green-700'
    case 'warning':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'danger':
      return 'border-rose-200 bg-rose-50 text-rose-700'
    default:
      return 'border-gray-200 bg-gray-50 text-gray-600'
  }
}

function StatusBadge({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const toneStyle: Record<StatusTone, React.CSSProperties> = {
    success: { background: '#f0fdf4', borderColor: '#bbf7d0', color: '#15803d' },
    warning: { background: '#fffbeb', borderColor: '#fde68a', color: '#b45309' },
    danger: { background: '#fff1f2', borderColor: '#fecdd3', color: '#be123c' },
    muted: { background: '#f8fafc', borderColor: '#e5e7eb', color: '#64748b' },
  }

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass(tone)}`}
      style={{
        border: '1px solid',
        borderRadius: 999,
        display: 'inline-flex',
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 10px',
        ...toneStyle[tone],
      }}
    >
      {children}
    </span>
  )
}

function HeaderWithDefinition({
  children,
  definitionKey,
}: {
  children: React.ReactNode
  definitionKey: keyof typeof DAILY_STATUS_DEFINITIONS
}) {
  const definition = DAILY_STATUS_DEFINITIONS[definitionKey]
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <DefinitionTooltip label={definition.label} description={definition.description} />
    </span>
  )
}

export default function DailyStatusPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedDate, setSelectedDate] = useState(today)
  const [rows, setRows] = useState<DailyStatusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [emailRes, profileRes, moodRes, taskRes, eventRes] = await Promise.all([
        supabase.from('user_emails').select('user_id, email'),
        supabase.from('profiles').select('user_id, plan_time, reflection_time'),
        supabase.from('mood_records').select('user_id, mood').eq('date', selectedDate),
        supabase.from('tasks').select('user_id, id').eq('date', selectedDate),
        supabase.from('tracker_events').select('user_id, event_type, timestamp')
          .eq('date', selectedDate)
          .in('event_type', STATUS_EVENT_TYPES),
      ])

      const firstError = profileRes.error || moodRes.error || taskRes.error || eventRes.error
      if (firstError) throw firstError

      const userMap = new Map<string, string>()
      if (!emailRes.error) {
        for (const row of emailRes.data ?? []) {
          const userId = String(row.user_id || '')
          if (!userId) continue
          const email = String(row.email || '').replace(/@app\.local$/, '')
          userMap.set(userId, email || `${userId.slice(0, 12)}...`)
        }
      }

      for (const group of [profileRes.data, moodRes.data, taskRes.data, eventRes.data]) {
        for (const row of group ?? []) {
          const userId = String(row.user_id || '')
          if (userId && !userMap.has(userId)) userMap.set(userId, `${userId.slice(0, 12)}...`)
        }
      }

      setRows(buildDailyStatusRows({
        users: Array.from(userMap.entries()).map(([user_id, email]) => ({ user_id, email })),
        profiles: profileRes.data ?? [],
        moods: moodRes.data ?? [],
        tasks: taskRes.data ?? [],
        events: eventRes.data ?? [],
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载今日状态失败')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => { loadData() }, [loadData])

  const metrics = useMemo(() => buildDailyStatusMetrics(rows), [rows])

  return (
    <div className="min-h-screen bg-gray-50" style={pageStyle}>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white px-6 py-4 shadow-sm" style={headerStyle}>
        <div className="flex flex-wrap items-center gap-4" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Link href="/" className="text-sm text-blue-600 hover:underline" style={{ color: '#2563eb', fontSize: 14, textDecoration: 'none' }}>返回看板</Link>
          <div>
            <h1 className="text-lg font-bold text-gray-900" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>今日状态</h1>
            <p className="text-xs text-gray-500" style={{ color: '#64748b', fontSize: 12, margin: '4px 0 0' }}>一览所有账号当天是否记录情绪、开始计划和开始反思</p>
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm" style={{ alignItems: 'center', display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <label className="text-gray-500" style={{ color: '#64748b', fontSize: 14 }}>日期</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              style={{ border: '1px solid #d1d5db', borderRadius: 10, fontSize: 14, padding: '7px 10px' }}
            />
            <button
              onClick={loadData}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-700"
              style={buttonStyle}
            >
              刷新
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6" style={{ padding: 24 }}>
        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" style={{ ...cardStyle, background: '#fff1f2', borderColor: '#fecdd3', color: '#be123c', marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center" style={{ alignItems: 'center', display: 'flex', height: 256, justifyContent: 'center' }}>
            <p style={{ color: '#64748b', fontSize: 14 }}>正在加载今日状态...</p>
          </div>
        ) : (
          <>
            <section
              className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
              style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 24 }}
            >
              {metrics.map(metric => {
                const definition = metric.definitionKey ? DAILY_STATUS_DEFINITIONS[metric.definitionKey] : null
                return (
                  <div key={metric.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" style={cardStyle}>
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-gray-500" style={{ alignItems: 'center', color: '#64748b', display: 'flex', fontSize: 12, gap: 6, margin: '0 0 4px' }}>
                      {metric.label}
                      {definition && <DefinitionTooltip label={definition.label} description={definition.description} />}
                    </p>
                    <p className="text-2xl font-bold text-gray-900" style={{ color: '#111827', fontSize: 28, fontWeight: 800, lineHeight: 1.1, margin: 0 }}>{metric.value}</p>
                    <p className="mt-1 text-xs text-gray-400" style={{ color: '#94a3b8', fontSize: 12, margin: '6px 0 0' }}>{metric.detail}</p>
                  </div>
                )
              })}
            </section>

            <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" style={{ ...cardStyle, overflow: 'hidden', padding: 0 }}>
              <div className="border-b border-gray-100 px-4 py-3" style={{ borderBottom: '1px solid #f1f5f9', padding: '14px 16px' }}>
                <h2 className="text-sm font-semibold text-gray-800" style={{ color: '#1f2937', fontSize: 15, fontWeight: 700, margin: 0 }}>账号状态明细</h2>
                <p className="mt-0.5 text-xs text-gray-500" style={{ color: '#64748b', fontSize: 12, margin: '4px 0 0' }}>鼠标悬停在表头的问号上，可以查看每一列的判断口径。</p>
              </div>
              <div className="overflow-x-auto" style={{ overflowX: 'auto' }}>
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%' }}>
                  <thead className="border-b border-gray-200 bg-gray-50" style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                    <tr>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>账号</th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>
                        <HeaderWithDefinition definitionKey="mood">情绪记录</HeaderWithDefinition>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>
                        <HeaderWithDefinition definitionKey="planStarted">计划状态</HeaderWithDefinition>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>
                        <HeaderWithDefinition definitionKey="reflectionStarted">反思状态</HeaderWithDefinition>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>
                        <HeaderWithDefinition definitionKey="planTime">计划提醒时间</HeaderWithDefinition>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>
                        <HeaderWithDefinition definitionKey="reflectionTime">反思提醒时间</HeaderWithDefinition>
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-gray-600" style={{ ...tableCellStyle, color: '#475569', fontWeight: 700, textAlign: 'left' }}>
                        <HeaderWithDefinition definitionKey="lastActivityAt">最后活动时间</HeaderWithDefinition>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.userId} className="border-b border-gray-100 hover:bg-blue-50/40">
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900" style={{ ...tableCellStyle, color: '#111827', fontWeight: 700 }}>{row.email}</td>
                        <td className="whitespace-nowrap px-4 py-3" style={tableCellStyle}>
                          <StatusBadge tone={row.mood !== null ? 'success' : 'danger'}>{row.moodText}</StatusBadge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3" style={tableCellStyle}>
                          <StatusBadge tone={row.planTone}>{row.planStatusText}</StatusBadge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3" style={tableCellStyle}>
                          <StatusBadge tone={row.reflectionTone}>{row.reflectionStatusText}</StatusBadge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700" style={{ ...tableCellStyle, color: '#374151' }}>{row.planTimeText}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700" style={{ ...tableCellStyle, color: '#374151' }}>{row.reflectionTimeText}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-500" style={{ ...tableCellStyle, color: '#64748b' }}>{row.lastActivityText}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-gray-400" style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>暂无账号数据</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
