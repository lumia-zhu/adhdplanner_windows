// 分析 studentpretest01 的行为数据
const fs = require('fs')
const path = require('path')

const DOWNLOADS = 'C:\\Users\\Lumia\\Downloads'

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const rows = []
  let i = 0
  const n = content.length
  let cur = []
  let field = ''
  let inQuotes = false
  while (i < n) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"' && content[i + 1] === '"') { field += '"'; i += 2; continue }
      if (c === '"') { inQuotes = false; i++; continue }
      field += c; i++; continue
    } else {
      if (c === '"') { inQuotes = true; i++; continue }
      if (c === ',') { cur.push(field); field = ''; i++; continue }
      if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue }
      if (c === '\r') { i++; continue }
      field += c; i++
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  const header = rows.shift()
  return rows.filter(r => r.length === header.length).map(r => {
    const o = {}
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j]
    return o
  })
}

function parsePayload(p) {
  try { return JSON.parse(p) } catch { return {} }
}

const events = parseCSV(path.join(DOWNLOADS, 'events_all.csv'))
const tasks = parseCSV(path.join(DOWNLOADS, 'tasks.csv'))
const chats = parseCSV(path.join(DOWNLOADS, 'chats.csv'))

console.log('原始事件数:', events.length)

// 去重：同一时间戳 + 类型 + payload 视为重复（实际看到很多3倍重复）
const seen = new Set()
const dedupEvents = []
for (const e of events) {
  const key = `${e.time}|${e.event_type}|${e.payload}`
  if (seen.has(key)) continue
  seen.add(key)
  dedupEvents.push({ ...e, p: parsePayload(e.payload) })
}
console.log('去重后事件数:', dedupEvents.length)

