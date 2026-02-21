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

  // -------- 5. 中断放弃 --------
  const abandonments: DailySummary['abandonments'] = abandonExits.map(e => ({
    microAction: e.payload.microAction,
    taskTitle: e.payload.taskTitle,
    elapsedSeconds: e.payload.elapsedSeconds,
    time: toISO(e.timestamp),
  }))

  // -------- 6. 宏观任务闭环 --------
  const macroCompletes = filterByType(events, 'session.macro_completed')
  const latestMacro = macroCompletes[macroCompletes.length - 1]

  const macroTask: DailySummary['macroTask'] = {
    title: latestFocus?.payload.taskTitle ?? null,
    completed: !!latestMacro,
    completedVia: latestMacro?.payload.completedVia ?? null,
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
    .map(m => m.timeDeltaSeconds!)
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
    const deltaStr = step.timeDeltaSeconds != null
      ? `（偏差：${step.timeDeltaSeconds > 0 ? '+' : ''}${Math.round(step.timeDeltaSeconds / 60)}分钟）`
      : ''
    lines.push(`- [${step.status === 'completed' ? '✅' : step.status === 'stuck' ? '🆘' : '❌'}] ${step.microAction}（耗时${mins}分钟${deltaStr}）`)
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
  if (summary.stats.averageTimeDeltaSeconds != null) {
    const avg = summary.stats.averageTimeDeltaSeconds
    lines.push(`- 平均时间感知偏差：${avg > 0 ? '高估' : '低估'} ${Math.abs(Math.round(avg / 60))} 分钟`)
  }

  return lines.join('\n')
}
