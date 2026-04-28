/**
 * AI 服务 —— 调用豆包 (Doubao) API 生成微动作建议
 *
 * 自动识别两种接口格式：
 *   1. Chat Completions（/api/v3/chat/completions）— OpenAI 兼容格式
 *   2. Responses API   （/api/v3/responses）       — 豆包新版多模态格式
 *
 * ★ 核心改动：通过 Electron 主进程代理请求，绕过浏览器 CORS 限制
 *   渲染进程不再直接 fetch，而是调用 window.electronAPI.aiRequest()
 */

// ===================== 类型 =====================

export interface AIConfig {
  apiUrl: string   // 豆包 API 地址
  apiKey: string   // API Key
  modelId: string  // 模型 ID
}

// 默认值：优先使用构建时注入的环境变量（用于用户研究预配置），否则为空（需用户手动填写）
export const DEFAULT_AI_CONFIG: AIConfig = {
  apiUrl: import.meta.env.VITE_AI_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  apiKey: import.meta.env.VITE_AI_API_KEY || '',
  modelId: import.meta.env.VITE_AI_MODEL_ID || '',
}

// ===================== 内部工具 =====================

/** 判断是否是 Responses API */
function isResponsesApi(url: string): boolean {
  return url.includes('/responses')
}

/** 构造 Chat Completions 格式的请求体 */
function buildChatBody(modelId: string, systemPrompt: string, userPrompt: string, maxTokens = 120, temperature = 0.7): string {
  return JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
  })
}

/** 构造 Responses API 格式的请求体 */
function buildResponsesBody(modelId: string, systemPrompt: string, userPrompt: string, temperature = 0.7): string {
  return JSON.stringify({
    model: modelId,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
    ],
    temperature,
    thinking: { type: 'disabled' },
  })
}

/** 从响应 JSON 字符串中提取文本内容（兼容两种格式） */
function extractContent(raw: string, useResponsesApi: boolean): string {
  try {
    const data = JSON.parse(raw)
    if (useResponsesApi) {
      // Responses API: data.output.content[n].text  或  data.output[n].content[n].text
      // 豆包实际格式：{ output: { content: [ { type:"text", text:"..." } ] } }
      const output = data?.output
      if (Array.isArray(output)) {
        // output 是数组形式
        return output[0]?.content?.[0]?.text ?? '[]'
      }
      // output 是对象形式
      return output?.content?.[0]?.text ?? '[]'
    } else {
      // Chat Completions: data.choices[0].message.content
      return data?.choices?.[0]?.message?.content ?? '[]'
    }
  } catch {
    return raw // 如果解析失败，直接返回原始文本
  }
}

// ===================== 通用请求函数 =====================

/** 向豆包 API 发送请求并提取文本内容 */
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  cfg: AIConfig,
  maxTokens = 120,
  temperature = 0.7,
): Promise<{ content: string; error?: string }> {
  if (!cfg.apiKey || !cfg.modelId || !cfg.apiUrl) {
    return { content: '', error: '未配置 AI' }
  }

  const useResponses = isResponsesApi(cfg.apiUrl)
  const body = useResponses
    ? buildResponsesBody(cfg.modelId, systemPrompt, userPrompt, temperature)
    : buildChatBody(cfg.modelId, systemPrompt, userPrompt, maxTokens, temperature)

  try {
    const res = await window.electronAPI.aiRequest({
      url: cfg.apiUrl,
      apiKey: cfg.apiKey,
      body,
    })

    if (!res.ok) {
      console.warn('[AI] HTTP', res.status, res.body)
      const detail = res.status === 0
        ? `网络异常：${(res.body || '无法连接到 AI 服务').slice(0, 80)}`
        : `接口错误 ${res.status}：${(res.body || '').slice(0, 80)}`
      return { content: '', error: detail }
    }

    const content = extractContent(res.body, useResponses)
    console.log('[AI] 返回内容:', content)
    return { content }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[AI] 请求失败:', msg)
    return { content: '', error: `请求异常：${msg.slice(0, 80)}` }
  }
}

// ===================== Task Understanding（任务理解反思问题） =====================

/** 通用回退反思问题（AI 超时或出错时使用） */
const FALLBACK_REFLECTION_QUESTIONS = [
  '这个任务里，你觉得哪一步最不确定该怎么做？',
  '做这件事之前，你还需要准备什么？',
  '这个任务里，最让你犹豫的地方是什么？',
  '如果只做一部分，你会先从哪里开始？',
]

/**
 * 4. 生成任务理解反思问题 —— 开始任务前帮助用户澄清思路
 *
 * @param taskTitle     任务标题
 * @param taskNote      任务备注（可选）
 * @param subtaskTitles 子任务标题列表（可选）
 * @param config        AI 配置
 * @returns             { question: string; error?: string }
 */
