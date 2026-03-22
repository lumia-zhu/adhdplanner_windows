/**
 * 每日行为汇总构建器
 *
 * 从事件日志中聚合出结构化摘要，用于：
 *   1. 晚间反思对话的 LLM Context
 *   2. 统计面板展示
 *
 * 使用：
 *   const events = await loadEventsForDate('2026-02-21')
 *   const summary = buildDailySummary('2026-02-21', events)
 */

import type { TrackEvent, DailySummary } from './types'

/**
 * 周视图数据精简接口（供 buildWeeklyLLMContext 使用）
 * 与 WeekView.tsx 中的 WeekDayData 兼容，但不从组件层导入
 */
export interface WeekDayDataLite {
  date: string
  weekday: string
  dateFull: string
  summary: DailySummary
  totalUsageMinutes: number
  hasData: boolean
  taskDurations: {
    title: string
    durationSec: number
    completed: boolean
    stuckMarks: { reason: string; resolved: boolean }[]
  }[]
}

// ===================== 辅助函数 =====================

/** 根据事件类型筛选 */
function filterByType<T extends TrackEvent['type']>(
  events: TrackEvent[],
  type: T,
): TrackEvent<T>[] {
  return events.filter(e => e.type === type) as TrackEvent<T>[]
}

/** 时间戳转 ISO 字符串 */
function toISO(ts: number): string {
  return new Date(ts).toISOString()
}

// ===================== 核心构建函数 =====================

/**
 * 把一天的事件流聚合为结构化摘要
 */
