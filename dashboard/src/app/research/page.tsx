'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import type { RawEvent } from '@/lib/research-export'
import ParticipantsTab from '@/components/research/ParticipantsTab'
import SessionsTab from '@/components/research/SessionsTab'
import StuckTab from '@/components/research/StuckTab'
import ReflectionsTab from '@/components/research/ReflectionsTab'
import DailyTab from '@/components/research/DailyTab'
import UserTimelineTab from '@/components/research/UserTimelineTab'

type TabKey = 'participants' | 'sessions' | 'stuck' | 'reflections' | 'daily' | 'timeline'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'participants', label: '参与者概况' },
  { key: 'sessions', label: '会话明细' },
  { key: 'stuck', label: '卡顿 Episode' },
  { key: 'reflections', label: '反思记录' },
  { key: 'daily', label: '每日汇总' },
  { key: 'timeline', label: '用户时间线' },
]

export default function ResearchPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(today)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('participants')
  const [loading, setLoading] = useState(true)

  const [users, setUsers] = useState<Array<{ user_id: string; email: string }>>([])
  const [events, setEvents] = useState<RawEvent[]>([])
  const [tasks, setTasks] = useState<Array<Record<string, unknown>>>([])
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([])

  // ---------- 加载用户列表 ----------
  useEffect(() => {
    async function load() {
      const idSet = new Set<string>()
      const [pRes, eRes, tRes, emailRes] = await Promise.all([
        supabase.from('profiles').select('user_id'),
        supabase.from('tracker_events').select('user_id'),
        supabase.from('tasks').select('user_id'),
        supabase.from('user_emails').select('user_id, email'),
      ])
      for (const r of pRes.data ?? []) idSet.add(r.user_id)
      for (const r of eRes.data ?? []) idSet.add(r.user_id)
      for (const r of tRes.data ?? []) idSet.add(r.user_id)

      const emailMap = new Map<string, string>()
      for (const r of emailRes.data ?? []) {
        const name = (r.email as string)?.replace(/@app\.local$/, '') ?? ''
        if (name) emailMap.set(r.user_id, name)
      }

      setUsers(Array.from(idSet).map(uid => ({
        user_id: uid,
        email: emailMap.get(uid) ?? uid.slice(0, 12) + '...',
      })))
    }
    load()
  }, [])

  // ---------- 加载核心数据 ----------
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseFilter = (query: any) => {
        if (selectedUserId) return query.eq('user_id', selectedUserId)
        return query
      }

      const PAGE = 1000
      const fetchAll = async () => {
        const all: RawEvent[] = []
        let from = 0
        while (true) {
          const { data, error } = await baseFilter(
            supabase.from('tracker_events').select('*')
          ).gte('date', dateFrom).lte('date', dateTo)
            .order('timestamp', { ascending: true })
            .range(from, from + PAGE - 1)
          if (error || !data) break
          all.push(...(data as RawEvent[]))
          if (data.length < PAGE) break
          from += PAGE
        }
        return all
      }

      const [allEvents, sessRes, taskRes] = await Promise.all([
        fetchAll(),
        baseFilter(supabase.from('reflection_sessions').select('*'))
          .gte('date', dateFrom).lte('date', dateTo)
          .order('started_at', { ascending: false }),
        baseFilter(supabase.from('tasks').select('*'))
          .gte('date', dateFrom).lte('date', dateTo),
      ])

      setEvents(allEvents)
      setSessions(sessRes.data ?? [])
      setTasks(taskRes.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [selectedUserId, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // ---------- 筛选后的事件 ----------
  const filteredEvents = useMemo(() => {
    if (!selectedUserId) return events
    return events.filter(e => e.user_id === selectedUserId)
  }, [events, selectedUserId])

  const filteredTasks = useMemo(() => {
    if (!selectedUserId) return tasks
    return tasks.filter(t => t.user_id === selectedUserId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, [tasks, selectedUserId]) as any[]

  const filteredSessions = useMemo(() => {
    if (!selectedUserId) return sessions
    return sessions.filter(s => s.user_id === selectedUserId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, [sessions, selectedUserId]) as any[]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶栏 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-6 flex-wrap">
        <a href="/" className="text-sm text-blue-600 hover:underline">← 返回看板</a>
        <h1 className="text-lg font-bold text-gray-800">研究分析</h1>

        {/* 日期筛选 */}
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-500">日期</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
          <span className="text-gray-400">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </div>

        {/* 用户筛选 */}
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-500">用户</label>
          <select
            value={selectedUserId ?? '__all__'}
            onChange={e => setSelectedUserId(e.target.value === '__all__' ? null : e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm min-w-[160px]"
          >
            <option value="__all__">全部用户</option>
            {users.map(u => (
              <option key={u.user_id} value={u.user_id}>{u.email}</option>
            ))}
          </select>
        </div>

        {/* 数据量 */}
        <span className="text-xs text-gray-400 ml-auto">
          {loading ? '加载中...' : `${filteredEvents.length} 事件 · ${filteredTasks.length} 任务 · ${filteredSessions.length} 反思`}
        </span>
      </div>

      {/* Tab 导航 */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-1 border-b border-gray-200">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            {activeTab === 'participants' && (
              <ParticipantsTab events={filteredEvents} tasks={filteredTasks} users={users} />
            )}
            {activeTab === 'sessions' && (
              <SessionsTab events={filteredEvents} users={users} />
            )}
            {activeTab === 'stuck' && (
              <StuckTab events={filteredEvents} users={users} />
            )}
            {activeTab === 'reflections' && (
              <ReflectionsTab events={filteredEvents} sessions={filteredSessions} users={users} />
            )}
            {activeTab === 'daily' && (
              <DailyTab events={filteredEvents} tasks={filteredTasks} users={users} />
            )}
            {activeTab === 'timeline' && (
              <UserTimelineTab
                events={filteredEvents}
                sessions={filteredSessions}
                users={users}
                selectedUserId={selectedUserId}
                onSelectUser={setSelectedUserId}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
