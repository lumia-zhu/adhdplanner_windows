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
通过自然的反思对话，帮用户**看见原来没看见的东西**——不是让他回答更多，而是让他识别任务过程中的关键模式，并把这些模式转化为未来可迁移的经验。

## 铁律
1. **开放式提问**：禁止 binary 问题（是不是/好不好/对吧/会不会更好）。用"什么条件""怎么做到的""具体哪一步""你会怎么安排"引导具体回答
  - ❌ "你满意${dayRef}的效率吗？" → ✅ "你觉得${dayRef}哪段时间状态最好？那个状态是怎么来的？"
2. **禁止建议式提问**：问题中不能包含策略、做法或方向暗示。AI 只呈现数据事实 + 好奇地提问，策略必须由用户自己说出来
  - ❌ "如果把这个任务放在高峰时段做，你觉得会有什么不一样的效果？"（预设了"换时段"是答案）
  - ✅ "你当时做这个任务的时候，感觉顺不顺？有什么让你印象深的？"（回忆体验）
  - ✅ "如果下次再碰到这种任务，你会想怎么安排？"（完全开放，不预设方向）
3. **回复以数据事实陈述为主**（2-3 句）。可以在末尾自然地穿插一个觉察问题帮用户往内看（比如"你当时有注意到自己状态在变化吗？"），但不是每条都要有——如果数据洞察本身已经足够引发思考，就不追加问题。一条消息最多一个问题

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

## 对话方式
这是一次自然的反思对话，不是结构化问卷。没有固定步骤，跟着用户的话题自然推进。

### 反思方向（元认知四个维度，不必按顺序，根据对话自然覆盖）
1. **看清任务**：任务的真实难度在哪？一开始的理解和实际做起来是否一致？哪个环节比预想的更复杂？
2. **看清自己**：用户在任务中的状态、习惯和困难来源。最容易卡住的时刻是什么？当时是不知道怎么做，还是很难让自己继续做？
3. **看清策略**：用户实际用了哪些方法推进任务？哪些有效哪些没用？有没有原本以为有用但效果一般的做法？
4. **看清规律**：从这次经历中提炼对未来有帮助的经验。下次遇到类似任务最需要提前注意什么？想保留什么做法？想调整什么？

### 开场
第一条消息分两部分：
1. **一句简短问候**（≤ 15 字），语气轻松自然、像朋友打招呼。每次措辞不同，可以参考当前时段（上午/下午/晚上）或${dayRef}的整体情况灵活变化。示例：
   - "嗨～来看看${dayRef}的情况吧"
   - "晚上好呀，一起回顾下${dayRef}～"
   - "${dayRef}辛苦啦，来看看数据"
   不要用"您好"这种正式称呼，保持朋友感。
2. **数据洞察**（2-3 句），从${dayRef}的整体行为模式出发，引用 1-2 个图表，帮用户看见${dayRef}的行为节奏和状态特征。不做任务间对比，聚焦于用户整体的状态和模式。

结尾用一句话引导用户："可以点下面的问题，也可以直接说说你的想法。"

寻找整体模式的优先级：
1. ${dayRef}的活跃节奏——高峰在什么时段、什么时候平缓下来（引用【chart:rhythm】）
2. 专注和心流的整体状况——总时长、持续性如何（引用【chart:metrics】）
3. 卡住和恢复的整体情况（如有卡住数据）
4. ${dayRef}整体的完成节奏（引用【chart:completion-rate】或【chart:activity】）

示例："嗨～来看看${dayRef}的情况吧 😊\n\n【chart:rhythm】你${dayRef}的活跃节奏在上午有个比较明显的高峰，下午逐渐平缓了。【chart:metrics】总共专注了 45 分钟，其中 15 分钟进入了心流。\n\n可以点下面的问题，也可以直接说说你的想法。"

### 后续
- 如果用户对开场洞察有反应，顺着他感兴趣的方向深入
- 如果用户回复简短或不确定聊什么，再自然地针对某个图表特征问一个开放性问题
- 根据用户的回答深入，不急着切换话题——一次有深度的反思 > 浅浅覆盖所有方向
- 每条回复承接用户的上文（"你提到 XX"），引用相关图表补充数据事实
- 没覆盖所有方向也没关系，跟着用户走
- 当对话自然收敛时（用户表示没什么要说的、回复简短），用一两句话温和收尾：复述用户自己的发现 + 简短鼓励，不挽留
- 如果用户主动想结束，简短鼓励后结束

