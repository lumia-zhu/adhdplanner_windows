/**
 * 研究分析数据聚合层
 *
 * 将原始 tracker_events 加工成 5 张"分析表"，
 * 每张表对应一个分析单元（用户/会话/卡顿/反思/天）。
 *
 * 每个函数返回 { metrics, table }：
 *   metrics — 指标卡片数据（含分子分母和计算公式）
 *   table   — { columns, rows }，rows 携带 _rawEvents 用于展开校验
 */

// ===================== 通用类型 =====================

export interface Column {
  key: string
  label: string
}

export interface Row {
  [key: string]: unknown
  _rawEvents?: RawEvent[]
  _messages?: Array<{ role: string; content: string; ts?: number }>
}

export interface TableData {
  columns: Column[]
  rows: Row[]
}

export interface RawEvent {
  event_id?: string
  event_type: string
  timestamp: number
  date?: string
  user_id?: string
  payload: Record<string, unknown>
  [key: string]: unknown
}

export interface Metric {
  label: string
  value: string
  detail: string
  formula: string
}

// ===================== 辅助 =====================

function eventsOfType(events: RawEvent[], type: string): RawEvent[] {
  return events.filter(e => e.event_type === type)
}

function pct(n: number, d: number): string {
  if (d === 0) return '-'
  return `${Math.round((n / d) * 100)}%`
}

function fmtMin(sec: number): number {
  return Math.round(sec / 60)
}

function pStr(e: RawEvent, k: string): string {
  return String(e.payload?.[k] ?? '')
}

function pNum(e: RawEvent, k: string): number {
  return Number(e.payload?.[k]) || 0
}

function pBool(e: RawEvent, k: string): boolean {
  return !!e.payload?.[k]
}

// ===================== 1. 参与者概况 =====================

export function buildParticipantsSummary(
  allEvents: RawEvent[],
  allTasks: Array<{ user_id: string; completed: boolean }>,
  users: Array<{ user_id: string; email: string }>
): { metrics: Metric[]; table: TableData } {
  const userMap = new Map<string, {
    activeDays: Set<string>; sessionCount: number; focusSec: number
    taskTotal: number; taskDone: number
    aiChip: number; firstMicro: number
    stuck: number; reflEnd: number; reflOpen: number
  }>()

  const ensure = (uid: string) => {
    if (!userMap.has(uid)) userMap.set(uid, {
      activeDays: new Set(), sessionCount: 0, focusSec: 0,
      taskTotal: 0, taskDone: 0,
      aiChip: 0, firstMicro: 0,
      stuck: 0, reflEnd: 0, reflOpen: 0,
    })
    return userMap.get(uid)!
  }

  for (const u of users) ensure(u.user_id)

  for (const e of allEvents) {
    const uid = e.user_id as string
    if (!uid) continue
    const u = ensure(uid)
    if (e.date) u.activeDays.add(e.date as string)
    switch (e.event_type) {
      case 'session.started': u.sessionCount++; break
      case 'session.ended': u.focusSec += pNum(e, 'totalDurationSeconds'); break
      case 'plan.first_micro':
        u.firstMicro++
        if (pStr(e, 'source') === 'ai_chip') u.aiChip++
        break
      case 'stuck.triggered': u.stuck++; break
      case 'reflect.ended': u.reflEnd++; break
      case 'reflect.opened': u.reflOpen++; break
    }
  }

  for (const t of allTasks) {
    const u = ensure(t.user_id)
    u.taskTotal++
    if (t.completed) u.taskDone++
  }

  const rows: Row[] = []
  let idx = 0
  for (const [uid, u] of userMap) {
    idx++
    rows.push({
      pNum: `P${idx}`, userId: uid,
      activeDays: u.activeDays.size,
      sessions: u.sessionCount,
      focusMin: fmtMin(u.focusSec),
      taskRate: u.taskTotal > 0 ? pct(u.taskDone, u.taskTotal) : '-',
      _taskDone: u.taskDone, _taskTotal: u.taskTotal,
      aiRate: u.firstMicro > 0 ? pct(u.aiChip, u.firstMicro) : '-',
      _aiChip: u.aiChip, _firstMicro: u.firstMicro,
      stuckCount: u.stuck,
      reflectEnded: u.reflEnd,
      reflectOpened: u.reflOpen,
    })
  }

  const n = rows.length
  const sumDays = rows.reduce((s, r) => s + (r.activeDays as number), 0)
  const sumFocus = rows.reduce((s, r) => s + (r.focusMin as number), 0)
  const sumTaskDone = rows.reduce((s, r) => s + (r._taskDone as number), 0)
  const sumTaskTotal = rows.reduce((s, r) => s + (r._taskTotal as number), 0)

  return {
    metrics: [
      { label: '参与者总数', value: String(n), detail: '', formula: '去重 user_id 数' },
      { label: '平均活跃天数', value: n > 0 ? String(Math.round(sumDays / n)) : '0', detail: `总 ${sumDays} 天`, formula: '各用户有事件的日期数均值' },
      { label: '平均专注时长', value: `${n > 0 ? Math.round(sumFocus / n) : 0} 分钟`, detail: `总 ${sumFocus} 分钟`, formula: 'session.ended.totalDurationSeconds 求和/60/用户数' },
      { label: '平均任务完成率', value: sumTaskTotal > 0 ? pct(sumTaskDone, sumTaskTotal) : '-', detail: `${sumTaskDone} / ${sumTaskTotal}`, formula: '所有用户 completed / total tasks' },
    ],
    table: {
      columns: [
        { key: 'pNum', label: 'P#' },
        { key: 'activeDays', label: '活跃天数' },
        { key: 'sessions', label: '会话数' },
        { key: 'focusMin', label: '专注(分钟)' },
        { key: 'taskRate', label: '任务完成率' },
        { key: 'aiRate', label: 'AI采纳率' },
        { key: 'stuckCount', label: '卡顿次数' },
        { key: 'reflectEnded', label: '完整反思' },
        { key: 'reflectOpened', label: '反思访问' },
      ],
      rows,
    },
  }
}