// 1. 事件类型分布
const typeCount = {}
for (const e of dedupEvents) typeCount[e.event_type] = (typeCount[e.event_type] ?? 0) + 1
console.log('\n===== 事件类型分布 =====')
for (const [k, v] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(35)} ${v}`)
}

// 2. 按天概况
const byDate = {}
for (const e of dedupEvents) {
  if (!byDate[e.date]) byDate[e.date] = []
  byDate[e.date].push(e)
}
console.log('\n===== 按日期分布 =====')
for (const date of Object.keys(byDate).sort()) {
  const evts = byDate[date]
  const sessions = evts.filter(e => e.event_type === 'session.started').length
  const stuck = evts.filter(e => e.event_type.startsWith('stuck')).length
  const microStarted = evts.filter(e => e.event_type === 'exec.micro_started').length
  const microCompleted = evts.filter(e => e.event_type === 'exec.micro_completed').length
  const reflStart = evts.filter(e => e.event_type === 'reflection.started' || e.event_type === 'reflection.session_started').length
  console.log(`  ${date}: 共${evts.length}条 | session=${sessions} stuck=${stuck} micro开始=${microStarted}/完成=${microCompleted} 反思=${reflStart}`)
}

// 3. 关键事件：first_micro（启动第一步）
console.log('\n===== 启动第一步 plan.first_micro =====')
const firstMicros = dedupEvents.filter(e => e.event_type === 'plan.first_micro')
for (const e of firstMicros) {
  console.log(`  [${e.time}] ${e.p.taskTitle} | source=${e.p.source} | "${e.p.microAction}"`)
}

// 4. 关键事件：stuck.* 卡顿求助
console.log('\n===== 卡顿求助事件 stuck.* =====')
const stuckEvents = dedupEvents.filter(e => e.event_type.startsWith('stuck'))
for (const e of stuckEvents) {
  console.log(`  [${e.time}] ${e.event_type} | ${JSON.stringify(e.p).slice(0, 400)}`)
}

// 5. 反思相关
console.log('\n===== 反思事件 reflection.* =====')
const reflEvents = dedupEvents.filter(e => e.event_type.startsWith('reflection'))
for (const e of reflEvents) {
  console.log(`  [${e.time}] ${e.event_type} | ${JSON.stringify(e.p).slice(0, 300)}`)
}

// 6. session 时长分析
console.log('\n===== 任务专注 session 详情 =====')
const sessionMap = new Map() // sessionId -> {start, ends, pauses}
for (const e of dedupEvents) {
  const sid = e.p.sessionId
  if (!sid) continue
  if (!sessionMap.has(sid)) sessionMap.set(sid, { events: [], task: e.p.taskTitle })
  sessionMap.get(sid).events.push(e)
}
for (const [sid, info] of sessionMap) {
  const startE = info.events.find(e => e.event_type === 'session.started')
  if (!startE) continue
  const pauses = info.events.filter(e => e.event_type === 'session.paused')
  const resumes = info.events.filter(e => e.event_type === 'session.resumed')
  const ends = info.events.filter(e => e.event_type === 'session.ended')
  let totalElapsed = 0
  if (pauses.length) totalElapsed = Math.max(...pauses.map(p => p.p.elapsedSeconds ?? 0))
  if (ends.length) totalElapsed = Math.max(totalElapsed, ends[0].p.elapsedSeconds ?? 0)
  console.log(`  [${startE.date}] ${info.task} | 暂停${pauses.length}次 / 恢复${resumes.length}次 / 总时${(totalElapsed/60).toFixed(0)}分`)
}

// 7. 任务暂停后再恢复时间间隔（用于看是否有"长期搁置后再启动"的痕迹）
console.log('\n===== 长时间暂停（>10分钟）的恢复 =====')
const longPauseRecover = []
for (const e of dedupEvents) {
  if (e.event_type === 'session.resumed' && (e.p.pausedDurationSeconds ?? 0) > 600) {
    longPauseRecover.push(e)
  }
}
for (const e of longPauseRecover) {
  console.log(`  [${e.time}] ${e.p.taskTitle} 暂停${(e.p.pausedDurationSeconds/60).toFixed(0)}分钟后恢复`)
}

// 8. 任务删除/编辑次数 → 反复改任务
console.log('\n===== 任务编辑/删除/创建汇总 =====')
const taskOps = ['task.created', 'task.deleted', 'task.edited', 'task.subtask_created', 'task.subtask_deleted', 'task.subtask_toggled', 'task.carried_over']
for (const op of taskOps) {
  console.log(`  ${op}: ${dedupEvents.filter(e => e.event_type === op).length}`)
}

// 9. 任务列表
console.log('\n===== 任务列表 =====')
const byD = {}
for (const t of tasks) {
  if (!byD[t.date]) byD[t.date] = []
  byD[t.date].push(t)
}
for (const d of Object.keys(byD).sort()) {
  const ts = byD[d]
  const done = ts.filter(t => t.completed === '是').length
  console.log(`  ${d}: ${done}/${ts.length} | ${ts.map(t => `${t.completed === '是' ? '✓' : '○'}${t.title}`).join(', ')}`)
}

// 10. 反思会话信息 + 用户回复
console.log('\n===== 反思对话（仅用户消息） =====')
const userMsgs = chats.filter(c => c.role === 'user')
for (const c of userMsgs) {
  console.log(`  [${c.date}] [${c.mode}] "${c.content.slice(0, 200)}"`)
}

// 11. mode.widget 进入次数（小组件常驻使用率）
console.log('\n===== Widget 进入/扩展次数 =====')
console.log('  widget_entered:', dedupEvents.filter(e => e.event_type === 'mode.widget_entered').length)
console.log('  widget_expanded:', dedupEvents.filter(e => e.event_type === 'mode.widget_expanded').length)

// 12. plan.first_micro 的来源分布（self / ai_chip / skip）
console.log('\n===== "第一步"来源分布 =====')
const sourceCount = {}
for (const e of firstMicros) sourceCount[e.p.source] = (sourceCount[e.p.source] ?? 0) + 1
console.log(' ', sourceCount)

// 13. exec.micro_completed 实际耗时
console.log('\n===== 微动作实际耗时分布 =====')
const microSecs = dedupEvents.filter(e => e.event_type === 'exec.micro_completed').map(e => e.p.actualSeconds)
microSecs.sort((a, b) => a - b)
if (microSecs.length) {
  console.log(`  共${microSecs.length}个微动作 | 中位数=${microSecs[Math.floor(microSecs.length/2)]}秒 | 最长=${microSecs[microSecs.length-1]}秒 | 最短=${microSecs[0]}秒`)
}
