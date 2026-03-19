/**
 * ReflectionChat —— AI 反思对话窗
 *
 * 3问 + 1总结 的引导式对话，支持多轮上下文
 * 对话历史在组件内管理
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { AIConfig, ReflectionMessage, MessageContentPart } from '../services/ai'
import { chatReflection } from '../services/ai'

interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/** 图表引用标签 → 图表元素 id 的映射 */
const CHART_REF_MAP: Record<string, string> = {
  '完成率': 'chart-completion-rate',
  '指标卡片': 'chart-key-metrics',
  '任务用时': 'chart-task-duration',
  '活动分布': 'chart-activity-heatmap',
  '热力图': 'chart-activity-heatmap',
  '节奏曲线': 'chart-rhythm',
}

/** 解析文本中的【xxx】标签，返回 React 节点数组 */
function parseChartRefs(
  text: string,
  onRef: (chartId: string) => void,
): React.ReactNode[] {
  // 匹配 【xxx】 模式
  const parts = text.split(/(【[^】]+】)/g)
  return parts.map((part, i) => {
    const match = part.match(/^【([^】]+)】$/)
    if (match) {
      const label = match[1]
      const chartId = CHART_REF_MAP[label]
      if (chartId) {
        return (
          <button
            key={i}
            onClick={() => onRef(chartId)}
            className="inline-flex items-center gap-0.5 text-indigo-500 hover:text-indigo-700
                       underline underline-offset-2 decoration-indigo-300 hover:decoration-indigo-500
                       transition-colors cursor-pointer font-medium"
            title={`点击查看${label}图表`}
          >
            📊 {label}
          </button>
        )
      }
    }
    return <span key={i}>{part}</span>
  })
}

interface ReflectionChatProps {
  /** 由 buildReflectionSystemPrompt 构建的系统提示词 */
  systemPrompt: string
  /** AI 配置 */
  aiConfig: AIConfig
  /** 仪表板截图 base64（data:image/jpeg;base64,...） */
  screenshotBase64?: string | null
  /** 当前反思的日期 YYYY-MM-DD（用于截图消息中标注日期） */
  selectedDate?: string
  /** 图表引用回调：当用户点击 AI 消息中的图表标签时触发 */
  onChartRef?: (chartId: string) => void
  /** 反思完成回调（AI 生成总结后） */
  onComplete?: (summary: string) => void
}