// ===================== 2. 会话明细 =====================

export function buildSessionsDetail(events: RawEvent[]): { metrics: Metric[]; table: TableData } {
  const started = eventsOfType(events, 'session.started')
  const ended = eventsOfType(events, 'session.ended')

  const stuckCnt = new Map<string, number>()
  for (const e of eventsOfType(events, 'stuck.triggered')) {
    const sid = pStr(e, 'sessionId')
    stuckCnt.set(sid, (stuckCnt.get(sid) ?? 0) + 1)
  }

  const firstMicroByTask = new Map<string, string>()
  for (const e of eventsOfType(events, 'plan.first_micro'))
    firstMicroByTask.set(pStr(e, 'taskId'), pStr(e, 'source'))

  const endMap = new Map<string, RawEvent>()
  for (const e of ended) endMap.set(pStr(e, 'sessionId'), e)

  const rows: Row[] = started.map(s => {
    const sid = pStr(s, 'sessionId')
    const endE = endMap.get(sid)
    const taskId = pStr(s, 'taskId')
    const rawEvts = events.filter(e => pStr(e, 'sessionId') === sid || (e.payload?.sessionId === sid))
    return {
      date: (s.date as string) || new Date(s.timestamp).toISOString().slice(0, 10),
      userId: s.user_id as string,
      taskTitle: pStr(s, 'taskTitle') || taskId,
      durationSec: endE ? pNum(endE, 'totalDurationSeconds') : '-',
      microSteps: endE ? pNum(endE, 'completedMicroSteps') : '-',
      endReason: endE ? pStr(endE, 'endReason') : '未结束',
      firstMicroSource: firstMicroByTask.get(taskId) ?? '-',
      isQuickFocus: pBool(s, 'isQuickFocus') ? '是' : '否',
      hadStuck: (stuckCnt.get(sid) ?? 0) > 0 ? '是' : '否',
      stuckCount: stuckCnt.get(sid) ?? 0,
      _rawEvents: rawEvts,
    }
  })

  const total = rows.length
  const endedRows = rows.filter(r => r.endReason !== '未结束')
  const totalSec = endedRows.reduce((s, r) => s + (typeof r.durationSec === 'number' ? r.durationSec : 0), 0)
  const avgSec = endedRows.length > 0 ? Math.round(totalSec / endedRows.length) : 0
  const doneN = endedRows.filter(r => r.endReason === 'task_done').length

  return {
    metrics: [
      { label: '总会话数', value: String(total), detail: `${endedRows.length} 已结束`, formula: 'session.started 计数' },
      { label: '总专注时长', value: `${fmtMin(totalSec)} 分钟`, detail: `${totalSec} 秒`, formula: 'session.ended.totalDurationSeconds 求和' },
      { label: '平均会话时长', value: `${avgSec} 秒`, detail: `${endedRows.length} 个已结束会话`, formula: '总秒数 / 已结束会话数' },
      { label: '完成率', value: pct(doneN, endedRows.length), detail: `${doneN} / ${endedRows.length}`, formula: 'endReason=task_done / 已结束会话数' },
    ],
    table: {
      columns: [
        { key: 'date', label: '日期' },
        { key: 'userId', label: '用户' },
        { key: 'taskTitle', label: '任务' },
        { key: 'durationSec', label: '时长(秒)' },
        { key: 'microSteps', label: '微步数' },
        { key: 'endReason', label: '结束原因' },
        { key: 'firstMicroSource', label: '第一步来源' },
        { key: 'isQuickFocus', label: '快速专注' },
        { key: 'hadStuck', label: '是否卡顿' },
        { key: 'stuckCount', label: '卡顿次数' },
      ],
      rows,
    },
  }
}

