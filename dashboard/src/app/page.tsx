'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { format, subDays } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { calcQuickStats } from '@/lib/stats'
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
      // 从多个表收集所有出现过的 user_id
      const userIdSet = new Set<string>()

      const [profileRes, evtRes, taskRes] = await Promise.all([
        supabase.from('profiles').select('user_id'),
        supabase.from('tracker_events').select('user_id'),
        supabase.from('tasks').select('user_id'),
      ])

      for (const row of profileRes.data ?? []) userIdSet.add(row.user_id)
      for (const row of evtRes.data ?? []) userIdSet.add(row.user_id)
      for (const row of taskRes.data ?? []) userIdSet.add(row.user_id)

      console.log('[Dashboard] 发现用户数:', userIdSet.size, Array.from(userIdSet))

      const userList = Array.from(userIdSet).map(uid => ({
        user_id: uid,
        email: uid.slice(0, 12) + '...',
      }))

      setUsers(userList)
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

      const [evtRes, sessRes, taskRes, actRes] = await Promise.all([
        baseFilter(supabase.from('tracker_events').select('*'))
          .gte('date', dateFrom).lte('date', dateTo)
          .order('timestamp', { ascending: true })
          .limit(5000),
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
        events: evtRes.data?.length ?? 0, evtError: evtRes.error,
        sessions: sessRes.data?.length ?? 0, sessError: sessRes.error,
        tasks: taskRes.data?.length ?? 0, taskError: taskRes.error,
        activities: actRes.data?.length ?? 0, actError: actRes.error,
        dateRange: `${dateFrom} ~ ${dateTo}`,
      })

      setEvents(evtRes.data ?? [])
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