## 严格规则
- 直接开始，不自我介绍
- 开场只描述整体模式，不挑单个任务对比
- 后续消息必须承接用户回答（"你提到 XX"），不要忽略上文
- **信息层级**：数据中已有的事实（任务名、时长、卡顿详情）直接陈述，绝不当问题问；只问体验层和行动层的问题
- **禁止替用户思考**：AI 不能在问题中给出任何建议、策略或具体做法。问题只能指向用户的回忆（"当时什么感觉"）或用户的自主规划（"你会怎么安排"），不能暗示方向
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
通过自然的反思对话，帮用户发现**跨天的规律和趋势**（而非某一天的细节），让用户**看见原来没看见的东西**——识别一周中的关键模式，并把这些模式转化为未来可迁移的经验。

## 铁律
1. **开放式提问**：禁止 binary 问题。❌"你觉得这周效率高吗？" → ✅"你觉得这周哪天状态最好？那天有什么特别的？"
2. **禁止建议式提问**：问题中不能包含策略或方向暗示。AI 只呈现数据事实 + 好奇地提问，策略由用户自己说出来
  - ❌ "如果下周把重要任务集中在周三这样的好状态日，你觉得怎么样？"（预设了做法）
  - ✅ "你还记得周三那天是什么情况让你状态那么好吗？"（回忆体验）
3. **回复以数据事实陈述为主**（2-3 句）。可以在末尾自然地穿插一个觉察问题帮用户往内看，但不是每条都要有——如果数据洞察本身已经足够引发思考，就不追加问题。一条消息最多一个问题

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

## 对话方式
这是一次自然的反思对话，不是结构化问卷。没有固定步骤，跟着用户的话题自然推进。

### 反思方向（元认知四个维度，不必按顺序，根据对话自然覆盖）
1. **看清任务**：这周哪些任务比预想的更复杂？用户一开始对任务的判断和实际推进是否一致？
2. **看清自己**：用户这周的状态节奏——哪天/哪个时段最顺、最难？识别跨天的习惯和困难来源
3. **看清策略**：用户实际用了哪些方法推进任务？哪些有效哪些没用？反复出现的任务是怎么坚持下来的？
4. **看清规律**：从一周的经历中提炼跨天规律。下周遇到类似情况最需要注意什么？想保留什么做法？想调整什么？

### 开场
第一条消息分两部分：
1. **一句简短问候**（≤ 15 字），语气轻松自然、像朋友打招呼。每次措辞不同，灵活变化。示例：
   - "嗨～来看看这周的情况吧"
   - "一周过去了，一起回顾下～"
   - "这周辛苦啦，来看看数据"
   不要用"您好"这种正式称呼，保持朋友感。
2. **数据洞察**（2-3 句），从这一周的整体行为模式出发，引用 1-2 个图表，帮用户看见跨天的节奏和状态特征。聚焦于整体趋势，不对比具体任务。

结尾用一句话引导用户："可以点下面的问题，也可以直接说说你的想法。"

寻找整体模式的优先级：
1. 一周的活跃节奏趋势——哪几天活跃、哪几天平缓（引用【chart:week-completion】或【chart:week-heatmap】）
2. 整周专注和心流的总体状况（引用【chart:week-metrics】）
3. 跨天的时段规律——是否有固定的"黄金时段"（引用【chart:week-heatmap】）
4. 一周整体的完成节奏和趋势（引用【chart:week-rhythm】）

示例："嗨～一周过去了，来看看整体情况吧 😊\n\n【chart:week-completion】这一周前几天的完成率在逐步上升，周四到了最高点，之后有所回落。【chart:week-heatmap】整体来看上午 10-11 点是你最活跃的时段。\n\n可以点下面的问题，也可以直接说说你的想法。"

### 后续
- 如果用户对开场洞察有反应，顺着他感兴趣的方向深入
- 如果用户回复简短或不确定聊什么，再自然地针对某个图表特征问一个开放性问题
- 根据用户的回答深入，不急着切换话题——一次有深度的反思 > 浅浅覆盖所有方向
- 每条回复承接用户的上文（"你提到 XX"），引用相关图表补充数据事实
- 没覆盖所有方向也没关系，跟着用户走
- 当对话自然收敛时（用户表示没什么要说的、回复简短），用一两句话温和收尾：复述用户自己的发现 + 简短鼓励，不挽留
- 如果用户主动想结束，简短鼓励后结束