// ===================== 3. 卡顿 Episode =====================

export function buildStuckEpisodes(events: RawEvent[]): { metrics: Metric[]; table: TableData } {
  const triggered = eventsOfType(events, 'stuck.triggered')
  const reasons = eventsOfType(events, 'stuck.reason')
  const pivots = eventsOfType(events, 'stuck.pivot_chosen')

  const reasonBySid = new Map<string, RawEvent[]>()
  for (const e of reasons) {
    const sid = pStr(e, 'sessionId')
    if (!reasonBySid.has(sid)) reasonBySid.set(sid, [])
    reasonBySid.get(sid)!.push(e)
  }
  const pivotBySid = new Map<string, RawEvent[]>()
  for (const e of pivots) {
    const sid = pStr(e, 'sessionId')
    if (!pivotBySid.has(sid)) pivotBySid.set(sid, [])
    pivotBySid.get(sid)!.push(e)
  }

  const rows: Row[] = triggered.map(t => {
    const sid = pStr(t, 'sessionId')
    const rList = reasonBySid.get(sid) ?? []
    const pList = pivotBySid.get(sid) ?? []
    const reason = rList.find(r => r.timestamp >= t.timestamp) ?? rList[0]
    const pivot = pList.find(p => p.timestamp >= t.timestamp) ?? pList[0]
    const raw: RawEvent[] = [t]
    if (reason) raw.push(reason)
    if (pivot) raw.push(pivot)
    return {
      date: (t.date as string) || new Date(t.timestamp).toISOString().slice(0, 10),
      userId: t.user_id as string,
      taskId: pStr(t, 'taskId'),
      microAction: pStr(t, 'microAction'),
      elapsedSec: pNum(t, 'elapsedSeconds'),
      reason: reason ? pStr(reason, 'reason') : '-',
      reasonSource: reason ? pStr(reason, 'reasonSource') : '-',
      pivotSource: pivot ? pStr(pivot, 'pivotSource') : '-',
      chosenPivot: pivot ? pStr(pivot, 'chosenPivot') : '-',
      _rawEvents: raw,
    }
  })

  const n = rows.length
  const withR = rows.filter(r => r.reason !== '-').length
  const withP = rows.filter(r => r.pivotSource !== '-').length
  const ps = rows.filter(r => r.pivotSource !== '-')
  const resume = ps.filter(r => r.pivotSource === 'resume_original').length
  const ai = ps.filter(r => r.pivotSource === 'ai_chip').length
  const self = ps.filter(r => r.pivotSource === 'self').length

  return {
    metrics: [
      { label: '卡顿总数', value: String(n), detail: '', formula: 'stuck.triggered 计数' },
      { label: '有归因比例', value: pct(withR, n), detail: `${withR} / ${n}`, formula: '有 stuck.reason / stuck.triggered 总数' },
      { label: '有恢复路径比例', value: pct(withP, n), detail: `${withP} / ${n}`, formula: '有 stuck.pivot_chosen / stuck.triggered 总数' },
      { label: '恢复路径分布', value: ps.length > 0 ? `继续${pct(resume, ps.length)} AI${pct(ai, ps.length)} 自选${pct(self, ps.length)}` : '-', detail: `继续${resume} AI${ai} 自选${self}`, formula: 'pivot_chosen.pivotSource 各值占比' },
    ],
    table: {
      columns: [
        { key: 'date', label: '日期' },
        { key: 'userId', label: '用户' },
        { key: 'taskId', label: '任务ID' },
        { key: 'microAction', label: '卡在哪步' },
        { key: 'elapsedSec', label: '已耗时(秒)' },
        { key: 'reason', label: '归因' },
        { key: 'reasonSource', label: '归因来源' },
        { key: 'pivotSource', label: '恢复路径' },
        { key: 'chosenPivot', label: '恢复方案' },
      ],
      rows,
    },
  }
}

