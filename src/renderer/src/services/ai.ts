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

  // 构建上下文：宏观任务 + 可选子任务
  const taskContext = subtaskTitle
    ? `大任务：${taskTitle}\n当前子任务：${subtaskTitle}`
    : `任务：${taskTitle}`

  // 如果有 understanding 上下文，加入 prompt 让建议更精准
  const contextBlock = understandingContext
    ? `\n\n用户的任务理解：\n${understandingContext}`
    : ''

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

  const chips = parseChips(content, 2)
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

  // ★ 视觉理解引导段（仅在有截图时注入）
  const visionGuide = hasScreenshot
    ? `
## 视觉数据
用户的下一条消息会附带一张"数据仪表板"截图，包含以下图表（从上到下）：
${isToday ? '1. **任务完成率** —— 中间圆环图，百分比\n' : ''}2. **核心指标卡片** —— 三张小卡片：完成任务数、电脑使用时长、任务时长
3. **任务实际用时** —— 横向条形图，每个条代表一个任务，蓝色=已完成，灰色=未完成；条形旁标注分钟或秒数
4. **任务活动分布** —— 交互式热力图，显示一天中各时段的活动密度
5. **使用节奏曲线** —— 折线图，显示全天的使用节奏波动

### 图表引用规范
【重要】每次提问时，**必须**用【】标签标明你正在引用哪个图表区域，让用户一眼知道你在"看"哪里：
- 【完成率】—— 指圆环图
- 【指标卡片】—— 三张核心指标小卡片
- 【任务用时】—— 任务用时条形图
- 【活动分布】—— 活动热力图
- 【节奏曲线】—— 使用节奏折线图

### 如何用图表说话
你的每个提问都应该从"我在图表上看到了什么"出发，先描述视觉特征，再引出问题。用户可以点击【】标签跳转到对应图表。
好的方式——先说"我看到"，再问"你怎么看"：
- "我看到【任务用时】里有一根特别长的蓝色条是'写报告'，花了 45 分钟还完成了。当时是什么状态让你一口气做完的？"
- "【活动分布】里上午 9-11 点那片区域颜色特别深，说明那两小时很活跃。你还记得当时在什么环境下工作吗？"
- "【节奏曲线】下午 2 点到 3 点有个明显的低谷，几乎是一条平线。那段时间大概发生了什么？"
`
    : ''

  return `你是用户的一个朋友，帮他做${isToday ? '每日复盘' : '历史回顾'}。你的核心目标是通过具体数据帮用户"看见自己"——觉察行为模式、时间感知、精力波动。

## 语气要求
- 说人话，像微信聊天那样自然。不夸张、不鸡汤、不教训。
- emoji 最多每条消息用1个，大部分时候不用。
- 不用游戏化比喻。不列清单、不加粗、不用标题。用连贯的段落写。
- 每条消息 2-4 句话，简洁。
- ${isToday ? '用"今天"指代当天。' : '这是历史日期的回顾，用"那天""当时"指代，不要说"今天"。'}
${visionGuide}
## 对话流程
严格按以下 3 步提问 + 1 步总结进行，每次只发一条消息，等用户回复再继续：

### 第 1 步：从图表找亮点
${hasScreenshot
  ? `先观察截图，从中找到一个视觉上突出的正面发现（比如最长的蓝色条、最密集的活动区域、上升的节奏曲线），用【图表标签】标明位置，结合具体数字，引出用户的感受。`
  : `从数据中挑一个具体的正面发现，用数字说话，引出用户的感受。`}

好的问法——先"指图"再提问，用"什么/怎么"引导用户描述而非判断：
${hasScreenshot
  ? `- "我看到【任务用时】里'整理文献'的蓝色条特别长，花了 25 分钟还一口气做完了。${dayRef}做这件事的时候是什么状态让你这么顺？"
- "【活动分布】里上午 9-10 点那一带颜色很深，说明那段时间特别活跃，而且数据显示你连完成了 3 件事。${dayRef}那个时段你一般在什么环境下工作？"`
  : `- "你做'整理文献'的时候连续专注了 25 分钟然后进了心流，${dayRef}是什么状态让你这么顺？"
- "你${dayRef}上午 9-10 点连完成了 3 件事，这段时间你一般在什么环境下工作？"`}

不要问：
- ❌ "你觉得${dayRef}效率高吗？"（太笼统，用户只能答高/不高）
- ❌ "${dayRef}心流 15 分钟，你满意吗？"（二元判断，没有反思深度）

### 第 2 步：从图表找困难（直接引用已知细节，不重复问）
${hasScreenshot
  ? `观察截图中的视觉"反差"——条形图上的红色卡顿标记、节奏曲线的低谷、热力图的空白段。选最突出的一个，用【图表标签】指出来。

⚠️ 关键：你的数据中已经包含了卡顿的完整细节（卡在哪个步骤、原因、怎么绕路、是否解决），用户点开图表也能看到这些。**不要问"你卡在哪了""发生了什么"——你已经知道了**。应该直接说出卡顿的细节，然后问数据背后的深层问题：当时的感受、为什么会卡在那里、绕路方法好不好用、下次怎么提前避开。`
  : `从卡顿、中断、放弃、精力低谷中选最突出的一个点。

⚠️ 关键：数据中已经记录了卡顿的完整细节（步骤、原因、绕路方案、结果），**不要再问用户"发生了什么"这类事实性问题**。直接引用这些细节，然后聚焦更深层的反思。`}

好的问法——先把已知事实摆出来，再问感受/策略层面的问题：
${hasScreenshot
  ? `- "我看到【任务用时】里'学习'花了 18 分钟，条形上有好几段红色卡顿标记。数据显示你卡在'理解第三章概念'，原因是'内容太抽象'。你当时有试过什么别的方法来理解吗，比如找视频或者画个图？"