export function buildDailySummary(date: string, events: TrackEvent[]): DailySummary {
  // -------- 1. 计划阶段 --------
  const brainDumps = filterByType(events, 'plan.brain_dump')
  const focusSelects = filterByType(events, 'plan.focus_selected')
  const firstMicros = filterByType(events, 'plan.first_micro')

  const latestDump = brainDumps[brainDumps.length - 1]
  const latestFocus = focusSelects[focusSelects.length - 1]
  const latestFirstMicro = firstMicros[firstMicros.length - 1]

  const planning = {
    brainDumpTasks: latestDump?.payload.tasks.map(t => t.title) ?? [],
    focusTaskTitle: latestFocus?.payload.taskTitle ?? null,
    firstMicroAction: latestFirstMicro?.payload.microAction ?? null,
    scaffoldSource: latestFirstMicro?.payload.source ?? null,
  }

  // -------- 2. 微步轨迹 --------
  const microCompleted = filterByType(events, 'exec.micro_completed')
  const stuckTriggered = filterByType(events, 'stuck.triggered')
  const abandonExits = filterByType(events, 'abandon.exit')

  // 构建微步轨迹（合并完成、卡住、放弃的记录）
  type MicroEntry = DailySummary['microStepTrail'][number]
  const microStepTrail: MicroEntry[] = []

  for (const e of microCompleted) {
    const p = e.payload
    const delta = (p.estimatedSeconds != null) ? (p.actualSeconds - p.estimatedSeconds) : undefined
    microStepTrail.push({
      microAction: p.microAction,
      actualSeconds: p.actualSeconds,
      estimatedSeconds: p.estimatedSeconds,
      timeDeltaSeconds: delta,
      status: 'completed',
    })
  }

  for (const e of stuckTriggered) {
    microStepTrail.push({
      microAction: e.payload.microAction,
      actualSeconds: e.payload.elapsedSeconds,
      status: 'stuck',
    })
  }

  for (const e of abandonExits) {
    microStepTrail.push({
      microAction: e.payload.microAction,
      actualSeconds: e.payload.elapsedSeconds,
      status: 'abandoned',
    })
  }

  // 按时间排序（用事件时间戳）
  // 暂时用 push 顺序，因为事件本身是按时间产生的

  // -------- 3. 心流事件 --------
  const flowEntered = filterByType(events, 'exec.flow_entered')
  const flowEnded = filterByType(events, 'exec.flow_ended')

  const flowEvents: DailySummary['flowEvents'] = flowEntered.map(enter => {
    // 找对应的 flow_ended
    const end = flowEnded.find(
      e => e.payload.sessionId === enter.payload.sessionId
    )
    return {
      taskTitle: enter.payload.taskTitle,
      triggeredAt: toISO(enter.timestamp),
      durationSeconds: end?.payload.flowDurationSeconds ?? 0,
      lastMicroBeforeFlow: enter.payload.lastMicroAction,
    }
  })

  // -------- 4. 卡顿急救记录 --------
  const stuckReasons = filterByType(events, 'stuck.reason')
  const stuckPivots = filterByType(events, 'stuck.pivot_chosen')

  const stuckEvents: DailySummary['stuckEvents'] = stuckReasons.map(reason => {
    // 找对应的 pivot_chosen
    const pivot = stuckPivots.find(
      p => p.payload.sessionId === reason.payload.sessionId &&
           p.timestamp > reason.timestamp
    )

    // 判断绕路后是否完成：检查 pivot 之后同 session 是否有 micro_completed
    let rescueSucceeded: boolean | null = null
    if (pivot) {
      const afterPivotComplete = microCompleted.find(
        mc => mc.payload.sessionId === pivot.payload.sessionId &&
              mc.timestamp > pivot.timestamp
      )
      rescueSucceeded = !!afterPivotComplete
    }

    return {
      microAction: reason.payload.microAction,
      reason: reason.payload.reason,
      reasonSource: reason.payload.reasonSource,
      pivotChosen: pivot?.payload.chosenPivot ?? '',
      pivotSource: pivot?.payload.pivotSource ?? 'self',
      rescueSucceeded,
    }
  })

  // -------- 4b. 中断与恢复记录 --------
  const sessionPaused = filterByType(events, 'session.paused')
  const sessionResumed = filterByType(events, 'session.resumed')

  const interruptions: DailySummary['interruptions'] = sessionPaused.map(p => {
    const resumed = sessionResumed.find(
      r => r.payload.originalSessionId === p.payload.sessionId &&
           r.timestamp > p.timestamp
    )
    return {
      taskTitle: p.payload.taskTitle,
      microAction: p.payload.microAction,
      pausedAt: toISO(p.timestamp),
      pausedAfterSeconds: p.payload.elapsedSeconds,
      resumedAfterSeconds: resumed
        ? Math.round((resumed.timestamp - p.timestamp) / 1000)
        : null,
    }
  })

  // -------- 4c. AI 即时反思记录 --------
  const reflectionShown = filterByType(events, 'stuck.reflection_shown')
  const reflectionHints: DailySummary['reflectionHints'] = reflectionShown.map(e => ({
    difficulty: e.payload.difficulty,
    reflection: e.payload.reflection,
  }))

  // -------- 5. 中断放弃 --------
  const abandonments: DailySummary['abandonments'] = abandonExits.map(e => ({
    microAction: e.payload.microAction,
    taskTitle: e.payload.taskTitle,
    elapsedSeconds: e.payload.elapsedSeconds,
    time: toISO(e.timestamp),
  }))

  // -------- 6. 宏观任务闭环 --------
  const macroCompletes = filterByType(events, 'session.macro_completed')

  // ★ 修复：只有当 macro_completed 事件的 taskTitle 匹配当前焦点任务时才标记为完成
  // 之前的 Bug：!!latestMacro 会在当天完成过任何任务时返回 true，导致后续进行中的任务被误判为「已完成」
  const focusTitle = latestFocus?.payload.taskTitle ?? null
  const matchedMacro = focusTitle
    ? macroCompletes.find(e => e.payload.taskTitle === focusTitle)
    : null

  const macroTask: DailySummary['macroTask'] = {
    title: focusTitle,
    completed: !!matchedMacro,
    completedVia: matchedMacro?.payload.completedVia ?? null,
  }

  // -------- 7. 遗留任务池 --------
  const leftovers = filterByType(events, 'daily.leftovers')
  const latestLeftovers = leftovers[leftovers.length - 1]
  const leftoverTasks = latestLeftovers?.payload.leftoverTasks.map(t => t.title) ?? []

  // -------- 8. 统计概览 --------
  const completedCount = microCompleted.length
  const totalSteps = microStepTrail.length
  const totalFlowSec = flowEvents.reduce((sum, f) => sum + f.durationSeconds, 0)

  // 总专注时长 = 所有 session 的 totalDuration
  const sessionEnds = filterByType(events, 'session.ended')
  const totalFocusSec = sessionEnds.reduce((sum, s) => sum + s.payload.totalDurationSeconds, 0)

  // 平均时间偏差
  const deltas = microStepTrail
    .filter(m => m.timeDeltaSeconds != null)
    .map(m => m.timeDeltaSeconds ?? 0)
  const avgDelta = deltas.length > 0
    ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
    : null

  const stats: DailySummary['stats'] = {
    totalMicroSteps: totalSteps,
    completedMicroSteps: completedCount,
    totalStuckCount: stuckEvents.length,
    totalFlowMinutes: Math.round(totalFlowSec / 60),
    totalFocusMinutes: Math.round(totalFocusSec / 60),
    averageTimeDeltaSeconds: avgDelta,
  }

  return {
    date,
    planning,
    microStepTrail,
    flowEvents,
    stuckEvents,
    interruptions,
    reflectionHints,
    abandonments,
    macroTask,
    leftoverTasks,
    stats,
  }
}

