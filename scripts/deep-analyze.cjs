// 深挖：启动第一步 + 数据反思
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

const SUFFIX = process.argv[2] ?? '' // e.g. ' (1)'
const events = parseCSV(path.join(DOWNLOADS, `events_all${SUFFIX}.csv`))
const tasks = parseCSV(path.join(DOWNLOADS, `tasks${SUFFIX}.csv`))
const chats = parseCSV(path.join(DOWNLOADS, `chats${SUFFIX}.csv`))

// 去重
const seen = new Set()
const E = []
for (const e of events) {
  const key = `${e.time}|${e.event_type}|${e.payload}`
  if (seen.has(key)) continue
  seen.add(key)
  E.push({ ...e, p: parsePayload(e.payload) })
}

function tsOf(timeStr) {
  return new Date(timeStr.replace(/-/g, '/')).getTime()
}

// === A. 第一步详细配对：first_micro -> micro_completed -> session 后续 ===
const firstMicros = E.filter(e => e.event_type === 'plan.first_micro')
const microCompleted = E.filter(e => e.event_type === 'exec.micro_completed')
const microStarted = E.filter(e => e.event_type === 'exec.micro_started')

const out = []
out.push('=== A. 启动第一步：每一次的完整轨迹 ===\n')
out.push('日期 | 任务 | 来源 | 第一步内容 | 确认耗时(秒) | 含义')
out.push('-'.repeat(120))

for (const fm of firstMicros) {
  const sid = fm.p.sessionId
  const sameSidStart = microStarted.find(m => m.p.sessionId === sid && m.p.microAction === fm.p.microAction)
  const completed = microCompleted.find(m => m.p.sessionId === sid && m.p.microAction === fm.p.microAction)
  const sec = completed?.p?.actualSeconds ?? '未完成'
  let semantic = ''
  if (typeof sec === 'number') {
    if (sec <= 5) semantic = '🚀几乎瞬间确认（先做了再点/AI给的就是已知动作）'
    else if (sec <= 30) semantic = '✓快速完成'
    else if (sec <= 120) semantic = '○ 真的花了点时间执行'
    else semantic = '⏳花费较长（可能是误会"完成第一步"的边界）'
  }
  out.push(`${fm.date} ${fm.time.split(' ')[1] ?? fm.time} | ${fm.p.taskTitle} | ${fm.p.source} | "${fm.p.microAction}" | ${sec}s | ${semantic}`)
}

// === B. self vs ai_chip 的对比 ===
out.push('\n=== B. 对比"自己写"vs"AI建议" ===')
const self = firstMicros.filter(f => f.p.source === 'self')
const ai = firstMicros.filter(f => f.p.source === 'ai_chip')

out.push(`\n【自己写】${self.length} 次 — 第一步内容：`)
self.forEach(f => out.push(`  ${f.date} ${f.p.taskTitle}: "${f.p.microAction}"`))
out.push(`\n【AI建议】${ai.length} 次 — 第一步内容：`)
ai.forEach(f => out.push(`  ${f.date} ${f.p.taskTitle}: "${f.p.microAction}"`))

// 自己写时的耗时 vs AI 建议的耗时
function avgSec(group) {
  const secs = []
  for (const fm of group) {
    const c = microCompleted.find(m => m.p.sessionId === fm.p.sessionId)
    if (c) secs.push(c.p.actualSeconds ?? 0)
  }
  if (!secs.length) return null
  secs.sort((a, b) => a - b)
  return {
    n: secs.length,
    median: secs[Math.floor(secs.length / 2)],
    avg: Math.round(secs.reduce((a, b) => a + b, 0) / secs.length),
    min: secs[0], max: secs[secs.length - 1],
    under5: secs.filter(s => s <= 5).length,
  }
}
out.push(`\n自己写第一步的耗时分布: ${JSON.stringify(avgSec(self))}`)
out.push(`AI建议第一步的耗时分布: ${JSON.stringify(avgSec(ai))}`)

// === C. 第一步 → 后续 session 持续时间（看第一步是否真的"启动了" ）===
out.push('\n=== C. 第一步之后是否真的"动起来了" ===')
for (const fm of firstMicros) {
  const sid = fm.p.sessionId
  const ses = E.filter(e => e.p.sessionId === sid).sort((a, b) => tsOf(a.time) - tsOf(b.time))
  const startE = ses.find(e => e.event_type === 'session.started')
  const lastE = [...ses].reverse().find(e => e.event_type === 'session.paused' || e.event_type === 'session.ended')
  if (!startE || !lastE) continue
  const dur = lastE.p.elapsedSeconds ?? 0
  let label
  if (dur < 60) label = '⚠️ 不到1分钟就停（典型"打卡式"完成第一步）'
  else if (dur < 600) label = '○ 持续了 < 10分钟'
  else if (dur < 1800) label = '✓ 持续 10-30分钟'
  else label = '🎯 持续 >30分钟'
  out.push(`  ${fm.date} ${fm.p.taskTitle} (${fm.p.source}, "${fm.p.microAction}") → 持续 ${(dur/60).toFixed(0)}分钟 | ${label}`)
}