export default function ReflectionChat({
  systemPrompt,
  aiConfig,
  screenshotBase64,
  selectedDate,
  onChartRef,
  onComplete,
}: ReflectionChatProps) {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)  // 0=等待首条AI, 1-3=等待用户回答, 4=已完成
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<ReflectionMessage[]>([])
  const initCalledRef = useRef(false) // 防止 Strict Mode 重复初始化

  // 滚动到底
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [])

  // 发送消息给 AI 并获取回复
  const sendToAI = useCallback(async (newMessages: ReflectionMessage[]) => {
    setLoading(true)
    setError(null)

    const { content, error: err } = await chatReflection(newMessages, aiConfig)

    if (err || !content) {
      setError(err || 'AI 回复为空')
      setLoading(false)
      return null
    }

    const aiBubble: ChatBubble = {
      role: 'assistant',
      content,
      timestamp: Date.now(),
    }
    setBubbles(prev => [...prev, aiBubble])
    messagesRef.current = [
      ...newMessages,
      { role: 'assistant', content },
    ]

    setLoading(false)
    return content
  }, [aiConfig])

  // 初始化：发送第一条 AI 消息（Step 1 提问）
  // 如果有截图，会在 user 消息中附带仪表板截图让 AI 先"看"一下
  useEffect(() => {
    if (initCalledRef.current || step > 0 || bubbles.length > 0) return
    if (!systemPrompt) return  // systemPrompt 为空时不发送
    initCalledRef.current = true

    const initMessages: ReflectionMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    // ★ 有截图时：以多模态 user 消息附带图片
    if (screenshotBase64) {
      const todayStr = new Date().toISOString().slice(0, 10)
      const dateIsToday = !selectedDate || selectedDate === todayStr
      const dateLabel = dateIsToday ? '今天' : selectedDate!
      const multimodalContent: MessageContentPart[] = [
        { type: 'image_url', image_url: { url: screenshotBase64 } },
        { type: 'text', text: `上面是我${dateLabel}的数据仪表板截图，包含${dateIsToday ? '任务完成率、' : ''}核心指标卡片、任务用时条形图、活动热力图和使用节奏曲线。请结合这些可视化数据，开始我们的反思对话吧。` },
      ]
      initMessages.push({ role: 'user', content: multimodalContent })
    }

    messagesRef.current = initMessages

    sendToAI(initMessages).then(content => {
      if (content) setStep(1) // 等待用户回答 Step 1
    })
  }, [systemPrompt, screenshotBase64])

  // bubbles 变化时滚动到底
  useEffect(() => {
    scrollToBottom()
  }, [bubbles, loading, scrollToBottom])

  // 用户发送消息
  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading || step === 0 || step >= 4) return

    setInput('')

    // 用户气泡
    const userBubble: ChatBubble = { role: 'user', content: text, timestamp: Date.now() }
    setBubbles(prev => [...prev, userBubble])

    // 更新消息历史
    const newMessages: ReflectionMessage[] = [
      ...messagesRef.current,
      { role: 'user', content: text },
    ]

    // Step 3 用户回答后，注入指令让 AI 生成总结
    if (step === 3) {
      newMessages.push({
        role: 'system',
        content: '用户已经回答完三个问题了。现在请写一段自然连贯的每日总结。' +
                 '包含：今天做得好的地方、遇到的困难、一个实用的效率小技巧建议、一句简短鼓励。' +
                 '用连贯的段落写，不要用列表格式，不要堆emoji，像朋友给你发的语音消息转文字那样自然。',
      })
    }

    const content = await sendToAI(newMessages)

    if (content) {
      const nextStep = step + 1
      setStep(nextStep)
      if (nextStep >= 4 && onComplete) {
        onComplete(content)
      }
    }

    inputRef.current?.focus()
  }

  const STEP_LABELS = [
    '正在准备...',
    '第1步 / 3：寻找今日亮点 ✨',
    '第2步 / 3：发现改进空间 🔍',
    '第3步 / 3：制定明日策略 🎯',
    '✅ 反思完成！',
  ]

  const isComplete = step >= 4
  const isReady = step > 0 && step < 4

  return (
    <div className="flex flex-col h-full">
      {/* 步骤指示器 */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          {/* 进度点 */}
          <div className="flex items-center gap-1">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  step >= s + 1
                    ? 'bg-emerald-400 scale-110'
                    : step === s
                    ? 'bg-indigo-400 scale-125 ring-2 ring-indigo-100'
                    : 'bg-gray-200'
                }`}
              />
            ))}
            <div
              className={`w-2 h-2 rounded-full transition-all duration-300 ml-0.5 ${
                isComplete ? 'bg-amber-400 scale-125 ring-2 ring-amber-100' : 'bg-gray-200'
              }`}
            />
          </div>
          <span className="text-xs text-gray-500 font-medium">
            {STEP_LABELS[Math.min(step, 4)]}
          </span>
        </div>
      </div>

      {/* 聊天区域 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {bubbles.map((b, i) => (
          <div
            key={i}
            className={`flex ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                b.role === 'user'
                  ? 'bg-indigo-500 text-white rounded-br-md'
                  : 'bg-gray-50 text-gray-800 border border-gray-100 rounded-bl-md'
              }`}
            >
              {b.role === 'assistant' && onChartRef
                ? parseChartRefs(b.content, onChartRef)
                : b.content}
            </div>
          </div>
        ))}

        {/* 打字指示器 */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex justify-center">
            <span className="text-xs text-red-400 bg-red-50 px-3 py-1.5 rounded-full">
              ⚠️ {error}
            </span>
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
        {isComplete ? (
          <div className="text-center py-2">
            <p className="text-sm text-gray-400">
              🎉 今天的反思已完成，好好休息吧！
            </p>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
              placeholder={isReady ? '说说你的想法…' : '等待 AI 回复…'}
              disabled={!isReady || loading}
              maxLength={500}
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-200
                         focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100
                         outline-none bg-gray-50 focus:bg-white transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed
                         placeholder-gray-400"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !isReady || loading}
              className="px-4 py-2.5 rounded-xl bg-indigo-500 text-white text-sm font-semibold
                         hover:bg-indigo-600 active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed
                         shadow-md shadow-indigo-200/50 transition-all flex-shrink-0"
            >
              发送
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