/**
 * 把 DailySummary 转为自然语言，直接作为 LLM 的 system context
 * 用于晚间反思对话
 */
export function summaryToLLMContext(summary: DailySummary): string {
  const lines: string[] = []

  lines.push(`## ${summary.date} 行为日志摘要\n`)

  // 计划
  lines.push(`### 今日计划`)
  lines.push(`- 脑暴任务池（${summary.planning.brainDumpTasks.length}项）：${summary.planning.brainDumpTasks.join('、') || '无记录'}`)
  lines.push(`- 选中的焦点任务：${summary.planning.focusTaskTitle || '无'}`)
  lines.push(`- 破冰第一步：${summary.planning.firstMicroAction || '无'}（来源：${summary.planning.scaffoldSource === 'ai_chip' ? 'AI建议' : '用户自己输入'}）`)

  // 执行轨迹
  lines.push(`\n### 执行轨迹（共 ${summary.stats.totalMicroSteps} 步，完成 ${summary.stats.completedMicroSteps} 步）`)
  for (const step of summary.microStepTrail) {
    const mins = Math.round(step.actualSeconds / 60)
    const quickTag = step.status === 'completed' && mins < 2 ? '⚡直接勾选' : ''
    const deltaStr = step.timeDeltaSeconds != null
      ? `（偏差：${step.timeDeltaSeconds > 0 ? '+' : ''}${Math.round(step.timeDeltaSeconds / 60)}分钟）`
      : ''
    const statusIcon = step.status === 'completed' ? '✅' : step.status === 'stuck' ? '🆘' : '❌'
    lines.push(`- [${statusIcon}${quickTag ? ' ' + quickTag : ''}] ${step.microAction}（耗时${mins}分钟${deltaStr}）`)
  }

  // 心流
  if (summary.flowEvents.length > 0) {
    lines.push(`\n### 心流时刻`)
    for (const f of summary.flowEvents) {
      lines.push(`- 任务"${f.taskTitle}"：从"${f.lastMicroBeforeFlow}"后进入心流，持续 ${Math.round(f.durationSeconds / 60)} 分钟`)
    }
  }

  // 卡顿
  if (summary.stuckEvents.length > 0) {
    lines.push(`\n### 卡顿与急救`)
    for (const s of summary.stuckEvents) {
      lines.push(`- 卡在"${s.microAction}"：原因「${s.reason}」→ 绕路「${s.pivotChosen}」→ ${s.rescueSucceeded ? '成功恢复 ✅' : s.rescueSucceeded === false ? '未恢复 ❌' : '结果未知'}`)
    }
  }

  // 中断与恢复
  if (summary.interruptions.length > 0) {
    lines.push(`\n### 中断与恢复（共 ${summary.interruptions.length} 次暂停）`)
    for (const i of summary.interruptions) {
      const pausedMins = Math.round(i.pausedAfterSeconds / 60)
      const resumeStr = i.resumedAfterSeconds != null
        ? `暂停了${Math.round(i.resumedAfterSeconds / 60)}分钟后恢复`
        : '未恢复'
      lines.push(`- 做"${i.taskTitle}"的"${i.microAction}"${pausedMins}分钟后暂停 → ${resumeStr}`)
    }
  }

  // AI 即时反思提示
  if (summary.reflectionHints.length > 0) {
    lines.push(`\n### 卡住时 AI 给过的即时反思`)
    for (const r of summary.reflectionHints) {
      lines.push(`- 用户困难：「${r.difficulty}」→ AI提示：「${r.reflection}」`)
    }
  }

  // 放弃
  if (summary.abandonments.length > 0) {
    lines.push(`\n### 中途放弃`)
    for (const a of summary.abandonments) {
      lines.push(`- ${a.time}：做了${Math.round(a.elapsedSeconds / 60)}分钟后放弃了"${a.microAction}"`)
    }
  }

  // 闭环
  lines.push(`\n### 宏观任务`)
  lines.push(`- ${summary.macroTask.title || '无'}：${summary.macroTask.completed ? `已完成（方式：${summary.macroTask.completedVia}）✅` : '未完成 ⚠️'}`)

  // 遗留
  if (summary.leftoverTasks.length > 0) {
    lines.push(`\n### 遗留任务`)
    lines.push(`- ${summary.leftoverTasks.join('、')}`)
  }

  // 统计
  lines.push(`\n### 数据统计`)
  lines.push(`- 总专注 ${summary.stats.totalFocusMinutes} 分钟`)
  lines.push(`- 心流 ${summary.stats.totalFlowMinutes} 分钟`)
  lines.push(`- 卡顿 ${summary.stats.totalStuckCount} 次`)
  lines.push(`- 中断暂停 ${summary.interruptions.length} 次`)
  if (summary.stats.averageTimeDeltaSeconds != null) {
    const avg = summary.stats.averageTimeDeltaSeconds
    lines.push(`- 平均时间感知偏差：${avg > 0 ? '高估' : '低估'} ${Math.abs(Math.round(avg / 60))} 分钟`)
  }

  return lines.join('\n')
}

