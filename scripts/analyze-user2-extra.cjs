// 第二位用户的额外维度分析
const fs = require('fs')
const path = require('path')
const DOWNLOADS = 'C:\\Users\\Lumia\\Downloads'

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const rows = []
  let i = 0, n = content.length
  let cur = [], field = '', inQuotes = false
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
function parsePayload(p) { try { return JSON.parse(p) } catch { return {} } }

const events = parseCSV(path.join(DOWNLOADS, 'events_all (1).csv'))
const tasks = parseCSV(path.join(DOWNLOADS, 'tasks (1).csv'))

const seen = new Set()
const E = []
for (const e of events) {
  const key = `${e.time}|${e.event_type}|${e.payload}`
  if (seen.has(key)) continue
  seen.add(key)
  E.push({ ...e, p: parsePayload(e.payload) })
}

const out = []

// 1. 事件类型分布
const typeCount = {}
for (const e of E) typeCount[e.event_type] = (typeCount[e.event_type] ?? 0) + 1
out.push('=== 事件类型分布 ===')
for (const [k, v] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
  out.push(`  ${k.padEnd(35)} ${v}`)
}

// 2. 按日期分布
out.push('\n=== 按日期分布 ===')
const byDate = {}
for (const e of E) {
  if (!byDate[e.date]) byDate[e.date] = []
  byDate[e.date].push(e)
}
for (const date of Object.keys(byDate).sort()) {
  const evts = byDate[date]
  const sessions = evts.filter(e => e.event_type === 'session.started').length
  const stuck = evts.filter(e => e.event_type === 'stuck.triggered').length
  const microStarted = evts.filter(e => e.event_type === 'exec.micro_started').length
  const microCompleted = evts.filter(e => e.event_type === 'exec.micro_completed').length
  const reflOpen = evts.filter(e => e.event_type === 'reflect.opened').length
  out.push(`  ${date}: 共${evts.length}条 | session=${sessions} stuck=${stuck} micro开始=${microStarted}/完成=${microCompleted} reflect_opened=${reflOpen}`)
}

// 3. 卡顿求助事件详情
out.push('\n=== 卡顿求助 stuck 详情 ===')
const stuckEvents = E.filter(e => e.event_type.startsWith('stuck'))
for (const e of stuckEvents) {
  out.push(`  [${e.time}] ${e.event_type} | ${JSON.stringify(e.p).slice(0, 600)}`)
}

// 4. session 时长汇总
out.push('\n=== Session 详情 ===')
const sessionMap = new Map()
for (const e of E) {
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
  out.push(`  [${startE.date} ${startE.time.split(' ')[1]}] ${info.task} | 暂停${pauses.length}次/恢复${resumes.length}次/结束${ends.length}次 | 最长ela=${(totalElapsed/60).toFixed(0)}分`)
}

// 5. 任务完成情况
out.push('\n=== 任务完成情况（按日） ===')
const taskByDate = {}
for (const t of tasks) {
  if (!taskByDate[t.date]) taskByDate[t.date] = { total: 0, done: 0, carried: 0, titles: [] }
  taskByDate[t.date].total++
  if (t.completed === '是') taskByDate[t.date].done++
  if (t.carried_from) taskByDate[t.date].carried++
  taskByDate[t.date].titles.push(`${t.completed === '是' ? '✓' : '○'}${t.title}${t.carried_from ? '(c)' : ''}`)
}
for (const d of Object.keys(taskByDate).sort()) {
  const dd = taskByDate[d]
  out.push(`  ${d}: ${dd.done}/${dd.total} (carry=${dd.carried}) | ${dd.titles.join(' / ')}`)
}

