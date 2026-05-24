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
import { normalizeConversations } from '@/lib/conversations'

type TabKey = 'behavior' | 'chats' | 'tasks'

const PAGE_SIZE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPagedRows(createQuery: () => any): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = []
  let from = 0
  while (true) {
    const { data, error } = await createQuery().range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.warn('[Dashboard] paged query failed:', error)
      break
    }
    if (!data) break
    all.push(...(data as Array<Record<string, unknown>>))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-sm text-gray-400 gap-3">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      <span>{label}</span>
    </div>
  )
}

export default function DashboardPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(today)
  const [activeTab, setActiveTab] = useState<TabKey>('behavior')
  const [behaviorTypeFilter, setBehaviorTypeFilter] = useState<string>('')

  // Overview data uses lightweight fields so the dashboard can open quickly.
  const [users, setUsers] = useState<Array<{ user_id: string; email: string }>>([])
  const [overviewEvents, setOverviewEvents] = useState<Array<Record<string, unknown>>>([])
  const [overviewSessions, setOverviewSessions] = useState<Array<Record<string, unknown>>>([])
  const [overviewAIConversations, setOverviewAIConversations] = useState<Array<Record<string, unknown>>>([])
  const [overviewTasks, setOverviewTasks] = useState<Array<Record<string, unknown>>>([])

  // Detail data is loaded after a user/tab is selected.
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([])
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([])
  const [aiConversations, setAIConversations] = useState<Array<Record<string, unknown>>>([])
  const [tasks, setTasks] = useState<Array<Record<string, unknown>>>([])
  const [activities, setActivities] = useState<Array<Record<string, unknown>>>([])
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [behaviorLoading, setBehaviorLoading] = useState(false)
  const [chatsLoading, setChatsLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [behaviorLoadedKey, setBehaviorLoadedKey] = useState<string | null>(null)
  const [chatsLoadedKey, setChatsLoadedKey] = useState<string | null>(null)
  const [tasksLoadedKey, setTasksLoadedKey] = useState<string | null>(null)

  const detailKey = selectedUserId ? `${selectedUserId}|${dateFrom}|${dateTo}` : null

  // ------ 首屏轻量概览 ------
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true)
    try {
      const userIdSet = new Set<string>()

      const fetchAIConversationOverview = async () => {
        const { data, error } = await supabase
          .from('ai_conversations')
          .select('user_id, conversation_id')
          .gte('logical_date', dateFrom)
          .lte('logical_date', dateTo)
        if (error) {
          console.warn('[Dashboard] ai_conversations overview unavailable:', error)
          return [] as Array<Record<string, unknown>>
        }
        return (data ?? []) as Array<Record<string, unknown>>
      }

      const [
        profileRes,
        emailRes,
        overviewEventRows,
        overviewTaskRows,
        overviewSessionRows,
        overviewAIRows,
      ] = await Promise.all([
        supabase.from('profiles').select('user_id'),
        supabase.from('user_emails').select('user_id, email'),
        fetchPagedRows(() =>
          supabase
            .from('tracker_events')
            .select('user_id, date')
            .gte('date', dateFrom)
            .lte('date', dateTo)
        ),
        fetchPagedRows(() =>
          supabase
            .from('tasks')
            .select('user_id, completed')
            .gte('date', dateFrom)
            .lte('date', dateTo)
        ),
        fetchPagedRows(() =>
          supabase
            .from('reflection_sessions')
            .select('user_id, session_key')
            .gte('date', dateFrom)
            .lte('date', dateTo)
        ),
        fetchAIConversationOverview(),
      ])

      for (const row of profileRes.data ?? []) userIdSet.add(row.user_id)
      for (const row of overviewEventRows) userIdSet.add(row.user_id as string)
      for (const row of overviewTaskRows) userIdSet.add(row.user_id as string)
      for (const row of overviewSessionRows) userIdSet.add(row.user_id as string)
      for (const row of overviewAIRows) userIdSet.add(row.user_id as string)

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

      console.log('[Dashboard] 概览加载结果:', {
        users: userIdSet.size,
        events: overviewEventRows.length,
        sessions: overviewSessionRows.length,
        aiConversations: overviewAIRows.length,
        tasks: overviewTaskRows.length,
        dateRange: `${dateFrom} ~ ${dateTo}`,
      })

      setOverviewEvents(overviewEventRows)
      setOverviewTasks(overviewTaskRows)
      setOverviewSessions(overviewSessionRows)
      setOverviewAIConversations(overviewAIRows)
    } finally {
      setOverviewLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { loadOverview() }, [loadOverview])

  // ------ 用户明细按需加载 ------
  useEffect(() => {
    setEvents([])
    setSessions([])
    setAIConversations([])
    setTasks([])
    setActivities([])
    setBehaviorLoadedKey(null)
    setChatsLoadedKey(null)
    setTasksLoadedKey(null)
  }, [detailKey])

  const loadBehaviorData = useCallback(async () => {
    if (!selectedUserId || !detailKey || behaviorLoadedKey === detailKey) return
    setBehaviorLoading(true)
    try {
      const rows = await fetchPagedRows(() =>
        supabase
          .from('tracker_events')
          .select('*')
          .eq('user_id', selectedUserId)
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .order('timestamp', { ascending: true })
      )
      setEvents(rows)
      setBehaviorLoadedKey(detailKey)
      console.log('[Dashboard] 行为明细加载结果:', { userId: selectedUserId, events: rows.length })
    } finally {
      setBehaviorLoading(false)
    }
  }, [behaviorLoadedKey, dateFrom, dateTo, detailKey, selectedUserId])

  const loadChatsData = useCallback(async () => {
    if (!selectedUserId || !detailKey || chatsLoadedKey === detailKey) return
    setChatsLoading(true)
    try {
      const fetchAIConversations = async () => {
        const { data, error } = await supabase
          .from('ai_conversations')
          .select('*')
          .eq('user_id', selectedUserId)
          .gte('logical_date', dateFrom)
          .lte('logical_date', dateTo)
          .order('started_at', { ascending: false })
        if (error) {
          console.warn('[Dashboard] ai_conversations unavailable, fallback to reflection_sessions only:', error)
          return [] as Array<Record<string, unknown>>
        }
        return (data ?? []) as Array<Record<string, unknown>>
      }

      const [sessionRows, aiRows] = await Promise.all([
        fetchPagedRows(() =>
          supabase
            .from('reflection_sessions')
            .select('*')
            .eq('user_id', selectedUserId)
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('started_at', { ascending: false })
        ),
        fetchAIConversations(),
      ])
      setSessions(sessionRows)
      setAIConversations(aiRows)
      setChatsLoadedKey(detailKey)
      console.log('[Dashboard] 对话明细加载结果:', {
        userId: selectedUserId,
        sessions: sessionRows.length,
        aiConversations: aiRows.length,
      })
    } finally {
      setChatsLoading(false)
    }
  }, [chatsLoadedKey, dateFrom, dateTo, detailKey, selectedUserId])

  const loadTasksData = useCallback(async () => {
    if (!selectedUserId || !detailKey || tasksLoadedKey === detailKey) return
    setTasksLoading(true)
    try {
      const [taskRows, activityRows] = await Promise.all([
        fetchPagedRows(() =>
          supabase
            .from('tasks')
            .select('*')
            .eq('user_id', selectedUserId)
            .gte('date', dateFrom)
            .lte('date', dateTo)
        ),
        fetchPagedRows(() =>
          supabase
            .from('activity_records')
            .select('*')
            .eq('user_id', selectedUserId)
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('ts', { ascending: true })
        ),
      ])
      setTasks(taskRows)
      setActivities(activityRows)
      setTasksLoadedKey(detailKey)
      console.log('[Dashboard] 任务与活跃明细加载结果:', {
        userId: selectedUserId,
        tasks: taskRows.length,
        activities: activityRows.length,
      })
    } finally {
      setTasksLoading(false)
    }
  }, [dateFrom, dateTo, detailKey, selectedUserId, tasksLoadedKey])

  useEffect(() => {
    if (!selectedUserId) return
    if (activeTab === 'behavior') loadBehaviorData()
    if (activeTab === 'chats') loadChatsData()
    if (activeTab === 'tasks') loadTasksData()
  }, [activeTab, loadBehaviorData, loadChatsData, loadTasksData, selectedUserId])

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
    for (const e of overviewEvents) {
      const uid = e.user_id as string
      const card = map.get(uid)
      if (card) card.eventCount++
      const d = e.date as string
      if (!dayEventCount.has(uid)) dayEventCount.set(uid, new Map())
      const dc = dayEventCount.get(uid)!
      dc.set(d, (dc.get(d) ?? 0) + 1)
    }

    for (const s of overviewSessions) {
      const uid = s.user_id as string
      const card = map.get(uid)
      if (card) card.chatCount++
    }

    for (const c of overviewAIConversations) {
      const uid = c.user_id as string
      const card = map.get(uid)
      if (card) card.chatCount++
    }

    for (const [uid, card] of map) {
      const userTasks = overviewTasks.filter(t => t.user_id === uid)
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
  }, [users, overviewEvents, overviewSessions, overviewAIConversations, overviewTasks, selectedUserId])

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

  const conversations = useMemo(
    () => normalizeConversations(aiConversations, sessions),
    [aiConversations, sessions]
  )

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

      {!selectedUserId && overviewLoading ? (
        <LoadingBlock label="正在加载用户概览..." />
      ) : !selectedUserId ? (
        /* 状态 A：用户卡片 */
        <UserCardGrid users={userCards} onSelectUser={uid => handleSelectUser(uid)} />
      ) : (
        /* 状态 B：统计条 + Tab */
        <div>
          {behaviorLoading && events.length === 0 ? (
            <LoadingBlock label="正在加载用户统计..." />
          ) : (
            <QuickStats stats={quickStats} onStatClick={handleStatClick} />
          )}

          {/* 事件配对完整性校验 */}
          {events.length > 0 && (
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
          )}

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
              behaviorLoading
                ? <LoadingBlock label="正在加载行为记录..." />
                : (
                  <BehaviorTab
                    events={events as never[]}
                    timelineItems={timelineItems}
                    initialTypeFilter={behaviorTypeFilter}
                  />
                )
            )}
            {activeTab === 'chats' && (
              chatsLoading
                ? <LoadingBlock label="正在加载对话内容..." />
                : <ChatsTab conversations={conversations} />
            )}
            {activeTab === 'tasks' && (
              tasksLoading
                ? <LoadingBlock label="正在加载任务与活跃数据..." />
                : (
                  <TasksActivityTab
                    tasks={tasks as never[]}
                    activities={activities as never[]}
                  />
                )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