// ===================== 4. 反思明细 =====================

export function buildReflectionsDetail(
  events: RawEvent[],
  sessions: Array<{ session_key: string; date: string; mode: string; started_at: number; messages: Array<{ role: string; content: string; ts?: number }>; user_id?: string }>
): { metrics: Metric[]; table: TableData } {
  const ended = eventsOfType(events, 'reflect.ended')
  const opened = eventsOfType(events, 'reflect.opened')

  const rows: Row[] = sessions.map(s => ({
    date: s.date,
    userId: (s.user_id ?? '') as string,
    mode: s.mode,
    messageCount: (s.messages ?? []).length,
    userMsgCount: (s.messages ?? []).filter(m => m.role === 'user').length,
    startedAt: s.started_at ? new Date(s.started_at).toLocaleString('zh-CN') : '-',
    sessionKey: s.session_key,
    _messages: s.messages ?? [],
  }))

  const nOpen = opened.length
  const nEnd = ended.length
  const avgDur = nEnd > 0 ? Math.round(ended.reduce((s, e) => s + pNum(e, 'durationMs'), 0) / nEnd / 1000) : 0
  const avgMsg = nEnd > 0 ? Math.round(ended.reduce((s, e) => s + pNum(e, 'messageCount'), 0) / nEnd) : 0

  return {
    metrics: [
      { label: '页面访问数', value: String(nOpen), detail: '', formula: 'reflect.opened 计数' },
      { label: '完整反思数', value: String(nEnd), detail: '', formula: 'reflect.ended 计数' },
      { label: '反思完成率', value: pct(nEnd, nOpen), detail: `${nEnd} / ${nOpen}`, formula: 'reflect.ended / reflect.opened' },
      { label: '平均对话时长', value: `${avgDur} 秒`, detail: `${nEnd} 个已结束`, formula: 'reflect.ended.durationMs 均值/1000' },
      { label: '平均消息轮数', value: String(avgMsg), detail: `${nEnd} 个已结束`, formula: 'reflect.ended.messageCount 均值' },
    ],
    table: {
      columns: [
        { key: 'date', label: '日期' },
        { key: 'userId', label: '用户' },
        { key: 'mode', label: '模式' },
        { key: 'messageCount', label: '总消息数' },
        { key: 'userMsgCount', label: '用户消息数' },
        { key: 'startedAt', label: '开始时间' },
      ],
      rows,
    },
  }
}

// ===================== 5. 每日汇总 =====================

