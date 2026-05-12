// 查询 studentpretest01 的行为数据
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = 'https://xpqumculcviwzdybdjoc.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_sW6LstpCjs53wLzo3F25YQ_cTo3LC52'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function main() {
  const targetEmail = 'studentpretest01@app.local'

  // 1. 找到 user_id
  const { data: emailRows, error: emailErr } = await supabase
    .from('user_emails')
    .select('user_id, email')
    .eq('email', targetEmail)

  if (emailErr) {
    console.error('查询 user_emails 失败:', emailErr)
    return
  }
  if (!emailRows || emailRows.length === 0) {
    console.log('找不到该用户。先列出所有可能的用户:')
    const { data: all } = await supabase.from('user_emails').select('user_id, email')
    console.log(all)
    return
  }

  const userId = emailRows[0].user_id
  console.log('找到用户 user_id =', userId)

  // 2. 拉取 profile
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('user_id', userId).maybeSingle()
  console.log('\n===== Profile =====')
  console.log(profile)

  // 3. 拉取所有 tasks
  const { data: tasks } = await supabase
    .from('tasks').select('*').eq('user_id', userId)
    .order('date', { ascending: true })
  console.log('\n===== Tasks 总数:', tasks?.length, '=====')

  // 按日期统计
  const byDate = {}
  for (const t of tasks ?? []) {
    if (!byDate[t.date]) byDate[t.date] = { total: 0, done: 0, titles: [] }
    byDate[t.date].total++
    if (t.completed) byDate[t.date].done++
    byDate[t.date].titles.push(`${t.completed ? '✓' : '○'} ${t.title} [${t.priority}]${t.focus_duration ? ' ['+(t.focus_duration/60).toFixed(0)+'min]' : ''}`)
  }
  for (const date of Object.keys(byDate).sort()) {
    const d = byDate[date]
    console.log(`\n${date}: ${d.done}/${d.total} 完成`)
    for (const line of d.titles) console.log('  ', line)
  }

  // 4. 拉取 tracker_events
  const allEvents = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('tracker_events').select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: true })
      .range(from, from + 999)
    if (error || !data) break
    allEvents.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  console.log('\n===== Tracker Events 总数:', allEvents.length, '=====')

  // 按事件类型统计
  const eventCount = {}
  const eventByDate = {}
  for (const e of allEvents) {
    eventCount[e.event_type] = (eventCount[e.event_type] ?? 0) + 1
    if (!eventByDate[e.date]) eventByDate[e.date] = {}
    eventByDate[e.date][e.event_type] = (eventByDate[e.date][e.event_type] ?? 0) + 1
  }
  console.log('\n按事件类型:')
  for (const [k, v] of Object.entries(eventCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }
  console.log('\n按日期分布:')
  for (const date of Object.keys(eventByDate).sort()) {
    console.log(`  ${date}:`, eventByDate[date])
  }

  // 5. 拉取 reflection_sessions
  const { data: sessions } = await supabase
    .from('reflection_sessions').select('*').eq('user_id', userId)
    .order('started_at', { ascending: true })
  console.log('\n===== Reflection Sessions 总数:', sessions?.length, '=====')
  for (const s of sessions ?? []) {
    const msgs = s.messages ?? []
    console.log(`  [${s.date}] ${s.session_key} mode=${s.mode} status=${s.status} 消息数=${msgs.length}`)
  }

  // 6. 拉取 activity_records (按天聚合)
  const allAct = []
  let f = 0
  while (true) {
    const { data, error } = await supabase
      .from('activity_records').select('*').eq('user_id', userId)
      .order('ts', { ascending: true })
      .range(f, f + 999)
    if (error || !data) break
    allAct.push(...data)
    if (data.length < 1000) break
    f += 1000
  }
  console.log('\n===== Activity Records 总数:', allAct.length, '=====')

  const actByDate = {}
  for (const a of allAct) {
    if (!actByDate[a.date]) actByDate[a.date] = { samples: 0, active: 0, idle: 0, apps: {} }
    actByDate[a.date].samples += a.total_samples ?? 0
    actByDate[a.date].active += a.active_samples ?? 0
    actByDate[a.date].idle += a.idle ?? 0
    if (a.app_usage) {
      for (const [app, cnt] of Object.entries(a.app_usage)) {
        actByDate[a.date].apps[app] = (actByDate[a.date].apps[app] ?? 0) + cnt
      }
    }
  }
  for (const date of Object.keys(actByDate).sort()) {
    const d = actByDate[date]
    const ratio = d.samples > 0 ? (d.active / d.samples * 100).toFixed(1) : '0'
    const totalMin = (d.samples * 2 / 60).toFixed(0)
    console.log(`\n${date}: 在线 ${totalMin}分钟, 活跃率 ${ratio}%`)
    const topApps = Object.entries(d.apps).sort((a, b) => b[1] - a[1]).slice(0, 8)
    for (const [app, cnt] of topApps) {
      const min = (cnt * 2 / 60).toFixed(0)
      if (Number(min) >= 1) console.log(`  ${app}: ${min} 分钟`)
    }
  }

  // 7. 关键事件全文（用于追问）
  console.log('\n===== 关键事件原文（前 200 条 stuck/first-step/reflection） =====')
  const interesting = allEvents.filter(e => /stuck|first.step|reflection|chat|focus/i.test(e.event_type))
  for (const e of interesting.slice(0, 200)) {
    const ts = new Date(e.timestamp).toLocaleString('zh-CN', { hour12: false })
    console.log(`[${ts}] [${e.event_type}]`, JSON.stringify(e.payload).slice(0, 300))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