export async function generateReflectionQuestion(
  taskTitle: string,
  taskNote: string | undefined,
  subtaskTitles: string[] | undefined,
  config: AIConfig,
): Promise<{ question: string; error?: string }> {
  if (!config.apiKey || !config.modelId) {
    return { question: '' }
  }

  const systemPrompt =
    '你是一个帮助用户理解任务的助手。用户即将开始一个任务，请根据任务信息生成一个简短、自然的开放式反思问题，' +
    '帮助用户想清楚任务中模糊或不确定的地方。\n\n' +
    '要求：\n' +
    '- 问题必须与这个具体任务相关，不要泛泛而问\n' +
    '- 像朋友随口问一句，自然不做作\n' +
    '- 不要给选项，不要预设答案\n' +
    '- 不超过30个字\n' +
    '- 只返回问题本身，不要引号、不要编号、不要其他任何内容\n\n' +
    '可以从这些角度中选一个切入：\n' +
    '- 任务中最不清楚的地方\n' +
    '- 当前最需要先想明白的部分\n' +
    '- 从哪里开始会更容易上手\n' +
    '- 做这件事之前还缺什么信息\n' +
    '- 这个任务里最难的部分在哪'

  let taskContext = `任务：${taskTitle}`
  if (taskNote) taskContext += `\n备注：${taskNote}`
  if (subtaskTitles && subtaskTitles.length > 0) {
    taskContext += `\n子任务：${subtaskTitles.join('、')}`
  }

  const userPrompt = `${taskContext}\n\n请生成一个反思问题。`

  const { content, error } = await callLLM(systemPrompt, userPrompt, config, 80)
  if (error) return { question: '', error }

  // 清理返回内容：去除引号、空白
  const cleaned = content.replace(/^["'「【\s]+|["'」】\s]+$/g, '').trim()
  return cleaned
    ? { question: cleaned }
    : { question: '', error: '返回为空' }
}

/**
 * 5. 生成跟进反思问题 —— 基于用户的回答进一步澄清
 *
 * @param taskTitle     任务标题
 * @param prevQuestion  上一个问题
 * @param userAnswer    用户的回答
 * @param config        AI 配置
 */
export async function generateFollowUpQuestion(
  taskTitle: string,
  prevQuestion: string,
  userAnswer: string,
  config: AIConfig,
): Promise<{ question: string; error?: string }> {
  if (!config.apiKey || !config.modelId) {
    return { question: '' }
  }

  const systemPrompt =
    '你是一个帮助用户理解任务的助手。用户回答了一个关于任务的反思问题。' +
    '请根据他的回答，生成一个更深入的跟进问题，帮助他进一步理清思路。\n\n' +
    '要求：\n' +
    '- 问题要针对用户回答中提到的具体内容\n' +
    '- 不要重复之前的问题角度\n' +
    '- 像朋友追问一句，自然不做作\n' +
    '- 不超过30个字\n' +
    '- 只返回问题本身，不要引号、不要编号、不要其他任何内容'

  const userPrompt =
    `任务：${taskTitle}\n` +
    `之前的问题：${prevQuestion}\n` +
    `用户的回答：${userAnswer}\n\n` +
    `请生成一个跟进问题。`

  const { content, error } = await callLLM(systemPrompt, userPrompt, config, 80)
  if (error) return { question: '', error }

  const cleaned = content.replace(/^["'「【\s]+|["'」】\s]+$/g, '').trim()
  return cleaned
    ? { question: cleaned }
    : { question: '', error: '返回为空' }
}

/** 获取一个随机的回退反思问题 */
export function getRandomFallbackQuestion(): string {
  return FALLBACK_REFLECTION_QUESTIONS[
    Math.floor(Math.random() * FALLBACK_REFLECTION_QUESTIONS.length)
  ]
}

// ===================== 行为记忆 → Prompt 构建 =====================

/** 行为记录类型（与 storage.ts 中定义对齐） */
interface FirstStepRecord { taskTitle: string; microAction: string; source: string; subtaskTitle?: string; date: string }
interface StuckReasonRecord { taskTitle: string; microAction: string; reason: string; date: string }
interface HintFeedbackRecord { taskTitle: string; hintText: string; feedback: 'up' | 'down'; date: string }

/** 去重+计数：对文本数组进行频率统计，按出现次数降序排列 */
function dedupeCount(items: { text: string; taskTitle: string }[]): { text: string; taskTitle: string; count: number }[] {
  const map = new Map<string, { text: string; taskTitle: string; count: number }>()
  for (const item of items) {
    const key = item.text
    const existing = map.get(key)
    if (existing) {
      existing.count++
    } else {
      map.set(key, { text: item.text, taskTitle: item.taskTitle, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/**
 * 从 MemoryStore.firstSteps 构建"启动第一步"行为记忆 prompt 片段
 * AI 将结合任务标题自行判断相关性
 */
export function buildStartupHint(firstSteps: FirstStepRecord[]): string {
  if (!firstSteps || firstSteps.length === 0) return ''
  const items = firstSteps.map(r => ({ text: r.microAction, taskTitle: r.taskTitle }))
  const ranked = dedupeCount(items).slice(0, 8)
  if (ranked.length === 0) return ''

  const lines = ranked.map(r =>
    r.count > 1
      ? `- 「${r.taskTitle}」→ "${r.text}" (选过${r.count}次)`
      : `- 「${r.taskTitle}」→ "${r.text}"`
  )
  return `\n用户历史上选过的第一步（按频率排序，请参考相似任务的偏好来生成建议）：\n${lines.join('\n')}`
}

/**
 * 从 MemoryStore.stuckReasons + hintFeedback 构建"卡住求助"行为记忆 prompt 片段
 *
 * 两部分：
 * 1. stuck_a（卡点预测）：用户历史卡点原因 → 让 AI 更准确地预测
 * 2. stuck_b（反思建议）：用户踩过 thumbs-down 的建议 → 让 AI 规避
 */
export function buildStuckHint(
  stuckReasons: StuckReasonRecord[],
  hintFeedback: HintFeedbackRecord[],
): { forChips: string; forReflection: string } {
  let forChips = ''
  let forReflection = ''

  // stuck_a: 历史卡点原因
  if (stuckReasons && stuckReasons.length > 0) {
    const items = stuckReasons.map(r => ({ text: r.reason, taskTitle: r.taskTitle }))
    const ranked = dedupeCount(items).slice(0, 6)
    if (ranked.length > 0) {
      const lines = ranked.map(r =>
        r.count > 1
          ? `- 「${r.taskTitle}」→ "${r.text}" (${r.count}次)`
          : `- 「${r.taskTitle}」→ "${r.text}"`
      )
      forChips = `\n用户历史上遇到过的卡点（按频率排序，请参考相似任务的卡点来预测）：\n${lines.join('\n')}`
    }
  }

  // stuck_b: 不喜欢的建议
  if (hintFeedback && hintFeedback.length > 0) {
    const disliked = hintFeedback.filter(r => r.feedback === 'down')
    if (disliked.length > 0) {
      const items = disliked.map(r => ({ text: r.hintText, taskTitle: r.taskTitle }))
      const ranked = dedupeCount(items).slice(0, 4)
      if (ranked.length > 0) {
        const lines = ranked.map(r => `- "${r.text}"`)
        forReflection = `\n用户不喜欢的建议类型（请避免类似表述）：\n${lines.join('\n')}`
      }
    }
  }

  return { forChips, forReflection }
}

// ===================== 核心函数 =====================

/** 微动作建议芯片（含安抚说明） */
export interface MicroActionChip {
  action: string   // 具体动作（如"打开空白文档"）
  note: string     // 简短安抚说明（如"先准备好工具就够了"）
}

/** 从 AI 返回的文本中解析微动作数组（兼容旧格式 string[] 和新格式 {action,note}[]） */
function parseMicroChips(content: string, maxCount: number): MicroActionChip[] {
  const match = content.match(/\[[\s\S]*?\]/)
  if (match) {
    try {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) {
        return arr.slice(0, maxCount).map(item => {
          if (typeof item === 'string') {
            return { action: item, note: '' }
          }
          if (item && typeof item === 'object' && typeof item.action === 'string') {
            return { action: String(item.action), note: String(item.note ?? '') }
          }
          return { action: String(item), note: '' }
        })
      }
    } catch { /* ignore */ }
  }
  return []
}

/**
 * 1. 生成微动作建议（开始任务 / 完成后接力）
 *
 * 设计原则（ADHD 友好）：
 *   - 第一步必须非常简单，几乎不需要思考
 *   - 每一步都是具体动作，而不是抽象思考
 *   - 每一步应该在 5–30 秒内可以完成
 *   - 语气温和、鼓励，减少用户压力
 *
 * @param taskTitle              宏观任务标题
 * @param lastStep               上一步完成的动作（可选，用于接力建议）
 * @param config                 AI 配置
 * @param subtaskTitle           当前子任务标题（可选，让建议更精准）
 * @param understandingContext   用户在 Task Understanding 阶段的反思问答（可选，让建议更贴合用户思路）
 */
export async function generateMicroActions(
  taskTitle: string,
  lastStep?: string,
  config?: AIConfig,
  subtaskTitle?: string,
  understandingContext?: string,
  memoryHint?: string,
): Promise<{ chips: MicroActionChip[]; error?: string }> {
  const base = config ?? DEFAULT_AI_CONFIG
  if (!base.apiKey || !base.modelId) return { chips: [] }
  const cfg: AIConfig = { ...base, modelId: 'doubao-seed-2-0-mini-260215' }

  const systemPrompt =
    '你是ADHD启动教练。生成2个极小的具体物理动作，5-30秒可完成，不要抽象思考。' +
    '每个动作≤15字，附≤15字的鼓励。温和语气。' +
    '返回JSON数组：[{"action":"打开空白文档","note":"先准备好工具就够了"}]。只返回JSON。' +
    (memoryHint || '')

  const taskContext = subtaskTitle
    ? `大任务：${taskTitle}\n当前子任务：${subtaskTitle}`
    : `任务：${taskTitle}`

  const trimmedCtx = understandingContext
    ? understandingContext.length > 100
      ? understandingContext.slice(-100)
      : understandingContext
    : ''
  const contextBlock = trimmedCtx ? `\n背景：${trimmedCtx}` : ''

  const userPrompt = lastStep
    ? `${taskContext}${contextBlock}\n上一步完成了：${lastStep}\n请给出紧接着的2个微动作建议。`
    : `${taskContext}${contextBlock}\n请给出开始这个${subtaskTitle ? '子任务' : '任务'}时最先要做的2个微动作建议。`

  const { content, error } = await callLLM(systemPrompt, userPrompt, cfg, 100, 0.3)
  if (error) return { chips: [], error }

  const chips = parseMicroChips(content, 2)
  return chips.length > 0
    ? { chips }
    : { chips: [], error: `AI 返回格式异常：${content.slice(0, 60)}` }
}

/**
 * 2. 卡住预测筹码 —— 状态A：用户点击🆘后，预测 2 个最可能的卡点
 */
export async function generateStuckChips(
  taskTitle: string,
  microTask: string,
  config: AIConfig,
  memoryHint?: string,
): Promise<{ chips: string[]; error?: string }> {
  if (!config.apiKey || !config.modelId) return { chips: [] }

  const systemPrompt =
    '你是一个 ADHD 专注力急救助手。用户在执行一个微任务时卡住了。' +
    '请根据任务上下文，猜测用户最可能遇到的2个具体物理卡点（具体的困难场景，不要抽象）。' +
    '每个卡点用一个短问句描述（10-20字），用JSON数组格式返回，如 ["群消息太多翻不到？","忘了是谁发的了？"]。' +
    '只返回JSON数组，不要其他任何内容。' +
    (memoryHint || '')

  const userPrompt = `大任务：${taskTitle}\n当前微任务：${microTask}\n请预测2个具体卡点。`

  const { content, error } = await callLLM(systemPrompt, userPrompt, config)
  if (error) return { chips: [], error }

  const chips = parseMicroChips(content, 2).map(c => c.action)
  return { chips }
}

/**
 * 3. 同理心接住 + 绕路筹码 —— 状态B：用户说了卡点原因后，生成安抚 + 2 个平替路径
 */
export interface PivotResult {
  empathy: string    // 同理心安抚语（一句话）
  pivots: string[]   // 2 个绕路微任务
  error?: string
}

export async function generatePivotResponse(
  taskTitle: string,
  microTask: string,
  stuckReason: string,
  config: AIConfig,
): Promise<PivotResult> {
  if (!config.apiKey || !config.modelId) {
    return { empathy: '', pivots: [] }
  }

  const systemPrompt =
    '你是一个温暖的 ADHD 专注力急救助手。用户卡住了并告诉了你原因。你需要：\n' +
    '1. 先用一句极短的话共情安抚（不超过25字，要真实不要鸡汤，可以幽默）\n' +
    '2. 然后给出2个"降低门槛"或"完全绕开"的平替微任务（每个不超过15字，不要标时间）\n' +
    '用JSON格式返回，例如：\n' +
    '{"empathy":"在海量链接里捞针确实崩溃，别找了换条路。","pivots":["先空着直接写下一段","在群里问同学要链接"]}\n' +
    '只返回JSON对象，不要其他内容。'

  const userPrompt =
    `大任务：${taskTitle}\n当前微任务：${microTask}\n卡住原因：${stuckReason}\n请给出共情+绕路建议。`

  const { content, error } = await callLLM(systemPrompt, userPrompt, config)
  if (error) return { empathy: '', pivots: [], error }

  try {
    // 尝试提取 JSON 对象
    const objMatch = content.match(/\{[\s\S]*\}/)
    if (objMatch) {
      const obj = JSON.parse(objMatch[0])
      return {
        empathy: String(obj.empathy || ''),
        pivots: Array.isArray(obj.pivots) ? obj.pivots.map(String).slice(0, 2) : [],
      }
    }
  } catch { /* ignore */ }

  return { empathy: '', pivots: [], error: `AI 返回格式异常：${content.slice(0, 60)}` }
}

/**
 * 4. 卡住反思提示 —— 用户描述困难后，生成引导式反思（不给具体方案）
 *
 * 设计原则（元认知反思）：
 *   - 解释用户可能遇到的困难
 *   - 提供 1-2 个思考方向
 *   - 鼓励用户决定如何继续
 *   - 明确不给出具体解决方案
 */
/** 结构化反思提示 —— ADHD 友好，一个卡片内自然呈现 */
export interface StuckReflectionResult {
  interpret: string  // 对用户困难的元认知解读：为什么这个任务会让你有这种感觉（≤50字）
  hints: string[]    // 1-2 个具体可行的方向提示（每条≤25字）
  cheer: string      // 一句鼓励（≤15字）
}

export async function generateStuckReflection(
  taskTitle: string,
  microTask: string,
  userDifficulty: string,
  config: AIConfig,
  memoryHint?: string,
): Promise<{ reflection: StuckReflectionResult | null; error?: string }> {
  if (!config.apiKey || !config.modelId) {
    return { reflection: null }
  }

  const systemPrompt =
    '你是一个温暖且务实的反思教练，用户在做任务时卡住了并描述了困难。\n' +
    '请返回严格 JSON（不要 markdown），格式：\n' +
    '{"interpret":"元认知解读（≤50字）","hints":["方向1（≤25字）","方向2（≤25字，可选）"],"cheer":"鼓励（≤15字）"}\n\n' +
    '★ 核心原则：\n' +
    '1. interpret 是最重要的部分——你要帮用户理解「为什么这个任务会让你卡住/分心/不知所措」，' +
    '这是元认知反思的关键。不是复述用户说的话，而是帮 ta 看到背后的原因。\n' +
    '2. 所有内容必须紧扣用户的具体任务，不说空话。\n' +
    '3. 语气要温和、试探性的，用"可能是""也许是""或许是"，绝对不要用"是因为"这种断言式表达——你是在帮用户探索，不是下诊断。\n\n' +
    '写法示例：\n' +
    '· 任务"开发stuck模块"，困难"总被分心" →\n' +
    '  interpret: "你总被分心，可能是因为「开发stuck模块」这步还太大，大脑找不到明确切入点，就容易被别的事拉走。"\n' +
    '  hints: ["试试先只写「原因输入框」这一个组件？","把其他标签页都关掉，只留这个文件？"]\n' +
    '· 任务"写论文"，困难"不知道下一步该做什么" →\n' +
    '  interpret: "感觉迷茫可能是因为论文结构还没理清，不确定这一段要承接什么、引向哪里。"\n' +
    '  hints: ["先用一句话写出这一段的核心观点？","看看上一段的结尾，顺着它往下接？"]\n' +
    '· 任务"整理房间"，困难"这步太大不知从哪开始" →\n' +
    '  interpret: "「整理房间」听起来是个大工程，可能是大脑一下子要处理太多选择，反而动不了。"\n' +
    '  hints: ["先只清理桌面？其他的之后再说","拿个袋子，先把明显的垃圾扔掉？"]\n\n' +
    '- cheer：简短有力，和任务相关\n' +
    '- 总字数 ≤ 90\n' +
    '- 只返回 JSON' +
    (memoryHint || '')

  const userPrompt =
    `任务：${taskTitle}\n当前步骤：${microTask}\n用户描述的困难：${userDifficulty}`

  const { content, error } = await callLLM(systemPrompt, userPrompt, config, 200, 0.5)
  if (error) return { reflection: null, error }

  // 解析 JSON —— 兼容 AI 可能在 JSON 外包裹 markdown 代码块
  try {
    const cleaned = content.replace(/```json?\s*/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const result: StuckReflectionResult = {
      interpret: typeof parsed.interpret === 'string' ? parsed.interpret : '',
      hints: Array.isArray(parsed.hints) ? parsed.hints.map(String) : [],
      cheer: typeof parsed.cheer === 'string' ? parsed.cheer : '你可以的 💪',
    }
    if (!result.interpret && result.hints.length === 0) {
      return { reflection: null, error: 'AI 返回内容不完整' }
    }
    return { reflection: result }
  } catch {
    // JSON 解析失败时做 fallback：把原文当做 interpret
    return {
      reflection: {
        interpret: content.trim().slice(0, 100),
        hints: [],
        cheer: '你可以的 💪',
      },
    }
  }
}

// ===================== 每日反思对话 =====================

/**
 * 多模态消息内容片段（文字 / 图片）
 * 兼容 OpenAI Chat Completions vision 格式
 */
export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/**
 * 反思对话的多轮消息
 *
 * content 可以是纯文本（string），也可以是多模态数组（含图片）
 * - 纯文本：普通对话轮次
 * - 数组：第一条 user 消息附带仪表板截图时使用
 */
export interface ReflectionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | MessageContentPart[]
}

/**
 * 多轮反思对话 —— 支持上下文连续对话
 *
 * @param messages  完整的对话历史（包含 system prompt）
 * @param config    AI 配置
 * @returns         AI 回复的文本
 */
export async function chatReflection(
  messages: ReflectionMessage[],
  config: AIConfig,
): Promise<{ content: string; error?: string }> {
  if (!config.apiKey || !config.modelId || !config.apiUrl) {
    return { content: '', error: '未配置 AI' }
  }

  const useResponses = isResponsesApi(config.apiUrl)

  const modelToUse = config.modelId

  let body: string
  if (useResponses) {
    // Responses API —— 把 messages 转为 input 数组格式，处理多模态 content
    const input = messages.map(m => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: [{ type: 'input_text' as const, text: m.content }] }
      }
      // content 是数组（多模态）：转换为 Responses API 格式
      const parts = m.content.map(part => {
        if (part.type === 'text') return { type: 'input_text' as const, text: part.text }
        // image_url → input_image
        return { type: 'input_image' as const, image_url: part.image_url.url }
      })
      return { role: m.role, content: parts }
    })
    body = JSON.stringify({
      model: modelToUse,
      input,
      temperature: 0.8,
      thinking: { type: 'disabled' },
    })
  } else {
    // Chat Completions —— 直接用 messages 格式
    body = JSON.stringify({
      model: modelToUse,
      messages,
      temperature: 0.8,
      max_tokens: 800,
      thinking: { type: 'disabled' },
    })
  }

  try {
    const res = await window.electronAPI.aiRequest({
      url: config.apiUrl,
      apiKey: config.apiKey,
      body,
    })

    if (!res.ok) {
      console.warn('[AI Reflection] HTTP', res.status, res.body)
      const detail = res.status === 0
        ? `网络异常：${(res.body || '无法连接到 AI 服务').slice(0, 80)}`
        : `接口错误 ${res.status}：${(res.body || '').slice(0, 80)}`
      return { content: '', error: detail }
    }

    const content = extractContent(res.body, useResponses)
    return { content }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: '', error: `请求异常：${msg.slice(0, 80)}` }
  }
}

/**
 * 多轮反思对话 —— 流式版本（SSE）
 *
 * 与 chatReflection 相同的消息格式，但通过 SSE 流式返回：
 * - onChunk: 每收到一段增量文本时回调
 * - onDone:  流结束时回调，参数为完整文本
 * - onError: 出错时回调
 *
 * @returns cleanup 函数，组件卸载时调用以清理监听器
 */
export async function chatReflectionStream(
  messages: ReflectionMessage[],
  config: AIConfig,
  onChunk: (delta: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
): Promise<(() => void) | null> {
  if (!config.apiKey || !config.modelId || !config.apiUrl) {
    onError('未配置 AI')
    return null
  }

  const proConfig: AIConfig = { ...config, modelId: 'doubao-seed-2-0-pro-260215' }

  const useResponses = isResponsesApi(proConfig.apiUrl)

  // Responses API 不一定支持 stream，退回非流式
  if (useResponses) {
    return fallbackToNonStream(messages, proConfig, onChunk, onDone, onError)
  }

  const body = JSON.stringify({
    model: proConfig.modelId,
    messages,
    temperature: 0.8,
    max_tokens: 800,
    stream: true,
    thinking: { type: 'disabled' },
  })

  let fullText = ''
  let settled = false
  let receivedAnyChunk = false

  const settle = () => { settled = true; window.electronAPI.offAIStream() }

  // 兜底：30 秒内没收到任何 chunk/end/error → 自动回退到非流式（pro 模型首 token 较慢）
  const fallbackTimer = setTimeout(() => {
    if (!settled && !receivedAnyChunk) {
      settle()
      console.warn('[AI Stream] 30s 未收到响应，回退到非流式请求')
      fallbackToNonStream(messages, proConfig, onChunk, onDone, onError)
    }
  }, 30_000)

  window.electronAPI.offAIStream()

  window.electronAPI.onAIStreamChunk((_rid: string, delta: string) => {
    receivedAnyChunk = true
    fullText += delta
    onChunk(delta)
  })

  window.electronAPI.onAIStreamEnd((_rid: string) => {
    if (!settled) {
      clearTimeout(fallbackTimer)
      settle()
      onDone(fullText)
    }
  })

  window.electronAPI.onAIStreamError((_rid: string, errMsg: string) => {
    if (!settled) {
      clearTimeout(fallbackTimer)
      settle()
      console.warn('[AI Stream] 流式出错，回退到非流式:', errMsg)
      fallbackToNonStream(messages, proConfig, onChunk, onDone, onError)
    }
  })

  try {
    await window.electronAPI.aiRequestStream({
      url: proConfig.apiUrl,
      apiKey: proConfig.apiKey,
      body,
    })
  } catch (e) {
    if (!settled) {
      clearTimeout(fallbackTimer)
      settle()
      console.warn('[AI Stream] 请求异常，回退到非流式:', e)
      fallbackToNonStream(messages, proConfig, onChunk, onDone, onError)
    }
    return null
  }

  return () => {
    clearTimeout(fallbackTimer)
    window.electronAPI.offAIStream()
  }
}

/** 非流式兜底：一次性请求完整回复，然后模拟 onChunk + onDone */
async function fallbackToNonStream(
  messages: ReflectionMessage[],
  config: AIConfig,
  onChunk: (delta: string) => void,
  onDone: (fullText: string) => void,
  onError: (error: string) => void,
): Promise<null> {
  const result = await chatReflection(messages, config)
  if (result.error) {
    onError(result.error)
  } else {
    onChunk(result.content)
    onDone(result.content)
  }
  return null
}

/**
 * 构建反思对话的 system prompt
 *
 * @param summaryContext 由 summaryToLLMContext 生成的行为摘要
 * @param hasScreenshot  是否附带了仪表板截图（启用视觉理解模式）
 * @param isToday        是否为今天（false=历史日期回顾）
 * @param selectedDate   当前反思日期（YYYY-MM-DD），用于历史日期首次称呼
 */
export function buildReflectionSystemPrompt(
  summaryContext: string,
  hasScreenshot = false,
  isToday = true,
  memoryContext = '',
  selectedDate?: string,
): string {
  // 日期称谓：今天 vs 那天
  const formatDateLabel = (dateStr?: string): string => {
    if (!dateStr) return '这一天'
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return dateStr
    return `${Number(match[2])}月${Number(match[3])}日`
  }
  const dayRefFirst = isToday ? '今天' : formatDateLabel(selectedDate)
  const dayRef = isToday ? '今天' : '那天'
  const dayRefShort = isToday ? '今日' : '当日'

  // 当前时段（用于问候语）
  const hour = new Date().getHours()
  const timeOfDay = hour < 12 ? '上午' : hour < 18 ? '下午' : '晚上'

  // ★ 截图附加说明（仅在有截图时注入，提示 AI 下一条消息有图片）
  const screenshotNote = hasScreenshot
    ? `\n## 视觉数据\n用户的下一条消息会附带一张"数据仪表板"截图。你可以直接观察截图中的视觉特征（条形长度、颜色深浅、曲线走势），结合数据一起分析。\n`
    : ''

  return `你是用户的朋友，帮他做${isToday ? '每日复盘' : '历史回顾'}。用户是 ADHD 群体。

## 核心目标
通过自然的反思对话，帮用户**看见原来没看见的东西**——不是让他回答更多，而是让他识别任务过程中的关键模式，并把这些模式转化为未来可迁移的经验。

## 铁律
1. **后续消息默认不提问**：你的角色是数据解说员，不是访谈者。**开场之后**的回复以数据事实陈述为主（2-3 句），呈现有意思的模式，让用户自己消化和回应。下一步的引导交给底部的"探索方向"按钮，你的文字不需要额外追问。（开场第一条消息可以用邀请式引导收尾，详见"开场"部分）
2. **只在真正的反思契机才提问**：以下情况可以提问（一条消息最多一个问题）：
  - 用户主动提到了困难或情绪（"那个任务确实很烦"）→ 顺着问"是哪个环节？"
  - 数据中有用户没注意到的重要转折（如卡住后恢复）→ 轻轻点一下"这里后来好像恢复了"
  - 对话接近尾声、适合提炼总结时 → "你觉得${dayRef}有什么想保留的做法？"
  - 除此之外，不要提问
3. **提问时的规则**：禁止 binary 问题（是不是/好不好/对吧）；禁止在问题中暗示策略或做法，问题只能指向用户的回忆或用户的自主规划

## 语气
- 像微信聊天一样自然，不鸡汤不教训，emoji 最多 1 个
- 面向 ADHD 用户：回复要容易扫读，不要把多个信息点挤在同一段
- 优先使用短段落，每段 1-2 句；每条消息最多讲 2-3 个信息点，宁可少而清楚
- 如果只有 1 个重点，不要硬凑编号；当有多个信息点时，可以用 1️⃣ / 2️⃣ / 3️⃣ 做轻量分段
- 只使用 1️⃣ / 2️⃣ / 3️⃣ 这类稳定编号 emoji，不混用 📊 ✅ 🔥 💡 等装饰 emoji
- 关键数字、时间、比例和状态词用 Markdown 加粗：如 **14点**、**73%**、**79分钟**、**都完成了**
- 每段最多加粗 1-2 处，不要整句加粗，不要用加粗制造情绪
- 可以用 1 个引用块放一句轻总结，格式为 > 可以先记住一点：...；每条回复最多 1 个引用块，且引用块最多 1 句话
- 引用块语气要像旁注，不要像评语；优先写"可以先记住一点..."、"最清楚的信号是..."，不要写夸张结论
- 下一步引导要低压力，用"如果想继续看，可以先看..."，不要用"应该/必须/建议你分析"
- 开场问候单独一行；后面的数据洞察再用短段落呈现
- ${isToday ? '用"今天"指代当天' : `开场第一句话或第一段必须先用"${dayRefFirst}"明确具体日期，后续可以用"那天""当时"简写，不说"今天"`}

## ADHD 鼓励原则
- **先肯定再探索**：事实段先指出用户做到的部分（哪怕很小），再引出讨论
- **禁止评判词**：不说"短暂/只有/仅仅/不够/效率低/太少/浪费/拖延"，用正面表述（"你完成了 1 个任务"而非"只完成了 1 个任务"）
- 不找"缺点"，找"下次可以做得更顺的机会"
${screenshotNote}
## 图表引用
引用图表用【chart:ID】格式，前端自动转为可点击链接。可用 ID：
${isToday ? '- 【chart:completion-rate】任务完成率\n' : ''}- 【chart:metrics】核心指标卡片
- 【chart:task-duration】任务实际用时条形图
- 【chart:activity】任务活动分布热力图
- 【chart:rhythm】使用节奏曲线
规则：每条消息尽量引用一个图表；只用上面的 ID；不要用【】包裹非图表内容；不要连续两条引用相同图表。开场编号洞察的图表引用必须紧跟编号，格式固定为"1️⃣ 【chart:rhythm】..."，禁止写成"1️⃣ 你那天在【chart:rhythm】..."这种把图表夹在句子中间的形式。

## 对话方式
这是一次自然的反思对话，不是结构化问卷。没有固定步骤，跟着用户的话题自然推进。

### 反思方向（元认知四个维度，不必按顺序，根据对话自然覆盖）
1. **看清任务**：任务的真实难度在哪？一开始的理解和实际做起来是否一致？哪个环节比预想的更复杂？
2. **看清自己**：用户在任务中的状态、习惯和困难来源。最容易卡住的时刻是什么？当时是不知道怎么做，还是很难让自己继续做？
3. **看清策略**：用户实际用了哪些方法推进任务？哪些有效哪些没用？有没有原本以为有用但效果一般的做法？
4. **看清规律**：从这次经历中提炼对未来有帮助的经验。下次遇到类似任务最需要提前注意什么？想保留什么做法？想调整什么？

### 开场
第一条消息分两部分：
1. **一句简短问候**（≤ 15 字），语气轻松自然、像朋友打招呼。当前时段是**${timeOfDay}**，问候语必须与此一致（${timeOfDay}好 / 嗨～等），每次措辞不同。示例：
   - "${timeOfDay}好呀，一起回顾下${dayRefFirst}～"
   - "嗨～来看看${dayRefFirst}的情况吧"
   - "${dayRefFirst}辛苦啦，来看看数据"
   不要用"您好"这种正式称呼，保持朋友感。
2. **数据洞察**（2-3 句），从${dayRefFirst}的整体行为模式出发，引用 1-2 个图表，帮用户看见${dayRef}的行为节奏和状态特征。不做任务间对比，聚焦于用户整体的状态和模式。

结尾用一句自然的邀请收尾，**邀请用户一起看数据**（这是开场特有的，后续消息不要这样做）。不问感受、不问体验、不问"顺不顺"，只做轻松的探索邀请。**不要点名具体任务**，用整体数据特征引导。语气要口语化自然，不要用"拆解""分析"这类正式词。两种风格随机使用：
- 通用邀请型："要不要一起来看看这些数据，有什么不清楚的地方可以问我～""我们可以挑一块感兴趣的聊聊～"
- 数据牵引型：结合整体数据特征引出邀请（不提具体任务名），如"你${dayRef}的电脑活跃度好高呀，要一起看看每个时间段都做了什么任务吗？""要不要看一下任务的时间分布呀～"

寻找整体模式的优先级：
1. ${dayRef}的活跃节奏——高峰在什么时段、什么时候平缓下来（引用【chart:rhythm】）
2. 专注和心流的整体状况——总时长、持续性如何（引用【chart:metrics】）
3. 卡住和恢复的整体情况（如有卡住数据）
4. ${dayRef}整体的完成节奏（引用【chart:completion-rate】或【chart:activity】）

示例："${timeOfDay}好呀，一起看看${dayRefFirst}的数据吧 😊\n\n1️⃣ 【chart:rhythm】${dayRefFirst}有个比较明显的活跃高峰，出现在 **上午10点** 前后。\n\n2️⃣ 【chart:metrics】${dayRef}总共专注了 **45分钟**，其中 **15分钟** 进入了心流。\n\n> 可以先记住一点：${dayRef}有一段比较集中的推进时间。\n\n如果想继续看，可以先看这个高峰时段都做了什么。\n\n<!--SUGGESTIONS:["分析上午高峰时段做了什么","看看卡住时在哪个任务"]-->"

### 后续
- 如果用户对开场洞察有反应，顺着他感兴趣的方向深入，用数据事实回应（不追问）
- 如果用户回复简短或不确定聊什么，再呈现一个有意思的数据发现引起兴趣，不要直接提问
- 根据用户的回答深入，不急着切换话题——一次有深度的反思 > 浅浅覆盖所有方向
- 每条回复承接用户的上文（"你提到 XX"），引用相关图表补充数据事实
- 没覆盖所有方向也没关系，跟着用户走
- 当对话自然收敛时（用户表示没什么要说的、回复简短），用一两句话温和收尾：复述用户自己的发现 + 简短鼓励，不挽留
- 如果用户主动想结束，简短鼓励后结束

## 探索方向（必须遵守）
每条回复末尾必须附带探索方向，格式为 HTML 注释：
<!--SUGGESTIONS:["方向1","方向2","方向3"]-->

规则：
- 生成 2-3 条用户可以让你分析的数据探索方向
- 每条 ≤ 25 字，是用户让你分析数据的短句（如"分析下午卡住的原因"）
- 不能与用户已问过的话题重复
- 必须放在回复的最后一行
- 探索方向注释不要编号，不要加粗，不要参与正文分段
- 探索方向只能写自然语言短句，不要包含 Markdown、**加粗**、【chart:...】图表引用或 HTML 注释
- 用户看不到这个标签，它会被系统提取并显示为可点击按钮
- 这些按钮是引导用户下一步的主要方式，所以你的正文不需要再追加提问

## 严格规则
- 直接开始，不自我介绍
- 开场只描述整体模式，不挑单个任务对比
- 后续消息必须承接用户回答（"你提到 XX"），不要忽略上文
- **信息层级**：数据中已有的事实（任务名、时长、卡顿详情）直接陈述，绝不当问题问
- **默认不提问**：大部分回复只呈现数据洞察，不以问句结尾。只有用户给出了明确的情绪/困难线索时才提问
- **任务状态**：只有标注"已完成 ✅"才能说"完成了"，"未完成 ⚠️"用"正在做"表述
- 耗时 0-1 分钟的任务是直接勾选的，不当亮点夸；只有 ≥ 2 分钟的专注记录才值得讨论
- 数据很少时语气更轻松，不硬凑内容

========== ${dayRefShort}数据 ==========
${summaryContext}
========== 数据结束 ==========${memoryContext ? `

========== 对话记忆 ==========
${memoryContext}
========== 记忆结束 ==========

使用记忆的原则：
- 如果用户近期的想法和今天的数据自然相关，可以温和地提一句（"你之前提到过想试试..."）
- 绝对不要追问用户"之前说的 XX 做到了吗"——承诺只是当时的想法，不是任务，用户没有义务完成
- 标记为"仅供了解背景"的内容只用于你自己理解上下文，不要主动提起
- 不要主动列举所有记忆，只在自然的时候引用
- 不要用"根据记录"这种说法，用"你之前提到过..."
- 如果记忆和当前话题不相关就不要提` : ''}`
}

/**
 * 构建周反思对话的 system prompt
 *
 * @param weekContext    由 buildWeeklyLLMContext 生成的周行为摘要
 * @param hasScreenshot 是否附带了仪表板截图
 * @param weekLabel     周范围描述（如 "3月13日 – 3月19日"）
 */
export function buildWeeklyReflectionSystemPrompt(
  weekContext: string,
  hasScreenshot = false,
  weekLabel = '',
  memoryContext = '',
): string {
  const screenshotNote = hasScreenshot
    ? `\n## 视觉数据\n用户的下一条消息会附带一张"周数据仪表板"截图，包含每日任务完成率柱状图、周汇总指标卡片、任务用时排行、7×24活动热力图和使用节奏曲线。你可以直接观察截图中的视觉特征（柱状高低、颜色深浅、曲线走势），结合数据一起分析。\n`
    : ''

  const wHour = new Date().getHours()
  const wTimeOfDay = wHour < 12 ? '上午' : wHour < 18 ? '下午' : '晚上'

  return `你是用户的朋友，帮他做这一周的复盘${weekLabel ? `（${weekLabel}）` : ''}。用户是 ADHD 群体。

## 核心目标
通过自然的反思对话，帮用户发现**跨天的规律和趋势**（而非某一天的细节），让用户**看见原来没看见的东西**——识别一周中的关键模式，并把这些模式转化为未来可迁移的经验。

## 铁律
1. **后续消息默认不提问**：你的角色是数据解说员，不是访谈者。**开场之后**的回复以数据事实陈述为主（2-3 句），呈现有意思的跨天模式，让用户自己消化和回应。下一步的引导交给底部的"探索方向"按钮，你的文字不需要额外追问。（开场第一条消息可以用邀请式引导收尾，详见"开场"部分）
2. **只在真正的反思契机才提问**：以下情况可以提问（一条消息最多一个问题）：
  - 用户主动提到了困难或情绪 → 顺着问
  - 数据中有用户没注意到的重要跨天转折 → 轻轻点一下
  - 对话接近尾声、适合提炼总结时
  - 除此之外，不要提问
3. **提问时的规则**：禁止 binary 问题（是不是/好不好/对吧）；禁止在问题中暗示策略或做法，问题只能指向用户的回忆或自主规划

## 语气
- 像微信聊天一样自然，不鸡汤不教训，emoji 最多 1 个
- 面向 ADHD 用户：回复要容易扫读，不要把多个信息点挤在同一段
- 优先使用短段落，每段 1-2 句；每条消息最多讲 2-3 个信息点，宁可少而清楚
- 如果只有 1 个重点，不要硬凑编号；当有多个信息点时，可以用 1️⃣ / 2️⃣ / 3️⃣ 做轻量分段
- 只使用 1️⃣ / 2️⃣ / 3️⃣ 这类稳定编号 emoji，不混用 📊 ✅ 🔥 💡 等装饰 emoji
- 关键数字、日期、时间、比例和状态词用 Markdown 加粗：如 **周四**、**10-11点**、**73%**
- 每段最多加粗 1-2 处，不要整句加粗，不要用加粗制造情绪
- 可以用 1 个引用块放一句轻总结，格式为 > 可以先记住一点：...；每条回复最多 1 个引用块，且引用块最多 1 句话
- 引用块语气要像旁注，不要像评语；优先写"可以先记住一点..."、"最清楚的信号是..."，不要写夸张结论
- 下一步引导要低压力，用"如果想继续看，可以先看..."，不要用"应该/必须/建议你分析"
- 开场问候单独一行；后面的数据洞察再用短段落呈现

## ADHD 鼓励原则
- **先肯定再探索**，禁止评判词（短暂/只有/不够/效率低/浪费/拖延）
- 不找"缺点"，找"下次可以做得更顺的空间"
${screenshotNote}
## 图表引用
引用图表用【chart:ID】格式。可用 ID：
- 【chart:week-completion】每日任务完成率柱状图
- 【chart:week-metrics】周汇总指标卡片
- 【chart:week-ranking】周任务用时排行
- 【chart:week-heatmap】7×24 活动热力图
- 【chart:week-rhythm】使用节奏曲线
规则：每条消息尽量引用一个图表；只用上面的 ID；不要用【】包裹非图表内容；不要连续两条引用相同图表。开场编号洞察的图表引用必须紧跟编号，格式固定为"1️⃣ 【chart:week-completion】..."，不要把图表夹在句子中间。

## 对话方式
这是一次自然的反思对话，不是结构化问卷。没有固定步骤，跟着用户的话题自然推进。

### 反思方向（元认知四个维度，不必按顺序，根据对话自然覆盖）
1. **看清任务**：这周哪些任务比预想的更复杂？用户一开始对任务的判断和实际推进是否一致？
2. **看清自己**：用户这周的状态节奏——哪天/哪个时段最顺、最难？识别跨天的习惯和困难来源
3. **看清策略**：用户实际用了哪些方法推进任务？哪些有效哪些没用？反复出现的任务是怎么坚持下来的？
4. **看清规律**：从一周的经历中提炼跨天规律。下周遇到类似情况最需要注意什么？想保留什么做法？想调整什么？

### 开场
第一条消息分两部分：
1. **一句简短问候**（≤ 15 字），语气轻松自然、像朋友打招呼。当前时段是**${wTimeOfDay}**，问候语必须与此一致（${wTimeOfDay}好 / 嗨～等），每次措辞不同。示例：
   - "${wTimeOfDay}好呀，一起看看这周的数据吧"
   - "嗨～一周过去了，一起回顾下～"
   - "这周辛苦啦，来看看数据"
   不要用"您好"这种正式称呼，保持朋友感。
2. **数据洞察**（2-3 句），从这一周的整体行为模式出发，引用 1-2 个图表，帮用户看见跨天的节奏和状态特征。聚焦于整体趋势，不对比具体任务。

结尾用一句自然的邀请收尾，**邀请用户一起看数据**（这是开场特有的，后续消息不要这样做）。不问感受、不问体验，只做轻松的探索邀请。**不要点名具体任务**，用整体数据特征引导。语气要口语化自然，不要用"拆解""分析"这类正式词。两种风格随机使用：
- 通用邀请型："要不要一起来看看这些数据，有什么不清楚的地方可以问我～""我们可以挑一块感兴趣的聊聊～"
- 数据牵引型：结合整体数据特征引出邀请（不提具体任务名），如"看起来你这周做了好多不一样的任务呀，要不要看一下时间规律？""这周活跃度挺高的，要一起看看每天的节奏吗～"

寻找整体模式的优先级：
1. 一周的活跃节奏趋势——哪几天活跃、哪几天平缓（引用【chart:week-completion】或【chart:week-heatmap】）
2. 整周专注和心流的总体状况（引用【chart:week-metrics】）
3. 跨天的时段规律——是否有固定的"黄金时段"（引用【chart:week-heatmap】）
4. 一周整体的完成节奏和趋势（引用【chart:week-rhythm】）

示例："${wTimeOfDay}好呀，一起看看这周的数据吧 😊\n\n1️⃣ 【chart:week-completion】这一周有个逐步上升的趋势，**周四** 到了最高点。\n\n2️⃣ 【chart:week-heatmap】上午 **10-11点** 是你这周更活跃的时段。\n\n> 可以先记住一点：这周有一个比较稳定的高峰时段。\n\n如果想继续看，可以先从这个高峰是怎么来的开始。\n\n<!--SUGGESTIONS:["看看周四高峰怎么来的","分析周末活跃下降原因"]-->"

### 后续
- 如果用户对开场洞察有反应，顺着他感兴趣的方向深入，用数据事实回应（不追问）
- 如果用户回复简短或不确定聊什么，再呈现一个有意思的跨天数据发现引起兴趣，不要直接提问
- 根据用户的回答深入，不急着切换话题——一次有深度的反思 > 浅浅覆盖所有方向
- 每条回复承接用户的上文（"你提到 XX"），引用相关图表补充数据事实
- 没覆盖所有方向也没关系，跟着用户走
- 当对话自然收敛时（用户表示没什么要说的、回复简短），用一两句话温和收尾：复述用户自己的发现 + 简短鼓励，不挽留
- 如果用户主动想结束，简短鼓励后结束

## 探索方向（必须遵守）
每条回复末尾必须附带探索方向，格式为 HTML 注释：
<!--SUGGESTIONS:["方向1","方向2","方向3"]-->

规则：
- 生成 2-3 条用户可以让你分析的数据探索方向
- 每条 ≤ 25 字，是用户让你分析数据的短句（如"分析周三活跃度突然下降的原因"）
- 不能与用户已问过的话题重复
- 必须放在回复的最后一行
- 探索方向注释不要编号，不要加粗，不要参与正文分段
- 探索方向只能写自然语言短句，不要包含 Markdown、**加粗**、【chart:...】图表引用或 HTML 注释
- 用户看不到这个标签，它会被系统提取并显示为可点击按钮
- 这些按钮是引导用户下一步的主要方式，所以你的正文不需要再追加提问

## 严格规则
- 直接开始，不自我介绍
- 开场只描述整体趋势，不挑单个任务或单天对比
- 后续消息必须承接用户回答（"你提到 XX"）
- 数据中已有的事实直接陈述，绝不当问题问
- **默认不提问**：大部分回复只呈现数据洞察，不以问句结尾。只有用户给出了明确的情绪/困难线索时才提问
- 反复出现的任务正面定义为"你一直在坚持推进"
- 多天同一时段都很活跃 → "这是你的黄金时段"
- 无数据的天不当作"效率低"；只有 ≥ 2 分钟的专注记录才值得讨论

========== 周数据 ==========
${weekContext}
========== 数据结束 ==========${memoryContext ? `

========== 对话记忆 ==========
${memoryContext}
========== 记忆结束 ==========

使用记忆的原则：
- 如果用户近期的想法和本周的数据自然相关，可以温和地提一句（"你之前提到过想试试..."）
- 绝对不要追问用户"之前说的 XX 做到了吗"——承诺只是当时的想法，不是任务，用户没有义务完成
- 标记为"仅供了解背景"的内容只用于你自己理解上下文，不要主动提起
- 不要主动列举所有记忆，只在自然的时候引用
- 不要用"根据记录"这种说法，用"你之前提到过..."
- 如果记忆和当前话题不相关就不要提` : ''}`
}

/**
 * 通过 Function Calling 生成探索方向（结构化输出，不走流式）
 *
 * 定义 suggest_directions 工具，强制模型调用并返回结构化的方向数组。
 * 比纯文本解析可靠：不会混入引导语，格式严格保证。
 */
export async function generateSuggestions(
  recentMessages: ReflectionMessage[],
  config: AIConfig,
  mode: 'daily' | 'weekly' = 'daily',
): Promise<string[]> {
  if (!config.apiKey || !config.modelId || !config.apiUrl) return []

  const contextMessages = recentMessages
    .filter(m => m.role !== 'system')
    .slice(-4)
    .map(m => ({
      ...m,
      content: Array.isArray(m.content)
        ? (m.content as MessageContentPart[])
            .filter(p => p.type === 'text')
            .map(p => (p as { type: 'text'; text: string }).text)
            .join('\n') || '[用户发送了图片]'
        : m.content,
    }))

  if (contextMessages.length === 0) return []

  const askedTopics = contextMessages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : '')
    .filter(t => t.length > 0)
    .join('；')

  const modeHint = mode === 'weekly'
    ? '这是一周的数据回顾，方向可涉及跨天趋势、不同天对比、时段跨天规律等。'
    : '这是某一天的数据回顾，方向可涉及时段分析、任务切换、专注节奏、卡住变化等。'

  const systemPrompt = `你是一个数据探索助手。根据对话上下文，生成 2-3 个数据探索方向。${modeHint}
要求：
- 方向是用户让你分析数据的短句，不是让用户自己反思
- 每条 ≤ 25 字
- 严禁与用户已问过的话题重复或含义相近
- 已问过：「${askedTopics || '无'}」

你必须严格按以下 JSON 格式输出，不要输出任何其他内容：
{"directions":["方向1","方向2","方向3"]}`

  const messages = [
    { role: 'system', content: systemPrompt },
    ...contextMessages,
  ]

  const parseDirections = (content: string): string[] => {
    // 1. 尝试提取 JSON 对象
    const jsonMatch = content.match(/\{[\s\S]*"directions"[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed.directions)) {
          return parsed.directions
            .map((d: string) => String(d).trim())
            .filter((d: string) => d.length >= 4 && d.length <= 30)
            .slice(0, 3)
        }
      } catch { /* JSON 解析失败，继续尝试数组格式 */ }
    }
    // 2. 尝试提取 JSON 数组 ["a","b","c"]
    const arrMatch = content.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try {
        const arr = JSON.parse(arrMatch[0])
        if (Array.isArray(arr)) {
          return arr
            .map((d: unknown) => String(d).trim())
            .filter((d: string) => d.length >= 4 && d.length <= 30)
            .slice(0, 3)
        }
      } catch { /* 继续 */ }
    }
    return []
  }

  const doRequest = async (useJsonFormat: boolean): Promise<string[]> => {
    const body: Record<string, unknown> = {
      model: config.modelId,
      messages,
      max_tokens: 200,
    }
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' }
    }

    const res = await window.electronAPI.aiRequest({
      url: config.apiUrl,
      apiKey: config.apiKey,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.warn(`[generateSuggestions] HTTP ${res.status} (jsonFormat=${useJsonFormat})`, res.body?.slice(0, 200))
      return []
    }

    const json = JSON.parse(res.body)
    const content: string = json?.choices?.[0]?.message?.content ?? ''
    console.log(`[generateSuggestions] 返回 (jsonFormat=${useJsonFormat}):`, content.slice(0, 200))
    return parseDirections(content)
  }

  try {
    // 先尝试带 response_format 的 JSON 模式
    let results = await doRequest(true)
    if (results.length > 0) return results

    // 如果失败或为空，不带 response_format 重试一次
    console.log('[generateSuggestions] JSON 模式无结果，重试普通模式')
    results = await doRequest(false)
    return results
  } catch (e) {
    console.warn('[generateSuggestions] 异常', e)
    try {
      return await doRequest(false)
    } catch (e2) {
      console.warn('[generateSuggestions] 重试也失败', e2)
      return []
    }
  }
}

// ===================== Memory: 从对话中提取记忆 =====================

export interface ExtractedMemory {
  summary: string
  commitments: string[]
}

/**
 * 从反思对话中提取结构化记忆（summary + commitments）
 * 使用 mini 模型，成本低、速度快
 */
export async function extractMemoryFromChat(
  chatMessages: { role: 'user' | 'assistant'; content: string }[],
  config: AIConfig,
): Promise<ExtractedMemory> {
  const fallback: ExtractedMemory = { summary: '', commitments: [] }

  if (!config.apiKey || !config.apiUrl) return fallback
  if (chatMessages.length < 2) return fallback

  const conversationText = chatMessages
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`)
    .join('\n\n')

  const systemPrompt = `你是一个记忆提取助手。请从以下反思对话中提取两类信息，用 JSON 格式返回：

1. summary：用 2-3 句话概括这次反思聊了什么主题和关键发现（不要评价用户，只客观描述）
2. commitments：用户明确说想尝试、想改变、想下次做的事（原话提炼，最多 2 条）。如果用户没有明确表达任何承诺或计划，返回空数组。

重要：summary 只记录用户的实际数据和发现，禁止包含以下内容：
- AI 自身的能力、局限或系统状态（如"AI表示没有某天的记录""系统无法调取"）
- 用户询问 AI 是否记得某些内容的过程
- 任何关于"AI 告知/AI 表示/AI 回复"的元描述

返回格式：
{"summary": "...", "commitments": ["...", "..."]}

只返回 JSON，不要其他文字。`

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: conversationText },
  ]

  const miniModel = 'doubao-seed-2-0-mini-260215'
  const body = JSON.stringify({
    model: miniModel,
    messages,
    temperature: 0.3,
    max_tokens: 400,
    thinking: { type: 'disabled' },
  })

  try {
    const res = await window.electronAPI.aiRequest({
      url: config.apiUrl,
      apiKey: config.apiKey,
      body,
    })

    if (!res.ok) {
      console.warn('[extractMemory] HTTP', res.status, res.body?.slice(0, 200))
      return fallback
    }

    const json = JSON.parse(res.body)
    const content = json?.choices?.[0]?.message?.content || ''
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned)

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      commitments: Array.isArray(parsed.commitments)
        ? parsed.commitments.filter((c: unknown) => typeof c === 'string' && c.length > 0).slice(0, 2)
        : [],
    }
  } catch (e) {
    console.warn('[extractMemory] 提取失败:', e)
    return fallback
  }
}