export function buildDailyPerUser(
  events: RawEvent[],
  tasks: Array<{ user_id: string; date: string; completed: boolean }>
): { metrics: Metric[]; table: TableData } {
  const map = new Map<string, { date: string; userId: string; sess: number; focusSec: number; taskNew: number; taskDone: number; stuck: number; refl: boolean }>()

  const k = (uid: string, d: string) => `${uid}__${d}`
  const ensure = (uid: string, d: string) => {
    const key = k(uid, d)
    if (!map.has(key)) map.set(key, { date: d, userId: uid, sess: 0, focusSec: 0, taskNew: 0, taskDone: 0, stuck: 0, refl: false })
    return map.get(key)!
  }

  for (const e of events) {
    const uid = e.user_id as string
    const d = (e.date as string) || new Date(e.timestamp).toISOString().slice(0, 10)
    if (!uid || !d) continue
    const row = ensure(uid, d)
    switch (e.event_type) {
      case 'session.started': row.sess++; break
      case 'session.ended': row.focusSec += pNum(e, 'totalDurationSeconds'); break
      case 'task.created': row.taskNew++; break
      case 'stuck.triggered': row.stuck++; break
      case 'reflect.ended': row.refl = true; break
    }
  }
  for (const t of tasks) {
    if (t.completed) ensure(t.user_id, t.date).taskDone++
  }

  const rows: Row[] = Array.from(map.values())
    .sort((a, b) => a.date.localeCompare(b.date) || a.userId.localeCompare(b.userId))
    .map(d => ({
      date: d.date, userId: d.userId,
      sessions: d.sess, focusMin: fmtMin(d.focusSec),
      taskCreated: d.taskNew, taskCompleted: d.taskDone,
      stuckCount: d.stuck, hadReflect: d.refl ? '是' : '否',
    }))

  const n = rows.length
  const avgF = n > 0 ? Math.round(rows.reduce((s, r) => s + (r.focusMin as number), 0) / n) : 0
  const avgS = n > 0 ? (rows.reduce((s, r) => s + (r.sessions as number), 0) / n).toFixed(1) : '0'

  return {
    metrics: [
      { label: '总记录天数', value: String(n), detail: '用户×天 组合', formula: '去重 (user_id, date) 数' },
      { label: '平均日专注', value: `${avgF} 分钟`, detail: '', formula: '每天专注分钟数均值' },
      { label: '平均日会话数', value: avgS, detail: '', formula: '每天会话数均值' },
    ],
    table: {
      columns: [
        { key: 'date', label: '日期' },
        { key: 'userId', label: '用户' },
        { key: 'sessions', label: '会话数' },
        { key: 'focusMin', label: '专注(分钟)' },
        { key: 'taskCreated', label: '创建任务' },
        { key: 'taskCompleted', label: '完成任务' },
        { key: 'stuckCount', label: '卡顿数' },
        { key: 'hadReflect', label: '是否反思' },
      ],
      rows,
    },
  }
}

// ===================== 6. 事件可读化 =====================