// ===================== 周视图 LLM 上下文 =====================

/** 格式化秒数为友好时长：<60s→Xs、<60min→X分钟、>=60min→X.Xh */
function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}秒`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}分钟`
  return `${(min / 60).toFixed(1)}小时`
}

/**
 * 把 7 天的周视图数据转为 AI 可理解的 Markdown 文本
 *
 * 内容对齐用户看到的 5 个图表：
 *   1. 每日完成率（WeekCompletionBars）
 *   2. 周汇总指标（WeekMetricCards）
 *   3. 任务用时排行（WeekTaskRanking）
 *   4. 活动分布概览（WeekHeatmapGrid）
 *   5. 使用节奏趋势（WeekRhythmChart）
 */
export function buildWeeklyLLMContext(days: WeekDayDataLite[]): string {
  const lines: string[] = []
  const daysWithData = days.filter(d => d.hasData)
  const n = Math.max(daysWithData.length, 1)

  const firstDate = days[0]?.dateFull ?? ''
  const lastDate = days[days.length - 1]?.dateFull ?? ''
  lines.push(`## 周数据摘要（${firstDate} – ${lastDate}）\n`)

  // ---- 1. 每日完成率 ----
  lines.push(`### 每日完成率`)
  for (const day of days) {
    if (!day.hasData) {
      lines.push(`- ${day.dateFull}：无数据`)
      continue
    }
    const { totalMicroSteps, completedMicroSteps } = day.summary.stats
    const rate = totalMicroSteps > 0
      ? Math.round((completedMicroSteps / totalMicroSteps) * 100)
      : 0
    lines.push(`- ${day.dateFull}：${rate}%（${completedMicroSteps}/${totalMicroSteps} 步）`)
  }

  // ---- 2. 周汇总指标 ----
  const totalCompleted = daysWithData.reduce((s, d) => s + d.summary.stats.completedMicroSteps, 0)
  const totalUsage = daysWithData.reduce((s, d) => s + d.totalUsageMinutes, 0)
  const totalFocus = daysWithData.reduce((s, d) => s + d.summary.stats.totalFocusMinutes, 0)
  const totalFlow = daysWithData.reduce((s, d) => s + d.summary.stats.totalFlowMinutes, 0)
  const totalStuck = daysWithData.reduce((s, d) => s + d.summary.stats.totalStuckCount, 0)

  lines.push(`\n### 周汇总指标（${daysWithData.length} 天有数据）`)
  lines.push(`- 总完成任务数：${totalCompleted}（日均 ${(totalCompleted / n).toFixed(1)}）`)
  lines.push(`- 总电脑使用时长：${formatDuration(totalUsage * 60)}（日均 ${formatDuration(Math.round(totalUsage / n) * 60)}）`)
  lines.push(`- 总任务专注时长：${formatDuration(totalFocus * 60)}（日均 ${formatDuration(Math.round(totalFocus / n) * 60)}）`)
  lines.push(`- 总心流时长：${totalFlow} 分钟`)
  lines.push(`- 总卡顿次数：${totalStuck} 次`)
  if (totalUsage > 0) {
    lines.push(`- 周生产力比率：${Math.min(Math.round((totalFocus / totalUsage) * 100), 100)}%（专注/使用）`)
  }

  // ---- 3. 任务用时排行 Top 10 ----
  const allTasks = daysWithData.flatMap(d => d.taskDurations)
  const taskAgg = new Map<string, { sec: number; completed: boolean; stuckCount: number; days: string[] }>()
  for (const t of allTasks) {
    const existing = taskAgg.get(t.title)
    if (existing) {
      existing.sec += t.durationSec
      if (t.completed) existing.completed = true
      existing.stuckCount += t.stuckMarks.length
    } else {
      taskAgg.set(t.title, {
        sec: t.durationSec,
        completed: t.completed,
        stuckCount: t.stuckMarks.length,
        days: [],
      })
    }
  }
  // 记录每个任务出现在哪些天
  for (const d of daysWithData) {
    for (const t of d.taskDurations) {
      const agg = taskAgg.get(t.title)
      if (agg && !agg.days.includes(d.weekday)) {
        agg.days.push(d.weekday)
      }
    }
  }

  const ranked = Array.from(taskAgg.entries())
    .sort((a, b) => b[1].sec - a[1].sec)
    .slice(0, 10)

  if (ranked.length > 0) {
    lines.push(`\n### 周任务用时排行 Top ${ranked.length}`)
    for (let i = 0; i < ranked.length; i++) {
      const [title, info] = ranked[i]
      const status = info.completed ? '✅' : '⏳'
      const stuckStr = info.stuckCount > 0 ? `，卡顿${info.stuckCount}次` : ''
      lines.push(`${i + 1}. ${status} ${title}：${formatDuration(info.sec)}（出现在${info.days.join('、')}${stuckStr}）`)
    }
  }

  // ---- 4. 逐日行为概要 ----
  lines.push(`\n### 逐日行为概要`)
  for (const day of days) {
    if (!day.hasData) {
      lines.push(`\n**${day.dateFull}**：无数据`)
      continue
    }
    const s = day.summary.stats
    lines.push(`\n**${day.dateFull}**`)
    lines.push(`- 使用 ${day.totalUsageMinutes} 分钟，专注 ${s.totalFocusMinutes} 分钟，心流 ${s.totalFlowMinutes} 分钟`)
    lines.push(`- 完成 ${s.completedMicroSteps}/${s.totalMicroSteps} 步，卡顿 ${s.totalStuckCount} 次`)

    // 卡顿详情
    if (day.summary.stuckEvents.length > 0) {
      for (const stuck of day.summary.stuckEvents) {
        lines.push(`  - 卡在「${stuck.microAction}」：原因「${stuck.reason}」→ 绕路「${stuck.pivotChosen}」→ ${stuck.rescueSucceeded ? '解决 ✅' : stuck.rescueSucceeded === false ? '未解决 ❌' : '未知'}`)
      }
    }

    // 中断
    if (day.summary.interruptions.length > 0) {
      lines.push(`- 暂停 ${day.summary.interruptions.length} 次`)
    }

    // 心流
    if (day.summary.flowEvents.length > 0) {
      for (const f of day.summary.flowEvents) {
        lines.push(`  - 心流：${f.taskTitle}，${Math.round(f.durationSeconds / 60)} 分钟`)
      }
    }
  }

  return lines.join('\n')
}
