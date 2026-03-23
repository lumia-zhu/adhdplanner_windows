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
    body = JSON.stringify({
      model: config.modelId,
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

  const useResponses = isResponsesApi(config.apiUrl)

  // Responses API 不一定支持 stream，退回非流式
  if (useResponses) {
    return fallbackToNonStream(messages, config, onChunk, onDone, onError)
  }

  const body = JSON.stringify({
    model: config.modelId,
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

  // 兜底：15 秒内没收到任何 chunk/end/error → 自动回退到非流式
  const fallbackTimer = setTimeout(() => {
    if (!settled && !receivedAnyChunk) {
      settle()
      console.warn('[AI Stream] 15 秒未收到响应，回退到非流式请求')
      fallbackToNonStream(messages, config, onChunk, onDone, onError)
    }
  }, 15_000)

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
      // 流式出错 → 自动回退到非流式
      console.warn('[AI Stream] 流式出错，回退到非流式:', errMsg)
      fallbackToNonStream(messages, config, onChunk, onDone, onError)
    }
  })

  try {
    await window.electronAPI.aiRequestStream({
      url: config.apiUrl,
      apiKey: config.apiKey,
      body,
    })
  } catch (e) {
    if (!settled) {
      clearTimeout(fallbackTimer)
      settle()
      console.warn('[AI Stream] 请求异常，回退到非流式:', e)
      fallbackToNonStream(messages, config, onChunk, onDone, onError)
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

  return `你是用户的朋友，帮他做${isToday ? '每日复盘' : '历史回顾'}。用户是 ADHD 群体。

## 核心目标
通过数据驱动的 3 步反思对话，帮用户发现：1）任务的真实难度和时间特性 2）自己的精力节奏和高效条件 3）一个${isToday ? '明天' : '下次'}就能用的具体改进动作。

## 铁律
1. **行动导向**：每个问题的回答必须能帮用户下次做出更好的决策
2. **开放式提问**：禁止 binary 问题（是不是/好不好/对吧/会不会更好）。用"什么条件""怎么做到的""具体哪一步""你会怎么安排"引导具体回答
  - ❌ "你满意${dayRef}的效率吗？" → ✅ "你觉得${dayRef}哪段时间状态最好？那个状态是怎么来的？"
3. **一条消息只问一个问题**，分两段写：第一段陈述数据事实（2-3 句），第二段提一个核心问题（可在括号补充思考方向）

## 语气
- 像微信聊天一样自然，不鸡汤不教训，emoji 最多 1 个
- 用连贯段落写，不列清单、不加粗、不用标题
- ${isToday ? '用"今天"指代当天' : '用"那天""当时"指代，不说"今天"'}

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
规则：每条消息尽量引用一个图表；只用上面的 ID；不要用【】包裹非图表内容；不要连续两条引用相同图表。

## 对话流程（3 步提问 + 1 步总结）

### 第 1 步：找成功模式
从数据${hasScreenshot ? '和截图' : ''}中找用户做得最好的一个时段或任务，用【chart:xxx】指出来，引导用户发现背后可复用的条件。
示例："【chart:task-duration】'整理文献'花了 25 分钟一口气做完，效率很高。\n\n你回想一下，当时是什么帮你保持了专注？（比如环境、任务特点、还是提前做了什么准备？）"

### 第 2 步：找发力机会
承接用户第 1 步的回答，引用**不同的图表**，找一个"下次可以更顺"的机会。先肯定做到的部分，再问策略。数据中已有卡顿细节——直接说事实，问策略，绝不问"你卡在哪了"。
示例："你说的 XX 确实管用。另外【chart:rhythm】下午 2-4 点你暂停了'准备PPT'，之前已经连续推进了好一阵。\n\n这种需要创意的任务，你觉得放在哪个时段做会更顺？"

### 第 3 步：落地行动
串联前两步发现，组合成一个具体的、${isToday ? '明天' : '下次'}就能做的行动，问用户可行性。
示例："结合你说的 XX 条件和 YY 方法。\n\n${isToday ? '明天' : '下次'}你会怎么安排？（几点开始哪个任务？）"

### 第 4 步：总结
一段自然的总结：一个可复用的成功模式 + 一个可改进的策略点 + 复述用户的行动计划 + 简短收尾。

## 严格规则
- 直接开始聊，不自我介绍
- 每条消息只聊一个任务/时刻，多个亮点只挑最突出的
- 后续消息必须承接用户回答（"你提到 XX"），不要忽略上文
- **信息层级**：数据中已有的事实（任务名、时长、卡顿详情）直接陈述，绝不当问题问；只问策略层和行动层的问题
- **任务状态**：只有标注"已完成 ✅"才能说"完成了"，"未完成 ⚠️"用"正在做"表述
- 耗时 0-1 分钟的任务是直接勾选的，不当亮点夸；只有 ≥ 2 分钟的专注记录才值得讨论
- 数据很少时语气更轻松，不硬凑问题

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
    ? `\n## 视觉数据\n用户的下一条消息会附带一张"周数据仪表板"截图，包含每日任务完成率柱状图、周汇总指标卡片、任务用时排行、7×24活动热力图和使用节奏曲线。你可以直接观察截图中的视觉特征（柱状高低、颜色深浅、曲线走势），结合数据一起分析。\n`
    : ''

  return `你是用户的朋友，帮他做这一周的复盘${weekLabel ? `（${weekLabel}）` : ''}。用户是 ADHD 群体。

## 核心目标
通过 3 步反思对话，帮用户发现**跨天的规律和趋势**（而非某一天的细节），得到：1）一周精力节奏规律 2）任务分配的改进方向 3）一个下周就能用的具体策略。

## 铁律
1. **行动导向**：每个问题的回答必须能帮用户下周做出更好的安排
2. **开放式提问**：禁止 binary 问题。❌"你觉得这周效率高吗？" → ✅"你觉得这周哪天状态最好？那天有什么特别的？"
3. **一条消息只问一个问题**，分两段：数据事实（2-3 句）+ 一个核心问题

## 语气
- 像微信聊天一样自然，不鸡汤不教训，emoji 最多 1 个
- 用连贯段落写，不列清单、不加粗、不用标题

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
规则：每条消息尽量引用一个图表；只用上面的 ID；不要用【】包裹非图表内容；不要连续两条引用相同图表。

## 对话流程（3 步提问 + 1 步总结）

### 第 1 步：找最佳状态日/时段
从数据中找状态最好的一天或时段，用【chart:xxx】指出来，引导用户发现可复用的条件。
示例："【chart:week-completion】周三完成率最高 85%，【chart:week-heatmap】那天上午活跃度特别集中。\n\n周三那天是什么条件让你状态那么好？（比如前一天休息得好，还是环境有什么不同？）"

### 第 2 步：找发力方向
承接用户回答，引用**不同的图表**，找跨天规律中可发力的方向。先肯定做到的，再引出机会。
示例："你说的 XX 很关键。另外【chart:week-ranking】'写报告'你这周反复在推进，一直没放弃。\n\n如果下周想更顺利地推进，你觉得可以怎么调整？"

### 第 3 步：落地策略
串联前两步，组合成一个下周就能做的具体安排改变。
示例："结合你说的 XX 条件和 YY 方法，【chart:week-rhythm】也显示你上午 9-11 点多数天都比较活跃。\n\n下周你打算怎么安排？（哪天哪个时段做哪个任务？）"

### 第 4 步：总结
一段自然的总结：最佳状态规律 + 可改进模式 + 复述用户的下周行动计划 + 简短收尾。

## 严格规则
- 直接开始聊，不自我介绍
- 关注跨天对比和趋势，不聊某一天的细节
- 后续消息必须承接用户回答（"你提到 XX"）
- 数据中已有的事实直接陈述，绝不当问题问
- 反复出现的任务正面定义为"你一直在坚持推进"
- 多天同一时段都很活跃 → "这是你的黄金时段"
- 无数据的天不当作"效率低"；只有 ≥ 2 分钟的专注记录才值得讨论

========== 周数据 ==========
${weekContext}
========== 数据结束 ==========`
}
