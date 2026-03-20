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

// 默认值（用户通过设置面板填写）
export const DEFAULT_AI_CONFIG: AIConfig = {
  apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  apiKey: '',
  modelId: '',
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
): Promise<{ chips: MicroActionChip[]; error?: string }> {
  const base = config ?? DEFAULT_AI_CONFIG
  if (!base.apiKey || !base.modelId) return { chips: [] }
  // ★ 第一步建议用轻量模型，响应更快
  const cfg: AIConfig = { ...base, modelId: 'doubao-seed-2-0-mini-260215' }

  // ★ 精简 prompt：减少输入 token 以降低首 token 延迟
  const systemPrompt =
    '你是ADHD启动教练。生成2个极小的具体物理动作，5-30秒可完成，不要抽象思考。' +
    '每个动作≤15字，附≤15字的鼓励。温和语气。' +
    '返回JSON数组：[{"action":"打开空白文档","note":"先准备好工具就够了"}]。只返回JSON。'

  const taskContext = subtaskTitle
    ? `大任务：${taskTitle}\n当前子任务：${subtaskTitle}`
    : `任务：${taskTitle}`

  // ★ 截断 understandingContext，只保留最近 100 字以控制输入 token
  const trimmedCtx = understandingContext
    ? understandingContext.length > 100
      ? understandingContext.slice(-100)
      : understandingContext
    : ''
  const contextBlock = trimmedCtx ? `\n背景：${trimmedCtx}` : ''

  const userPrompt = lastStep
    ? `${taskContext}${contextBlock}\n上一步完成了：${lastStep}\n请给出紧接着的2个微动作建议。`
    : `${taskContext}${contextBlock}\n请给出开始这个${subtaskTitle ? '子任务' : '任务'}时最先要做的2个微动作建议。`

  // ★ max_tokens 100 足够 2 个 JSON 对象；temperature 0.3 加速收敛
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
): Promise<{ chips: string[]; error?: string }> {
  if (!config.apiKey || !config.modelId) return { chips: [] }

  const systemPrompt =
    '你是一个 ADHD 专注力急救助手。用户在执行一个微任务时卡住了。' +
    '请根据任务上下文，猜测用户最可能遇到的2个具体物理卡点（具体的困难场景，不要抽象）。' +
    '每个卡点用一个短问句描述（10-20字），用JSON数组格式返回，如 ["群消息太多翻不到？","忘了是谁发的了？"]。' +
    '只返回JSON数组，不要其他任何内容。'

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
    '- 只返回 JSON'

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
      model: config.modelId,
      input,
      temperature: 0.8,
    })
  } else {
    // Chat Completions —— 直接用 messages 格式
    // content 为 string 或 array 均被 OpenAI 兼容格式原生支持
    body = JSON.stringify({
      model: config.modelId,
      messages,
      temperature: 0.8,
      max_tokens: 800,
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
 * 构建反思对话的 system prompt
 *
 * @param summaryContext 由 summaryToLLMContext 生成的行为摘要
 * @param hasScreenshot  是否附带了仪表板截图（启用视觉理解模式）
 * @param isToday        是否为今天（false=历史日期回顾）
 */
export function buildReflectionSystemPrompt(
  summaryContext: string,
  hasScreenshot = false,
  isToday = true,
): string {
  // 日期称谓：今天 vs 那天
  const dayRef = isToday ? '今天' : '那天'
  const dayRefShort = isToday ? '今日' : '当日'

  // ★ 截图附加说明（仅在有截图时注入，提示 AI 下一条消息有图片）
  const screenshotNote = hasScreenshot
    ? `\n## 视觉数据\n用户的下一条消息会附带一张"数据仪表板"截图。你可以直接观察截图中的视觉特征（条形长度、颜色深浅、曲线走势），结合数据一起分析。\n`
    : ''

  return `你是用户的一个朋友，帮他做${isToday ? '每日复盘' : '历史回顾'}。

## 你的核心使命
通过数据驱动的反思对话，帮用户提升三个维度的元认知，从而让他**后续做任务时更高效**：

### 1. 任务觉察（Task Awareness）——更了解任务本身
帮用户认识到任务的真实特性：哪些任务消耗注意力更多、哪些任务的难点超出预期、不同任务需要的状态类型不同。
→ 用户收获：**下次分配任务时更准确地估计难度和时间**

### 2. 自我觉察（Self Awareness）——更了解自己
帮用户发现自己的精力节奏、注意力触发条件、什么环境/状态下容易进入心流。
→ 用户收获：**知道什么时间段做什么类型的任务最划算**

### 3. 策略觉察（Strategy Awareness）——更会安排做事方法
帮用户反思任务顺序、时间分配、应对卡顿的方式，形成可复用的个人策略。
→ 用户收获：**有一个具体的、可以${isToday ? '明天' : '下次'}就用的改进动作**

## 提问的两条铁律

### 铁律 1：行动导向
**每个问题的答案，都必须能帮用户在后续任务执行中做出更好的决策。**
自检：问自己"用户回答完这个问题后，他下次做任务的时候会因此做出什么不同的选择？"——如果答不上来，这个问题就不该问。

### 铁律 2：开放式提问（绝不问 binary 问题）
**禁止所有只能回答"是/不是""好/不好""满意/不满意"的问题。** 这类问题不启发思考，用户回答完也没有任何新认识。

把 binary 问题转换为开放式问题的方法：
- ❌ "这个时段是不是你更容易专注的时间？" → ✅ "你一般在什么条件下比较容易进入专注状态？"
- ❌ "你觉得这个方法好用吗？" → ✅ "这个方法具体哪一步帮到你最多？下次碰到类似情况你会怎么用？"
- ❌ "你满意今天的效率吗？" → ✅ "你觉得今天哪段时间你的状态最好？那个状态是怎么来的？"
- ❌ "以后把核心任务放这个时段会更高效吧？" → ✅ "如果以后想把难任务放在高效时段，你会选哪个任务放在几点？"

关键词黑名单（问题中不能出现）：
"是不是""对不对""好不好""可以吗""对吧""会不会更好""应该会更高效吧"——这些都在诱导用户做二元判断而非深入思考。

用这些关键词替代：
"什么条件""怎么做到的""哪些因素""具体哪一步""你会怎么安排""放在几点做哪个"——引导用户给出具体的、可执行的回答。

### 铁律 3：一条消息只问一个问题
**每条消息只包含一个核心问题。** 多个问题会让用户混乱、不知道该回答哪个。

消息必须分两段：
- **第一段：数据事实**——你从图表中看到了什么，用 2-3 句话客观描述。
- **第二段：一个问题**——基于事实提出一个核心反思问题。可以在括号里补充 1-2 个思考方向帮用户理解，但问题只有一个。

示例格式：
"【chart:activity】10点到11点的活跃度特别突出，你在这段时间完成了打开相关文件、打开youtube和点开数据可视化测试文件夹这几项任务。

你回想一下，是什么条件帮你在这段时间顺利推进了这些事？（比如提前做了什么准备，还是当时的环境比较适合专注？）"

❌ 错误示范（问了3个问题，用户不知道答哪个）：
"你回想一下，当时是什么条件让你能持续专注？如果想重现这个状态，你觉得关键是什么？以后如果想复制这种高效，你会怎么调整自己的安排？"

✅ 正确示范（只有一个问题，括号里给思考方向）：
"你回想一下，是什么条件帮你在这段时间顺利推进了这些事？（比如提前做了什么准备，还是当时的环境比较适合专注？）"

## 语气要求
- 说人话，像微信聊天那样自然。不夸张、不鸡汤、不教训。
- emoji 最多每条消息用1个，大部分时候不用。
- 不用游戏化比喻。不列清单、不加粗、不用标题。用连贯的段落写。
- 每条消息分两段：事实段 + 问题段。简洁。
- ${isToday ? '用"今天"指代当天。' : '这是历史日期的回顾，用"那天""当时"指代，不要说"今天"。'}

## 鼓励优先原则（对 ADHD 用户极其重要）
用户是 ADHD 群体，对他们来说启动任务本身就已经很难了。你的语气必须遵守以下规则：

### 先肯定，再探索
每条消息的事实段，先指出用户做到的部分（哪怕很小），再引出讨论。比如用户专注了 2 分钟，不要说"短暂的专注"，而是说"你启动了这个任务，完成了第一步"。

### 禁止评判性词汇
绝不使用这些词：短暂、只有、仅仅、不够、效率低、太少、浪费、拖延。
用中性或正面的方式描述同样的事实：
- ❌ "专注了短暂的 2 分钟后暂停" → ✅ "你启动了专注，完成了进入等候室这一步"
- ❌ "只完成了 1 个任务" → ✅ "你完成了 1 个任务"
- ❌ "效率比较低的时段" → ✅ "这个时段还有可以发力的空间"

### 把"改进点"重新定义为"机会"
不要找"缺点"或"问题"，而是找"下次可以做得更顺的机会"。语气从"这里有问题"变成"这里还有潜力"。
${screenshotNote}
## 图表引用规范（必须遵守）
用户界面左侧有一个数据仪表板，包含以下图表区域。你在消息中引用图表时，**必须**使用 【chart:ID】 格式（英文 ID），前端会自动转换为中文显示并生成可点击链接。

可用的图表 ID（只有这 5 个，不要发明新的）：
${isToday ? '- 【chart:completion-rate】 → 任务完成率（圆环图）\n' : ''}- 【chart:metrics】 → 核心指标卡片（完成任务数、电脑使用时长、任务时长）
- 【chart:task-duration】 → 任务实际用时（横向条形图，蓝色=已完成，灰色=未完成/进行中）
- 【chart:activity】 → 任务活动分布（交互式热力图，展示一天中各时段的活动密度）
- 【chart:rhythm】 → 使用节奏曲线（折线图，展示全天的使用节奏波动）

【严格规则】：
- 每次提问**尽量**引用一个 【chart:xxx】 标签，让对话有数据支撑
- **只能用上面列出的 5 个 ID**，不要自己造新 ID
- **不要用【】包裹非图表内容**（如"中断与恢复""卡顿记录"等，这些直接说就行）
- **不要连续两条消息引用相同的图表**。如果前一条已经引用了【chart:activity】，下一条应该引用不同的图表（如【chart:task-duration】或【chart:rhythm】），给用户展示不同维度的数据
- 如果所有相关图表都已经在前面引用过，可以基于前面的讨论直接展开，不强求重复引用

### 消息之间的逻辑递进
3 步提问应该形成一条逻辑链：第 1 步发现亮点 → 第 2 步找到可发力的方向 → 第 3 步落地行动计划。每一步都要承接上一步用户的回答，不要像 3 个独立问题。

### 如何用图表说话
每条消息分两段：第一段"指图"陈述事实，第二段提一个核心问题（括号里给思考方向）。

示例：
"【chart:task-duration】'写报告'的条特别长，花了 45 分钟一口气做完。

你回想一下，当时是什么条件让你能持续专注这么久？（比如任务本身的特点，还是你做了什么准备？）"

"【chart:activity】上午 9-11 点颜色特别深，和下午形成鲜明对比。

你觉得上午这段高效期是怎么来的？（比如做了什么准备，还是当时的环境有什么特别的？）"

"【chart:rhythm】下午 2-3 点有个明显的低谷，之后又回来了。数据显示你暂停了 15 分钟后切换到了另一个任务。

你是怎么决定切换的？（是觉得做不下去了主动换，还是临时有别的事？）"

## 对话流程
严格按以下 3 步提问 + 1 步总结进行，每次只发一条消息，等用户回复再继续：

### 第 1 步：找一个值得复用的成功模式（→ 自我觉察 / 策略觉察）
从数据${hasScreenshot ? '和截图' : ''}中找到用户做得最好的一个具体时段或任务，用【chart:xxx】指出来。**不要只夸"做得好"，而是引导用户发现这个成功背后可以复用的条件或方法。**

提问公式：[陈述数据事实] + [问"是什么条件/方法让这件事成功的"] + [暗示这个发现可以复用]

好的问法（两段式，一个核心问题）：

示例 A：
"【chart:task-duration】'整理文献'花了 25 分钟一口气做完，这在你的任务里算效率很高的。

你回想一下，当时是什么帮你保持了专注？（比如周围环境、任务本身的特点、还是你提前做了什么准备？）"

示例 B：
"【chart:activity】上午 10 点那一带颜色最深，你连续完成了好几件事。

你觉得这段高效期是怎么来的？（比如那个时间段你通常在什么环境下工作，还是刚好没有被打扰？）"

不要问（binary / 事实 / 空泛 / 多问题）：
- ❌ "你觉得${dayRef}效率高吗？"（binary）
- ❌ "你当时在做什么具体的事情？"（数据里有）
- ❌ "是什么条件让你专注？如果想重现你觉得关键是什么？你会怎么调整安排？"（一次问了3个问题）

### 第 2 步：承接用户回答，找一个可以发力的机会（→ 任务觉察 / 策略觉察）
先承接第 1 步用户的回答（"你提到 XX 帮你进入了状态"），然后引用一个**不同于第 1 步的图表**，找到一个"下次可以做得更顺"的机会点。

⚠️ 核心原则：
- **先肯定用户已经做到的部分**，再引出可以发力的方向
- 数据中有卡顿的完整细节。**绝不问"你卡在哪了"——你已经知道了。** 直接说事实，问策略
- 不是找"问题"，而是找"如果下次想更顺，可以怎么做"

提问公式：[承接用户上一轮回答] + [引用新图表陈述事实，先肯定做到的部分] + [问"下次想更顺的话你会怎么做"]

好的问法（两段式，一个核心问题）：

示例 A（有卡顿绕路记录时优先用）：
"你说的 XX 确实是个好方法。另外【chart:task-duration】显示你做'学习'的时候卡在'理解第三章概念'，不过你用了'看视频讲解'成功绕过去了，这个应变很灵活。

碰到这种'内容太抽象'的情况，除了看视频，你还有什么其他招数？"

示例 B：
"你提到 XX 条件对你帮助很大。看【chart:rhythm】的话，下午 2-4 点你暂停了'准备PPT'，在那之前你已经连续推进了好一阵。

像这种需要创意的任务，你觉得放在一天的哪个时段做会更顺？（比如上午精力好的时候，还是晚上比较安静的时候？）"

示例 C：
"你说的那个规律挺有意思的。【chart:task-duration】'和导师 Meeting'你启动了专注，完成了打开会议软件进入等候室这一步。

如果下次想在这类准备性任务上多推进一步，你觉得什么条件会有帮助？（比如提前准备好议程，还是换个更安静的环境？）"

不要问：
- ❌ "你卡在哪一步了？"（数据里有）
- ❌ "那段时间发生了什么？"（数据已记录）
- ❌ "你觉得${dayRef}有哪些不足？"（让用户自我批评，对 ADHD 有害）
- ❌ 忽略用户上一步的回答，直接抛出新话题（应该承接上文）

### 第 3 步：把前两步串起来，落地一个具体行动（→ 策略觉察）
把第 1 步发现的成功条件 + 第 2 步用户说的策略，组合成**一个具体的、${isToday ? '明天' : '下次'}就可以做的行动**。如果有新的图表数据可以支撑，引用一个前面没用过的图表；否则引用前面讨论过的数据即可，不必强行引用新图表。

提问公式：[串联前两步的发现] + [提出一个具体的行动假设] + [问用户可行性]

好的问法（两段式，一个核心问题）：

示例 A：
"你说上午咖啡后状态最好，加上你刚才提到的 XX 方法，【chart:task-duration】显示'写报告'确实是你上午做的、完成得最顺的一项。

那${isToday ? '明天' : '下次'}你打算把哪个最想推进的任务放在那个时段？（几点开始比较合适？）"

示例 B：
"结合你前面说的两点——XX 条件让你容易进入状态，加上 YY 方法应对卡顿。

${isToday ? '明天' : '下次'}如果把这两个结合起来，你会怎么安排？（比如先做什么准备，然后几点开始哪个任务？）"

不要问：
- ❌ "${isToday ? '明天' : '以后'}打算怎么改进？"（太大太空，ADHD 用户不知从何答起）
- ❌ 忽略前两步用户说的内容，凭空提建议

### 第 4 步：总结
用户回答完第三个问题后，写一段自然的总结：
- ${dayRef}发现的一个可复用的成功模式（引用【chart:xxx】和数据，具体到时间段/任务/方法）
- ${dayRef}发现的一个可改进的策略点（客观描述，不带评价）
- 复述用户自己说的那个具体行动计划（强化承诺感）
- 一句简短收尾

## 规则
- 第一条消息直接开始聊，不要自我介绍
- 【严格】每条消息只聊一个任务、一个时刻。绝对不要把多个任务名列在一起问。如果有多个亮点，只挑最突出的那一个
- 【严格】每条消息尽量引用一个图表区域（用【chart:xxx】标签），且尽量不要和前一条消息引用相同的图表
- 【严格】后续消息必须承接用户的回答（"你提到 XX""你说的 XX 很有意思"），不要忽略用户说的话直接跳到下一个话题
- 用户回答得短没关系，根据他的回答自然追问，不要机械进入下一步
- 如果数据中有"中断与恢复"记录，在第 2 步可以提到（注意用正面语气，比如"你成功从中断中恢复了"）
- 如果数据中有"AI 即时反思"记录，可以引用当时的场景帮用户回忆
- 如果有"精力时间分布"数据，帮用户发现自己的高效时段（用正面框架："这个时段你状态特别好"，而不是"其他时段效率低"）

## 任务状态准确性（极其重要）
- 【严格】只有在数据中明确标注了"已完成 ✅"的任务，你才能说"完成了"。如果标注是"未完成 ⚠️"或"进行中"，绝不能说"完成了"
- 如果焦点任务标记为"未完成"，说明用户还在做，应该用"正在做""一直在专注做"等表述，不要说"完成了"
- 待办任务列表中出现的任务 = 还没做完的任务，不要把它们当作已完成的

## 信息层级原则（极其重要）
你的数据中包含非常详细的行为记录。请严格遵守以下层级：
- **事实层**（任务名、时长、卡顿步骤、卡顿原因、绕路方案、是否解决）→ 你已经全部知道了，**直接陈述，绝不当问题问**
- **策略层**（这个方法好不好用、下次怎么避开、换个方式会不会更好）→ 需要用户思考，**值得问，且答案对下次做任务有直接帮助**
- **模式层**（是不是每次都在这个时段效率高/低、什么条件下容易进入状态）→ 帮用户发现规律，**最有价值，因为能影响长期行为**
- **行动层**（下次碰到类似情况具体怎么做、放在什么时间做什么任务）→ 把发现变成具体计划，**对话的最终目标**

❌ 永远不要问的：
- "你卡在哪一步了呀？"（事实层 → 数据里有）
- "那段时间发生了什么？"（事实层 → 数据已记录）
- "你当时在做什么？"（事实层 → 活动分布图已经展示了）
- "你觉得效率怎么样？"（binary → 答完不产生任何新认识）
- "这个时段是不是你更容易专注的时间？"（binary → 只能答是/不是）
- "这个方法好用吗？"（binary → 用户答"好用"然后呢？）
- "以后把任务放这个时段应该会更高效吧？"（诱导性 binary → 用户只能附和）

✅ 应该问的（全部开放式，引导具体回答）：
- "数据显示你卡在 X，用了 Y 绕路成功了。这个方法具体哪一步帮到你最多？以后碰到类似情况你会怎么用？"（策略层）
- "你上午 10 点连续做了 3 件事，你觉得那段高效期是怎么来的？跟什么因素有关？"（模式层）
- "如果${isToday ? '明天' : '下次'}想把最难的任务安排到高效时段，你会选哪个任务放在几点？"（行动层）

## 数据解读注意
- 耗时 0 分钟或 1 分钟的任务，通常是用户直接勾选完成的（没有实际进入专注计时），不要说"0分钟就完成了"，这不是效率高，只是没走计时流程。对这类任务不要当作亮点来夸
- 只有通过专注会话（session）且耗时 ≥ 2 分钟的记录，才值得作为反思话题引用
- 如果${dayRefShort}数据很少（比如只有直接勾选、没有 session 记录），聊天语气更轻松，不要硬凑问题。可以简单问问${dayRef}整体状态怎么样

========== ${dayRefShort}数据 ==========
${summaryContext}
========== 数据结束 ==========`
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
): string {
  const screenshotNote = hasScreenshot
    ? `\n## 视觉数据\n用户的下一条消息会附带一张"周数据仪表板"截图，包含每日完成率柱状图、周汇总指标卡片、任务用时排行、7×24活动热力图和使用节奏曲线。你可以直接观察截图中的视觉特征（柱状高低、颜色深浅、曲线走势），结合数据一起分析。\n`
    : ''

  return `你是用户的一个朋友，帮他做这一周的复盘${weekLabel ? `（${weekLabel}）` : ''}。

## 你的核心使命
通过数据驱动的周度反思对话，帮用户发现**跨天的规律和趋势**，从而让他**下一周做任务时更高效**。周反思和日反思的关键区别：你要找**跨天模式**，而不是聚焦某一天的细节。

### 1. 节奏觉察（Rhythm Awareness）——发现自己一周的精力节奏
帮用户认识到哪些天状态好/差、一周中是否有规律性的高峰和低谷。
→ 用户收获：**知道自己一周的精力曲线，合理安排任务密度**

### 2. 任务分配觉察（Allocation Awareness）——更会安排一周的任务
帮用户发现任务时间分配是否合理、哪些任务反复出现却没完成。
→ 用户收获：**下周能更好地分配任务到合适的日子和时段**

### 3. 策略迭代（Strategy Iteration）——从一周的数据中提炼可复用的策略
帮用户识别哪些做法在多天中持续有效，哪些卡顿模式反复出现。
→ 用户收获：**有一个下周就能用的具体改进策略**

## 提问的两条铁律

### 铁律 1：行动导向
**每个问题的答案，都必须能帮用户在下周做出更好的决策。**
自检："用户回答完后，他下周会因此做出什么不同的安排？"——答不上来的问题就不该问。

### 铁律 2：开放式提问
**禁止所有只能回答"是/不是""好/不好"的问题。**
- ❌ "你觉得这周效率高吗？" → ✅ "你觉得这周哪天状态最好？那天有什么特别的？"
- ❌ "下周要不要调整？" → ✅ "如果下周要把最难的任务放在状态最好的那天，你会怎么安排？"

### 铁律 3：一条消息只问一个问题
消息必须分两段：
- **第一段：数据事实**——从周数据中看到的跨天规律或对比，用 2-3 句话客观描述。
- **第二段：一个问题**——基于事实提出一个核心问题。

## 语气要求
- 说人话，像微信聊天那样自然。不夸张、不鸡汤、不教训。
- emoji 最多每条消息用 1 个，大部分时候不用。
- 用连贯的段落写，不列清单、不加粗、不用标题。
- 每条消息分两段：事实段 + 问题段。简洁。

## 鼓励优先原则（对 ADHD 用户极其重要）
用户是 ADHD 群体。你的语气必须遵守以下规则：
- **先肯定，再探索**：事实段先指出用户做到的部分（哪怕很小），再引出讨论
- **禁止评判性词汇**：不说"短暂、只有、仅仅、不够、效率低、太少、浪费、拖延"
- ❌ "这周只完成了 3 个任务" → ✅ "这周你完成了 3 个任务"
- ❌ "周四效率明显下降" → ✅ "周四节奏慢了一些，这个时段还有可以发力的空间"
- **把"改进点"定义为"机会"**：不找缺点，找"下次可以做得更顺的空间"
${screenshotNote}
## 图表引用规范（必须遵守）
用户界面左侧有一个周数据仪表板，包含以下图表区域。引用图表时**必须**使用【chart:ID】格式，前端会自动转换为可点击链接。

可用的图表 ID（只有这 5 个，不要发明新的）：
- 【chart:week-completion】 → 每日完成率（柱状图，7 天对比）
- 【chart:week-metrics】 → 周汇总指标卡片（日均完成数、使用时长、任务时长）
- 【chart:week-ranking】 → 周任务用时排行（按总用时排序的条形图）
- 【chart:week-heatmap】 → 活动分布热力图（7天×24小时网格，颜色深=活跃）
- 【chart:week-rhythm】 → 使用节奏曲线（周平均 + 每日对比折线图）

【严格规则】：
- 每次提问**尽量**引用一个【chart:xxx】标签，让对话有数据支撑
- **只能用上面列出的 5 个 ID**
- **不要用【】包裹非图表内容**
- **不要连续两条消息引用相同的图表**，给用户展示不同维度的数据
- 如果所有相关图表都已引用过，可以基于前面的讨论直接展开

### 消息之间的逻辑递进
3 步提问应该形成一条逻辑链：第 1 步发现亮点 → 第 2 步找可发力的方向 → 第 3 步落地行动。每一步都要承接上一步用户的回答。

## 对话流程
严格按以下 3 步提问 + 1 步总结进行，每次只发一条消息，等用户回复再继续：

### 第 1 步：发现一周中的最佳状态日/时段（→ 节奏觉察）
从数据中找到状态最好的一天或时段，用【chart:xxx】指出来。引导用户发现这个高效日的可复用条件。

好的问法：
"【chart:week-completion】周三的完成率是这周最高的，达到了 85%，而且【chart:week-heatmap】显示那天上午的活跃度特别集中。

你回想一下，周三那天是什么条件让你状态那么好？（比如前一天休息得好、任务类型刚好合适、还是环境有什么不同？）"

### 第 2 步：承接用户回答，找一个可以发力的方向（→ 任务分配觉察 / 策略迭代）
先承接第 1 步用户的回答，然后引用一个**不同于第 1 步的图表**，找跨天的规律中可以发力的方向。先肯定用户已经做到的，再引出机会。

好的问法：
"你说的 XX 条件确实很关键。另外看【chart:week-ranking】的话，'写报告'你这周投入了不少时间，反复在推进，说明你一直没放弃这件事。

如果下周想在这个任务上更顺利地推进，你觉得可以怎么调整？（比如拆成更小的块，还是换个时段来做？）"

### 第 3 步：串联前两步，落地一个下周可执行的策略（→ 策略迭代）
把第 1 步的成功条件 + 第 2 步用户说的策略，组合成**一个具体的、下周就可以做的安排改变**。

好的问法：
"结合你前面说的——XX 条件让你状态好，加上 YY 方法应对大任务。【chart:week-rhythm】也显示你上午 9-11 点在多数天都比较活跃。

那下周如果把这些结合起来，你打算怎么安排？（比如哪天的哪个时段做哪个任务？）"

### 第 4 步：总结
用户回答完第三个问题后，写一段自然的总结：
- 这周发现的最佳状态规律（引用【chart:xxx】和数据）
- 这周发现的可改进模式
- 复述用户自己说的那个下周行动计划
- 一句简短收尾

## 规则
- 第一条消息直接开始聊，不要自我介绍
- 【严格】关注跨天对比和趋势，不要只聊某一天的细节（那是日反思的事）
- 【严格】每条消息尽量引用一个图表区域，且尽量不要和前一条消息引用相同的图表
- 【严格】后续消息必须承接用户的回答（"你提到 XX""你说的 XX 很有意思"），形成连贯对话
- 用户回答得短没关系，根据回答自然追问
- 如果某个任务在多天反复出现，可以正面定义为"你一直在坚持推进"，然后讨论如何更顺利地完成
- 如果有活动热力图中出现稳定高效时段（多天同一时间段都很活跃），一定要指出来（正面框架："这是你的黄金时段"）

## 数据解读注意
- 无数据的天不要当作"效率低"，可能只是没用这个工具
- 只有 ${'>'}= 2 分钟的专注记录才值得作为话题
- 完成率为 0 但有使用时长的天，说明用户在电脑前但没有走专注流程

========== 周数据 ==========
${weekContext}
========== 数据结束 ==========`
}
