'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcQuickStats, calcPairChecks } from '@/lib/stats'
import { mergeTimeline } from '@/lib/merge-timeline'
import FilterBar from '@/components/FilterBar'
import UserCardGrid from '@/components/UserCardGrid'
import type { UserCardData } from '@/components/UserCard'
import QuickStats from '@/components/QuickStats'
import { STAT_DEFS } from '@/components/QuickStats'
import BehaviorTab from '@/components/BehaviorTab'
import ChatsTab from '@/components/ChatsTab'
import TasksActivityTab from '@/components/TasksActivityTab'

type TabKey = 'behavior' | 'chats' | 'tasks'

export default function DashboardPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(today)
  const [activeTab, setActiveTab] = useState<TabKey>('behavior')
  const [behaviorTypeFilter, setBehaviorTypeFilter] = useState<string>('')

  // Raw data
  const [users, setUsers] = useState<Array<{ user_id: string; email: string }>>([])
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([])
  const [tasks, setTasks] = useState<Array<Record<string, unknown>>>([])
  const [activities, setActivities] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)

  // ------ 加载用户列表 ------
  useEffect(() => {
    async function loadUsers() {
      const userIdSet = new Set<string>()

      const [profileRes, evtRes, taskRes, emailRes] = await Promise.all([
        supabase.from('profiles').select('user_id'),
        supabase.from('tracker_events').select('user_id'),
        supabase.from('tasks').select('user_id'),
        supabase.from('user_emails').select('user_id, email'),
      ])

      for (const row of profileRes.data ?? []) userIdSet.add(row.user_id)
      for (const row of evtRes.data ?? []) userIdSet.add(row.user_id)
      for (const row of taskRes.data ?? []) userIdSet.add(row.user_id)

      const emailMap = new Map<string, string>()
      for (const r of emailRes.data ?? []) {
        const name = (r.email as string)?.replace(/@app\.local$/, '') ?? ''
        if (name) emailMap.set(r.user_id, name)
      }

      console.log('[Dashboard] 发现用户数:', userIdSet.size)

      setUsers(Array.from(userIdSet).map(uid => ({
        user_id: uid,
        email: emailMap.get(uid) ?? uid.slice(0, 12) + '...',
      })))
    }
    loadUsers()
  }, [])

  // ------ 加载数据 ------
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseFilter = (query: any) => {
        if (selectedUserId) return query.eq('user_id', selectedUserId)
        return query
      }

      // 分页加载所有 tracker_events（Supabase 单次请求上限 1000 条）
      const PAGE_SIZE = 1000
      const fetchAllEvents = async () => {
        const all: typeof events = []
        let from = 0
        while (true) {
          const { data, error } = await baseFilter(
            supabase.from('tracker_events').select('*')
          )
            .gte('date', dateFrom).lte('date', dateTo)
            .order('timestamp', { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
          if (error || !data) break
          all.push(...data)
          if (data.length < PAGE_SIZE) break
          from += PAGE_SIZE
        }
        return all
      }

      const [allEvents, sessRes, taskRes, actRes] = await Promise.all([
        fetchAllEvents(),
        baseFilter(supabase.from('reflection_sessions').select('*'))
          .gte('date', dateFrom).lte('date', dateTo)
          .order('started_at', { ascending: false }),
        baseFilter(supabase.from('tasks').select('*'))
          .gte('date', dateFrom).lte('date', dateTo),
        baseFilter(supabase.from('activity_records').select('*'))
          .gte('date', dateFrom).lte('date', dateTo)
          .order('ts', { ascending: true }),
      ])

      console.log('[Dashboard] 数据加载结果:', {
        events: allEvents.length,
        sessions: sessRes.data?.length ?? 0, sessError: sessRes.error,
        tasks: taskRes.data?.length ?? 0, taskError: taskRes.error,
        activities: actRes.data?.length ?? 0, actError: actRes.error,
        dateRange: `${dateFrom} ~ ${dateTo}`,
      })

      setEvents(allEvents)
      setSessions(sessRes.data ?? [])
      setTasks(taskRes.data ?? [])
      setActivities(actRes.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [selectedUserId, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // ------ 用户卡片数据 ------
  const userCards: UserCardData[] = useMemo(() => {
    if (selectedUserId) return []
    const map = new Map<string, UserCardData>()
    for (const u of users) {
      map.set(u.user_id, {
        userId: u.user_id,
        email: u.email,
        eventCount: 0,
        chatCount: 0,
        taskCompletionRate: null,
        activeDays: 0,
        dailyTrend: [],
      })
    }

    // 聚合 events
    const dayEventCount = new Map<string, Map<string, number>>()
    for (const e of events) {
      const uid = e.user_id as string
      const card = map.get(uid)
      if (card) card.eventCount++
      const d = e.date as string
      if (!dayEventCount.has(uid)) dayEventCount.set(uid, new Map())
      const dc = dayEventCount.get(uid)!
      dc.set(d, (dc.get(d) ?? 0) + 1)
    }

    for (const s of sessions) {
      const uid = s.user_id as string
      const card = map.get(uid)
      if (card) card.chatCount++
    }

    for (const [uid, card] of map) {
      const userTasks = tasks.filter(t => t.user_id === uid)
      card.taskCompletionRate = userTasks.length > 0
        ? userTasks.filter(t => t.completed).length / userTasks.length
        : null

      const dc = dayEventCount.get(uid)
      if (dc) {
        card.activeDays = dc.size
        card.dailyTrend = Array.from(dc.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count }))
      }
    }

    return Array.from(map.values()).sort((a, b) => b.eventCount - a.eventCount)
  }, [users, events, sessions, tasks, selectedUserId])

  // ------ 快速统计 ------
  const quickStats = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typedEvents = events as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typedTasks = tasks as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typedActivities = activities as any[]
    return calcQuickStats(typedEvents, typedTasks, typedActivities)
  }, [events, tasks, activities])

  // ------ 事件配对完整性校验 ------
  const pairChecks = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return calcPairChecks(events as any[])
  }, [events])

  // ------ 时间线 ------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timelineItems = useMemo(() => mergeTimeline(events as any[], sessions as any[]), [events, sessions])

  // ------ 统计条点击 → 跳转 Tab + 设筛选 ------
  const handleStatClick = (statKey: string) => {
    const def = STAT_DEFS.find(d => d.key === statKey)
    if (!def) return
    if (def.tab === 'tasks') {
      setActiveTab('tasks')
    } else {
      setActiveTab('behavior')
      setBehaviorTypeFilter(def.filter)
    }
  }

  const handleSelectUser = (userId: string | null) => {
    setSelectedUserId(userId)
    if (userId) setActiveTab('behavior')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <FilterBar
        users={users}
        selectedUserId={selectedUserId}
        onSelectUser={handleSelectUser}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
      />

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : !selectedUserId ? (
        /* 状态 A：用户卡片 */
        <UserCardGrid users={userCards} onSelectUser={uid => handleSelectUser(uid)} />
      ) : (
        /* 状态 B：统计条 + Tab */
        <div>
          <QuickStats stats={quickStats} onStatClick={handleStatClick} />

          {/* 事件配对完整性校验 */}
          <div className="px-6 pb-2">
            <details className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50 select-none flex items-center gap-2">
                <span>🔍 数据配对完整性</span>
                <span className="text-xs text-gray-400 font-normal">
                  （共 {pairChecks.totalEvents} 条事件）
                </span>
                {pairChecks.checks.some(c => c.orphanCount > 0) && (
                  <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                    有未配对事件
                  </span>
                )}
              </summary>
              <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {pairChecks.checks.map(c => (
                  <div
                    key={c.label}
                    className={`rounded-lg border p-3 ${
                      c.orphanCount > 0
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-green-200 bg-green-50'
                    }`}
                  >
                    <p className="text-xs text-gray-600 mb-1">{c.label}</p>
                    <p className="text-lg font-bold">
                      {c.rate !== null ? `${Math.round(c.rate * 100)}%` : '-'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {c.ended}/{c.started} 已配对
                      {c.orphanCount > 0 && (
                        <span className="text-amber-600 font-medium ml-1">
                          ({c.orphanCount} 未闭合)
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </div>

          {/* Tab 导航 */}
          <div className="px-6 pt-2 pb-4">
            <div className="flex items-center gap-1 border-b border-gray-200">
              {([
                { key: 'behavior' as TabKey, label: '行为记录' },
                { key: 'chats' as TabKey, label: '对话内容' },
                { key: 'tasks' as TabKey, label: '任务与活跃' },
              ]).map(tab => (
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
          <div className="px-6 pb-8">
            {activeTab === 'behavior' && (
              <BehaviorTab
                events={events as never[]}
                timelineItems={timelineItems}
                initialTypeFilter={behaviorTypeFilter}
              />
            )}
            {activeTab === 'chats' && (
              <ChatsTab sessions={sessions as never[]} />
            )}
            {activeTab === 'tasks' && (
              <TasksActivityTab
                tasks={tasks as never[]}
                activities={activities as never[]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