// === D. micro_completed 后的下一个动作 ===
out.push('\n=== D. 第一步确认完之后，紧接的下一个动作 ===')
for (const fm of firstMicros) {
  const sid = fm.p.sessionId
  const c = microCompleted.find(m => m.p.sessionId === sid && m.p.microAction === fm.p.microAction)
  if (!c) continue
  const cTs = tsOf(c.time)
  const next = E.filter(e => tsOf(e.time) > cTs).sort((a, b) => tsOf(a.time) - tsOf(b.time))[0]
  if (!next) continue
  const gap = ((tsOf(next.time) - cTs) / 1000).toFixed(0)
  out.push(`  ${fm.date} ${fm.p.taskTitle} → 完成第一步 → 隔${gap}秒后是 [${next.event_type}]`)
}

// === E. 反思每次的完整对话 ===
out.push('\n=== E. 反思对话：每次完整内容 ===')
const sessionsBySK = {}
for (const c of chats) {
  if (!sessionsBySK[c.session_key]) sessionsBySK[c.session_key] = []
  sessionsBySK[c.session_key].push(c)
}
for (const sk of Object.keys(sessionsBySK).sort()) {
  const msgs = sessionsBySK[sk].sort((a, b) => Number(a.msg_index) - Number(b.msg_index))
  out.push(`\n--- ${sk} (${msgs[0].mode}) ---`)
  for (const m of msgs) {
    const charts = (m.content.match(/【chart:[^】]+】/g) || []).join('')
    const txt = m.content.replace(/【chart:[^】]+】/g, '[图]').replace(/\n/g, ' ').slice(0, 500)
    out.push(`  [${m.role}] ${txt}`)
  }
}

// === F. 反思打开 vs 是否真的回复 ===
out.push('\n=== F. 反思参与深度（按日） ===')
const reflectOpened = E.filter(e => e.event_type === 'reflect.opened' || e.event_type === 'reflect.chat_opened')
const reflectByDate = {}
for (const e of reflectOpened) {
  if (!reflectByDate[e.date]) reflectByDate[e.date] = 0
  reflectByDate[e.date]++
}
const messageByDate = {}
for (const c of chats) {
  if (c.role !== 'user') continue
  if (!messageByDate[c.date]) messageByDate[c.date] = 0
  messageByDate[c.date]++
}
for (const date of Object.keys(reflectByDate).sort()) {
  out.push(`  ${date}: 打开${reflectByDate[date]}次, 主动消息${messageByDate[date] ?? 0}条`)
}

// === G. 用户主动消息分类 ===
out.push('\n=== G. 用户在反思里都问了什么（主动消息） ===')
const userMsgs = chats.filter(c => c.role === 'user')
for (const m of userMsgs) {
  out.push(`  ${m.date} [${m.mode}] "${m.content}"`)
}

// === H. AI 反思引用了哪些图表 ===
out.push('\n=== H. AI 引用图表分布 ===')
const chartCount = {}
for (const c of chats) {
  if (c.role !== 'assistant') continue
  const matches = c.content.match(/chart:[a-z\-]+/g) || []
  for (const m of matches) chartCount[m] = (chartCount[m] ?? 0) + 1
}
out.push(JSON.stringify(chartCount, null, 2))

// === I. 反思的 mode 切换 ===
out.push('\n=== I. mode 切换/状态 ===')
const modeSwitch = E.filter(e => e.event_type === 'reflect.mode_switched')
for (const e of modeSwitch) out.push(`  ${e.time}: ${JSON.stringify(e.p)}`)

// === J. reflect.ended（看是否聊完整段） ===
out.push('\n=== J. 反思结束情况 reflect.ended ===')
const reflectEnded = E.filter(e => e.event_type === 'reflect.ended')
for (const e of reflectEnded) out.push(`  ${e.time}: ${JSON.stringify(e.p)}`)

const outFile = SUFFIX ? `scripts\\deep-analysis-user2.txt` : `scripts\\deep-analysis.txt`
fs.writeFileSync(outFile, out.join('\n'), 'utf8')
console.log('完成,', out.length, '行')