// 6. 反复 carry 的任务
out.push('\n=== 反复 carry_over 的任务（>= 3 天） ===')
const carryByTitle = {}
for (const t of tasks) {
  if (t.carried_from) {
    if (!carryByTitle[t.title]) carryByTitle[t.title] = []
    carryByTitle[t.title].push(t.date)
  }
}
for (const [title, dates] of Object.entries(carryByTitle)) {
  if (dates.length >= 3) out.push(`  "${title}": ${dates.length} 天 carry → ${dates.join(', ')}`)
}

// 7. micro_completed 实际耗时
out.push('\n=== 微动作实际耗时分布 ===')
const microSecs = E.filter(e => e.event_type === 'exec.micro_completed').map(e => e.p.actualSeconds).filter(s => typeof s === 'number')
microSecs.sort((a, b) => a - b)
if (microSecs.length) {
  out.push(`  共${microSecs.length}个微动作`)
  out.push(`  中位数=${microSecs[Math.floor(microSecs.length/2)]}秒`)
  out.push(`  最长=${microSecs[microSecs.length-1]}秒  最短=${microSecs[0]}秒`)
  out.push(`  <=5秒的: ${microSecs.filter(s => s <= 5).length} (${(microSecs.filter(s => s <= 5).length / microSecs.length * 100).toFixed(0)}%)`)
  out.push(`  <=30秒的: ${microSecs.filter(s => s <= 30).length} (${(microSecs.filter(s => s <= 30).length / microSecs.length * 100).toFixed(0)}%)`)
}

// 8. session 长度分布（焦点 session 持续时间）
out.push('\n=== session 持续时间分布 ===')
const sessionDurations = []
for (const [sid, info] of sessionMap) {
  if (!info.events.find(e => e.event_type === 'session.started')) continue
  let maxElapsed = 0
  for (const e of info.events) {
    if (e.p.elapsedSeconds && e.p.elapsedSeconds > maxElapsed) maxElapsed = e.p.elapsedSeconds
  }
  sessionDurations.push({ task: info.task, dur: maxElapsed })
}
sessionDurations.sort((a, b) => b.dur - a.dur)
out.push(`  共 ${sessionDurations.length} 个 session`)
out.push(`  >=2小时的: ${sessionDurations.filter(s => s.dur >= 7200).length}`)
out.push(`  超长(>=10小时): `)
for (const s of sessionDurations.filter(s => s.dur >= 36000)) {
  out.push(`    "${s.task}" - ${(s.dur/3600).toFixed(1)}小时`)
}

// 9. 长时间暂停后再恢复
out.push('\n=== 长时间暂停（>10分钟）的恢复 ===')
const longPauseRecover = E.filter(e => e.event_type === 'session.resumed' && (e.p.pausedDurationSeconds ?? 0) > 600)
for (const e of longPauseRecover) {
  out.push(`  [${e.time}] ${e.p.taskTitle} 暂停${(e.p.pausedDurationSeconds/60).toFixed(0)}分钟后恢复`)
}

// 10. 凌晨/深夜活动模式
out.push('\n=== 活动时间段分布（按小时） ===')
const hourCount = {}
for (const e of E) {
  const m = e.time.match(/(\d{1,2}):/)
  if (m) {
    const h = parseInt(m[1], 10)
    hourCount[h] = (hourCount[h] ?? 0) + 1
  }
}
for (let h = 0; h < 24; h++) {
  if (hourCount[h]) out.push(`  ${String(h).padStart(2, '0')}时: ${hourCount[h]}条 ${'▇'.repeat(Math.min(50, Math.floor(hourCount[h] / 5)))}`)
}

// 11. 第一步来源
out.push('\n=== 第一步来源分布 ===')
const fmSrc = {}
for (const e of E.filter(e => e.event_type === 'plan.first_micro')) {
  fmSrc[e.p.source] = (fmSrc[e.p.source] ?? 0) + 1
}
out.push(`  ${JSON.stringify(fmSrc)}`)

fs.writeFileSync('scripts\\user2-extra.txt', out.join('\n'), 'utf8')
console.log('完成,', out.length, '行')
