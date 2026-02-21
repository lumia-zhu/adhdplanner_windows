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
function buildChatBody(modelId: string, systemPrompt: string, userPrompt: string): string {
  return JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 120,
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

// ===================== 核心函数 =====================

/**
 * 生成微动作建议
 * @param taskTitle   当前任务标题
 * @param lastStep    上一步完成的动作（可选，用于接力建议）
 * @param config      AI 配置
 * @returns           { chips: string[]; error?: string }
 */
export async function generateMicroActions(
  taskTitle: string,
  lastStep?: string,
  config?: AIConfig,
): Promise<{ chips: string[]; error?: string }> {
  const cfg = config ?? DEFAULT_AI_CONFIG

  // 没有配置 → 静默跳过
  if (!cfg.apiKey || !cfg.modelId || !cfg.apiUrl) {
    return { chips: [] }
  }

  const systemPrompt =
    '你是一个专注力辅助AI。用户给你一个任务名称，你需要生成2个极其具体的、可以立即执行的微小物理动作建议。' +
    '每个建议不超过10个字，用JSON数组格式返回，如 ["打开空白文档","找导师的纪要"]。只返回JSON数组，不要其他任何内容。'

  const userPrompt = lastStep
    ? `任务：${taskTitle}\n上一步完成了：${lastStep}\n请给出紧接着的2个微动作建议。`
    : `任务：${taskTitle}\n请给出开始这个任务时最先要做的2个微动作建议。`

  const useResponses = isResponsesApi(cfg.apiUrl)
  const body = useResponses
    ? buildResponsesBody(cfg.modelId, systemPrompt, userPrompt)
    : buildChatBody(cfg.modelId, systemPrompt, userPrompt)

  try {
    // ★ 通过主进程代理请求，绕过 CORS
    const res = await window.electronAPI.aiRequest({
      url: cfg.apiUrl,
      apiKey: cfg.apiKey,
      body,
    })

    if (!res.ok) {
      console.warn('[AI] HTTP', res.status, res.body)
      return { chips: [], error: `接口错误 ${res.status}：${res.body.slice(0, 80)}` }
    }

    const content = extractContent(res.body, useResponses)
    console.log('[AI] 返回内容:', content)

    // 从回复中提取 JSON 数组
    const match = content.match(/\[[\s\S]*?\]/)
    if (match) {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) {
        return { chips: arr.map(String).slice(0, 2) }
      }
    }
    return { chips: [], error: `AI 返回格式异常：${content.slice(0, 60)}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn('[AI] 请求失败:', msg)
    return { chips: [], error: `请求异常：${msg.slice(0, 80)}` }
  }
}
