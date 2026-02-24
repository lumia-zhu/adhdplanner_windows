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
function buildChatBody(modelId: string, systemPrompt: string, userPrompt: string, maxTokens = 120): string {
  return JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: maxTokens,
  })
}

/** 构造 Responses API 格式的请求体 */
function buildResponsesBody(modelId: string, systemPrompt: string, userPrompt: string): string {
  return JSON.stringify({
    model: modelId,
    input: [
      { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
    ],
    temperature: 0.7,
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
): Promise<{ content: string; error?: string }> {
  if (!cfg.apiKey || !cfg.modelId || !cfg.apiUrl) {
    return { content: '', error: '未配置 AI' }
  }

  const useResponses = isResponsesApi(cfg.apiUrl)
  const body = useResponses
    ? buildResponsesBody(cfg.modelId, systemPrompt, userPrompt)
    : buildChatBody(cfg.modelId, systemPrompt, userPrompt, maxTokens)

  try {
    const res = await window.electronAPI.aiRequest({
      url: cfg.apiUrl,
      apiKey: cfg.apiKey,
      body,
    })

    if (!res.ok) {
      console.warn('[AI] HTTP', res.status, res.body)
      return { content: '', error: `接口错误 ${res.status}` }
    }

    const content = extractContent(res.body, useResponses)
    console.log('[AI] 返回内容:', content)
    return { content }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[AI] 请求失败:', msg)
    return { content: '', error: `请求异常：${msg.slice(0, 60)}` }
  }
}

// ===================== 核心函数 =====================

/**
 * 生成微动作建议
 * @param taskTitle   当前任务标题
 * @param lastStep    上一步完成的动作（可选，用于接力建议）
 * @param config      AI 配置
 * @returns           { chips: string[]; error?: string }
 */
/** 从文本中解析 JSON 数组 */
function parseChips(content: string, maxCount: number): string[] {
  const match = content.match(/\[[\s\S]*?\]/)
  if (match) {
    try {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) return arr.map(String).slice(0, maxCount)
    } catch { /* ignore */ }
  }
  return []
}

/**
 * 1. 生成微动作建议（开始任务 / 完成后接力）
 *
 * @param taskTitle     宏观任务标题
 * @param lastStep      上一步完成的动作（可选，用于接力建议）
 * @param config        AI 配置
 * @param subtaskTitle  当前子任务标题（可选，让建议更精准）
 */
export async function generateMicroActions(
  taskTitle: string,
  lastStep?: string,
  config?: AIConfig,
  subtaskTitle?: string,
): Promise<{ chips: string[]; error?: string }> {
  const cfg = config ?? DEFAULT_AI_CONFIG
  if (!cfg.apiKey || !cfg.modelId) return { chips: [] }

  const systemPrompt =
    '你是一个专注力辅助AI。用户给你一个任务名称，你需要生成2个极其具体的、可以立即执行的微小物理动作建议。' +
    '每个建议不超过10个字，用JSON数组格式返回，如 ["打开空白文档","找导师的纪要"]。只返回JSON数组，不要其他任何内容。'

  // 构建上下文：宏观任务 + 可选子任务
  const taskContext = subtaskTitle
    ? `大任务：${taskTitle}\n当前子任务：${subtaskTitle}`
    : `任务：${taskTitle}`

  const userPrompt = lastStep
    ? `${taskContext}\n上一步完成了：${lastStep}\n请给出紧接着的2个微动作建议。`
    : `${taskContext}\n请给出开始这个${subtaskTitle ? '子任务' : '任务'}时最先要做的2个微动作建议。`

  const { content, error } = await callLLM(systemPrompt, userPrompt, cfg)
  if (error) return { chips: [], error }

  const chips = parseChips(content, 2)
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
    '2. 然后给出2个"降低门槛"或"完全绕开"的平替微任务（每个不超过15字，括号里标预计时间）\n' +
    '用JSON格式返回，例如：\n' +
    '{"empathy":"在海量链接里捞针确实崩溃，别找了换条路。","pivots":["先空着直接写下一段(5分钟)","在群里问同学要链接(1分钟)"]}\n' +
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

// ===================== 每日反思对话 =====================

/**
 * 反思对话的多轮消息
 */
export interface ReflectionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
    // Responses API —— 把 messages 转为 input 数组格式
    const input = messages.map(m => ({
      role: m.role,
      content: [{ type: 'input_text' as const, text: m.content }],
    }))
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
      return { content: '', error: `接口错误 ${res.status}` }
    }

    const content = extractContent(res.body, useResponses)
    return { content }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { content: '', error: `请求异常：${msg.slice(0, 60)}` }
  }
}

/**
 * 构建反思对话的 system prompt
 *
 * @param summaryContext 由 summaryToLLMContext 生成的今日行为摘要
 */
export function buildReflectionSystemPrompt(summaryContext: string): string {
  return `你是用户的一个朋友，帮他做每日复盘。你说话像真人朋友一样自然随意，不刻意鸡汤、不教训、不堆砌emoji。

## 语气要求（非常重要）
- 说人话，像微信聊天那样自然。不要用"太赞啦✨"之类的夸张表达。
- emoji 最多每条消息用1个，大部分时候不用。
- 不要用"打怪升级""解锁成就""新皮肤"等游戏化比喻。
- 不要列清单、不要加粗、不要用标题格式。用连贯的段落写。
- 每条消息 2-4 句话就够了，简洁。

## 对话流程
严格按以下 3 步提问 + 1 步总结进行，每次只发一条消息，等用户回复再继续：

1. 看看今天的数据，找到做得不错的地方，自然地聊起来，问问用户感觉怎么样。
2. 如果数据里有卡顿、放弃、或者明显的空白时段，不带评价地提一下，问问用户那段时间发生了什么。
3. 根据前面的对话，问用户明天打算怎么调整，有没有什么小动作可以试试。
4. 用户回答完第三个问题后，写一段自然的总结。总结要包含：
   - 今天做得好的地方（真诚地说，不夸张）
   - 遇到的困难（客观描述）
   - 你额外补充一个实用的效率小技巧（比如番茄钟、5秒法则、2分钟规则等），要结合用户的实际情况，说清楚怎么用
   - 最后给一句简短的鼓励收尾

## 规则
- 第一条消息直接开始聊，不要自我介绍
- 用户可能回答得很短，你要善于追问和引导
- 提问要结合下面的数据，引用具体的任务名、时长等

========== 今日数据 ==========
${summaryContext}
========== 数据结束 ==========`
}