const EVENT_LABELS: Record<string, (p: Record<string, unknown>) => string> = {
  'app.launched': () => '启动应用',
  'app.quit': () => '退出应用',
  'task.created': (p) => `创建任务：${p.title ?? ''}`,
  'task.toggled': (p) => `${p.completed ? '✓ 完成' : '✗ 取消完成'}任务`,
  'task.deleted': () => '删除任务',
  'task.edited': (p) => `编辑任务（${p.field}）`,
  'task.subtask_created': (p) => `添加子任务：${p.subtaskTitle ?? ''}`,
  'task.subtask_toggled': (p) => `${p.completed ? '✓' : '✗'} 子任务：${p.subtaskTitle ?? ''}`,
  'task.subtask_deleted': (p) => `删除子任务：${p.subtaskTitle ?? ''}`,
  'task.carried_over': (p) => `搬迁 ${(p.taskIds as string[])?.length ?? 0} 个任务`,
  'task.reordered': () => '重排任务顺序',
  'task.priority_changed': (p) => `优先级：${p.from} → ${p.to}`,
  'task.cleared_completed': (p) => `清理 ${p.count} 个已完成任务`,
  'plan.brain_dump': (p) => `脑暴：${p.taskCount} 个任务`,
  'plan.focus_selected': (p) => `选择专注：${p.taskTitle ?? ''}`,
  'plan.first_micro': (p) => `第一步：${p.microAction ?? ''}（${p.source === 'ai_chip' ? 'AI建议' : '自选'}）`,
  'plan.task_understanding': (p) => `任务理解：${p.taskTitle ?? ''}`,
  'plan.scaffold_skipped': () => '跳过脚手架',
  'plan.chip_selected': (p) => `选择筹码：${p.chipText ?? ''}`,
  'session.started': (p) => `开始专注：${p.taskTitle ?? ''}${p.isQuickFocus ? '（快速专注）' : ''}`,
  'session.ended': (p) => `结束专注：${p.taskTitle ?? ''}（${p.totalDurationSeconds}s，${p.endReason}）`,
  'session.paused': (p) => `暂停：${p.taskTitle ?? ''}`,
  'session.resumed': (p) => `恢复：${p.taskTitle ?? ''}`,
  'session.macro_completed': (p) => `任务完成：${p.taskTitle ?? ''}（${p.completedVia}）`,
  'exec.micro_started': (p) => `开始微步：${p.microAction ?? ''}`,
  'exec.micro_completed': (p) => `完成微步：${p.microAction ?? ''}（${p.actualSeconds}s）`,
  'exec.subtask_completed': (p) => `完成子任务：${p.subtaskTitle ?? ''}`,
  'exec.flow_entered': (p) => `进入心流（已完成 ${p.completedStepCount} 步）`,
  'exec.flow_ended': (p) => `退出心流（${p.flowDurationSeconds}s，${p.endReason}）`,
  'stuck.triggered': (p) => `卡住了（${p.elapsedSeconds}s）：${p.microAction ?? ''}`,
  'stuck.reason': (p) => `卡顿原因：${p.reason ?? ''}（${p.reasonSource}）`,
  'stuck.reflection_shown': () => 'AI 展示反思提示',
  'stuck.hint_feedback_clicked': (p) => `反馈提示#${p.hintIndex}：${p.feedback}`,
  'stuck.hint_feedback_summary': (p) => `提示反馈汇总：👍${p.upCount} 👎${p.downCount}`,
  'stuck.pivot_offered': (p) => `AI 提供绕路建议：${(p.pivotSuggestions as string[])?.join(' / ') ?? ''}`,
  'stuck.pivot_chosen': (p) => `选择绕路：${p.chosenPivot ?? ''}（${p.pivotSource}）`,
  'abandon.exit': (p) => `放弃退出：${p.taskTitle ?? ''}（${p.phase}，${p.elapsedSeconds}s）`,
  'reflect.opened': (p) => `打开反思页面（${p.mode}）`,
  'reflect.chat_opened': (p) => `打开 AI 反思对话（${p.mode}）`,
  'reflect.message_sent': (p) => `发送反思消息（第 ${(p.messageIndex as number) + 1} 条）`,
  'reflect.ended': (p) => `完成反思对话（${p.messageCount} 条，${Math.round((p.durationMs as number) / 1000)}s）`,
  'reflect.closed': (p) => `关闭反思页面（${Math.round((p.durationMs as number) / 1000)}s${p.hadChat ? '，有对话' : ''}）`,
  'reflect.mode_switched': (p) => `切换视图：${p.from} → ${p.to}`,
  'reflect.chart_referenced': (p) => `AI 引用图表：${p.chartId}`,
  'nav.date_changed': (p) => `切换日期：${p.from} → ${p.to}`,
  'mode.widget_entered': () => '进入小组件模式',
  'mode.widget_expanded': () => '展开小组件',
  'memory.opened': () => '打开记忆面板',
  'memory.deleted': (p) => `删除记忆：${p.type}`,
  'settings.saved': (p) => `保存设置：${p.settingType}`,
  'auth.login': () => '用户登录',
  'daily.leftovers': (p) => `每日剩余：${p.totalCount} 个任务`,
  'manual.time_added': (p) => `手动补记：${p.entryCount} 条`,
}

export function humanizeEvent(e: RawEvent): string {
  const fn = EVENT_LABELS[e.event_type]
  if (fn) {
    try { return fn(e.payload ?? {}) } catch { /* fallback */ }
  }
  return e.event_type
}