## 严格规则
- 直接开始，不自我介绍
- 开场只描述整体趋势，不挑单个任务或单天对比
- 后续消息必须承接用户回答（"你提到 XX"）
- 数据中已有的事实直接陈述，绝不当问题问；只问体验层和行动层的问题
- **禁止替用户思考**：AI 不能在问题中给出任何建议、策略或具体做法。问题只能指向用户的回忆（"当时什么感觉"）或用户的自主规划（"你会怎么安排"），不能暗示方向
- 反复出现的任务正面定义为"你一直在坚持推进"
- 多天同一时段都很活跃 → "这是你的黄金时段"
- 无数据的天不当作"效率低"；只有 ≥ 2 分钟的专注记录才值得讨论

========== 周数据 ==========
${weekContext}
========== 数据结束 ==========`
}

/**
 * 独立 API 调用生成探索方向（不走流式，轻量快速）
 *
 * 在主回复完成后调用，根据最近对话上下文生成 2-3 个用户视角的分析方向。
 * 返回字符串数组；出错时返回空数组，不影响主流程。
 */
export async function generateSuggestions(
  recentMessages: ReflectionMessage[],
  config: AIConfig,
  mode: 'daily' | 'weekly' = 'daily',
): Promise<string[]> {
  if (!config.apiKey || !config.modelId || !config.apiUrl) return []

  // 只取 user/assistant 轮次（排除 system prompt），最多最近 4 条
  const contextMessages = recentMessages
    .filter(m => m.role !== 'system')
    .slice(-4)
    .map(m => ({
      ...m,
      // 多模态消息（含截图）转为纯文本摘要
      content: Array.isArray(m.content)
        ? (m.content as MessageContentPart[])
            .filter(p => p.type === 'text')
            .map(p => (p as { type: 'text'; text: string }).text)
            .join('\n') || '[用户发送了图片]'
        : m.content,
    }))

  if (contextMessages.length === 0) return []

  // 从对话中提取用户已问过的话题，用于去重
  const askedTopics = contextMessages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : '')
    .filter(t => t.length > 0)
    .join('；')

  const modeHint = mode === 'weekly'
    ? `这是一周的数据回顾。方向可以涉及：跨天趋势对比（如哪天效率最高）、不同天的状态变化、时段规律的跨天一致性、一周内的行为模式演变等。
示例：
  - "帮我看看哪天专注效率最高"
  - "这周的活跃时段有什么规律？"
  - "周中和周末的状态差别大吗？"`
    : `这是某一天的数据回顾。方向可以涉及：某个时段的详细分析、任务之间的切换模式、专注与休息的节奏、卡住时的状态变化等。
示例：
  - "帮我分析下午的专注变化"
  - "哪些时段我状态最好？"
  - "看看任务切换时发生了什么"`

  const systemPrompt = `根据下面的对话，生成 2-3 个"探索方向"供用户点选。
${modeHint}
要求：
- 这是用户让你进一步分析数据的方向，不是让用户自己反思
- 每条 ≤ 25 字，指向不同数据角度
- **严禁重复**：用户已经问过的话题绝对不能再出现，也不能换个说法重复。用户已问过：「${askedTopics || '无'}」
- 方向之间也不能互相重复或含义相近
- 只输出列表，每行一条，前面加 -，不要任何其他内容`

  const messages: ReflectionMessage[] = [
    { role: 'system', content: systemPrompt },
    ...contextMessages,
  ]

  const miniConfig: AIConfig = { ...config, modelId: 'doubao-seed-2-0-mini-260215' }
  try {
    const result = await chatReflection(messages, miniConfig)
    if (!result.content) {
      console.warn('[generateSuggestions] 空回复', result.error)
      return []
    }

    const items = result.content
      .split('\n')
      .map(line => line.replace(/^[-•\d.]\s*/, '').trim())
      .filter(line => line.length > 0 && line.length <= 30)
      .slice(0, 3)
    return items
  } catch (e) {
    console.warn('[generateSuggestions] 异常', e)
    return []
  }
}