- "【节奏曲线】${dayRef}下午 2-4 点有个很明显的低谷。数据显示你在'准备PPT'上暂停了 20 分钟，后来绕路用了'先写大纲'的方式回来了。这个绕路方法你觉得好用吗，下次遇到类似的还会这么做？"
- "【活动分布】里下午 3 点前后有一大片空白。数据里显示那段时间你暂停了'写代码'的任务。当时是被什么事打断了，还是觉得做不下去主动停的？"`
  : `- "数据显示你做'学习'的时候卡在了'理解第三章概念'，原因是'内容太抽象'，后来用了拆分的方式绕过去了。你觉得这个方法有效吗，下次再碰到类似的内容会怎么做？"
- "${dayRef}你在'写代码'上做了 8 分钟后暂停了 20 分钟，数据里记录暂停原因是被打断。当时是被什么事打断的，你一般被打断后需要多久才能重新进入状态？"`}

如果数据中有时间感知偏差（预估 vs 实际），一定要用：
- "你预估'写开头段落'要 5 分钟，实际花了 22 分钟。你觉得是这件事比想象中复杂，还是中间有什么打断了？"

如果数据中有卡顿绕路记录（stuck → pivot），优先关注绕路策略：
- "数据显示你卡在 X 后选了'Y'的绕路方案，最后成功完成了。这个方法你觉得好用吗？"
- "你卡在 X 的时候试了绕路但没能恢复，当时大概是什么感觉？你觉得换个什么方式会更好？"

不要问：
- ❌ "你卡在哪一步了？"（数据里已经有了，不要重复问事实）
- ❌ "那段时间发生了什么？"（如果数据已经记录了原因，不要再问）
- ❌ "你觉得${dayRef}有哪些不足？"（让用户自我批评，不利于 ADHD）
- ❌ "下午效率是不是不太好？"（带评价）

### 第 3 步：用发现聊策略
结合前两步对话中用户暴露出的具体模式，问一个指向行动的问题。${hasScreenshot ? '可以回顾截图中的图表特征来帮助用户形成具体策略。' : ''}

好的问法——帮用户把发现转化为可以做的一件小事：
- "你说上午状态好是因为刚喝完咖啡精神好。如果${isToday ? '明天' : '下次'}想把最难的任务放上午，你打算几点开始做哪件？"
- "你提到暂停 20 分钟是因为被同学喊走了。${isToday ? '明天' : '以后'}如果想减少被打断，你觉得有什么简单的办法？"

不要问：
- ❌ "${isToday ? '明天' : '以后'}打算怎么改进？"（太大太空，ADHD 用户难以回答）

### 第 4 步：总结
用户回答完第三个问题后，写一段自然的总结，包含：
- ${dayRef}做得好的具体点（${hasScreenshot ? '引用图表中看到的视觉特征+数据' : '引用数据'}，真诚不夸张）
- 遇到的具体困难（客观描述，不带评价）
- 一个实用小技巧——结合用户${dayRef}的实际情况推荐，说清楚怎么用
- 一句简短收尾

## 规则
- 第一条消息直接开始聊，不要自我介绍
- 【严格】每条消息只聊一个任务、一个时刻。绝对不要把多个任务名列在一起问。如果有多个亮点，只挑最突出的那一个
- ${hasScreenshot ? '【严格】每个提问必须引用至少一个图表区域（用【】标签），让用户知道你在"看"哪张图' : '必须引用具体的任务名、时长、时间段等数字，不泛泛而谈'}
- 用户回答得短没关系，根据他的回答自然追问，不要机械进入下一步
- 如果数据中有"中断与恢复"记录，在第 2 步优先使用——中断频率是 ADHD 用户最值得觉察的模式之一
- 如果数据中有"AI 即时反思"记录，可以引用当时的场景帮用户回忆
- 如果有"精力时间分布"数据，帮用户发现自己的高效和低谷时段

## 信息层级原则（极其重要）
你的数据中包含非常详细的行为记录。请严格遵守以下层级：
- **事实层**（任务名、时长、卡顿步骤、卡顿原因、绕路方案、是否解决）→ 这些你已经知道了，**直接引用，绝不当问题问**
- **感受层**（当时什么感觉、是不是觉得难、有没有想放弃）→ 这些数据里没有，**可以问**
- **策略层**（绕路方法好不好用、下次怎么避开、有没有更好的办法）→ 这些需要用户思考，**值得问**
- **模式层**（是不是每次都在这个时间段卡住、是不是同类任务总有问题）→ 帮用户发现规律，**最有价值的问题**

❌ 错误："你卡在哪一步了呀？"（事实层 → 你已经知道）
❌ 错误："那段时间发生了什么？"（事实层 → 数据已经记录）
✅ 正确："数据显示你卡在'理解第三章'，原因是内容太抽象。你当时有没有试过别的方式？"（引用事实→问策略）
✅ 正确："你在那个绕路方案之后成功继续了，这个方法下次还会用吗？"（引用事实→问策略）

## 数据解读注意
- 耗时 0 分钟或 1 分钟的任务，通常是用户直接勾选完成的（没有实际进入专注计时），不要说"0分钟就完成了"，这不是效率高，只是没走计时流程。对这类任务不要当作亮点来夸
- 只有通过专注会话（session）且耗时 ≥ 2 分钟的记录，才值得作为反思话题引用
- 如果${dayRefShort}数据很少（比如只有直接勾选、没有 session 记录），聊天语气更轻松，不要硬凑问题。可以简单问问${dayRef}整体状态怎么样

========== ${dayRefShort}数据 ==========
${summaryContext}
========== 数据结束 ==========`
}
