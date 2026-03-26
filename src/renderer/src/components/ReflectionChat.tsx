/**
 * ReflectionChat —— AI 反思对话窗
 *
 * 开放式反思对话，围绕元认知四个方向自然推进
 * 对话历史在组件内管理
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { AIConfig, ReflectionMessage, MessageContentPart } from '../services/ai'
import { chatReflectionStream } from '../services/ai'

interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/**
 * 图表 ID 映射表
 *
 * AI 在输出中使用 【chart:xxx】 格式引用图表，前端解析 ID 后：
 * - 用 domId 找到对应的 DOM 元素进行滚动/高亮
 * - 用 label 替换为用户友好的中文名显示
 *
 * 这样匹配逻辑是精确的英文 ID 比对，不依赖中文模糊匹配，成功率接近 100%
 */
const CHART_ID_MAP: Record<string, { domId: string; label: string }> = {
  // 日视图图表
  'completion-rate': { domId: 'chart-completion-rate', label: '完成率' },
  'metrics':         { domId: 'chart-key-metrics',     label: '指标卡片' },
  'task-duration':   { domId: 'chart-task-duration',   label: '任务用时' },
  'activity':        { domId: 'chart-activity-heatmap', label: '活动分布' },
  'rhythm':          { domId: 'chart-rhythm',           label: '节奏曲线' },
  // 周视图图表
  'week-completion': { domId: 'chart-week-completion', label: '每日任务完成率' },
  'week-metrics':    { domId: 'chart-week-metrics',    label: '周汇总指标' },
  'week-ranking':    { domId: 'chart-week-ranking',    label: '任务排行' },
  'week-heatmap':    { domId: 'chart-week-heatmap',    label: '活动热力图' },
  'week-rhythm':     { domId: 'chart-week-rhythm',     label: '节奏曲线' },
}

/**
 * 解析 AI 回复中的图表引用标签，返回 React 节点数组
 *
 * 支持两种格式（优先匹配新 ID 格式，兼容旧中文格式）：
 * - 新格式：【chart:rhythm】   → 精确 ID 匹配（推荐，成功率 ~100%）
 * - 旧格式：【节奏曲线】       → 关键词模糊匹配（兜底）
 */
function parseChartRefs(
  text: string,
  onRef: (chartId: string) => void,
): React.ReactNode[] {
  // 匹配所有 【xxx】 模式（包括 【chart:xxx】 和 【中文】）
  const parts = text.split(/(【[^】]+】)/g)
  return parts.map((part, i) => {
    const match = part.match(/^【([^】]+)】$/)
    if (!match) return <span key={i}>{part}</span>

    const inner = match[1]

    // ---- 新格式：【chart:xxx】 精确 ID 匹配 ----
    const idMatch = inner.match(/^chart:(.+)$/)
    if (idMatch) {
      const entry = CHART_ID_MAP[idMatch[1]]
      if (entry) {
        return (
          <button
            key={i}
            onClick={() => onRef(entry.domId)}
            className="inline-flex items-center gap-0.5 text-indigo-500 hover:text-indigo-700
                       underline underline-offset-2 decoration-indigo-300 hover:decoration-indigo-500
                       transition-colors cursor-pointer font-medium"
            title={`点击查看${entry.label}图表`}
          >
            📊 {entry.label}
          </button>
        )
      }
    }

    // ---- 旧格式兜底：【中文名】 关键词模糊匹配 ----
    const keywordRules: [string[], string][] = [
      [['完成率'],                     'completion-rate'],
      [['指标', '卡片'],               'metrics'],
      [['用时', '时长'],               'task-duration'],
      [['活动', '热力', '分布'],       'activity'],
      [['节奏', '曲线'],               'rhythm'],
    ]
    for (const [keywords, id] of keywordRules) {
      if (keywords.some(kw => inner.includes(kw))) {
        const entry = CHART_ID_MAP[id]
        if (!entry) continue
        return (
          <button
            key={i}
            onClick={() => onRef(entry.domId)}
            className="inline-flex items-center gap-0.5 text-indigo-500 hover:text-indigo-700
                       underline underline-offset-2 decoration-indigo-300 hover:decoration-indigo-500
                       transition-colors cursor-pointer font-medium"
            title={`点击查看${entry.label}图表`}
          >
            📊 {entry.label}
          </button>
        )
      }
    }

    // ---- 都没匹配上：去掉【】，渲染为加粗文字（不展示为可点击链接） ----
    return <strong key={i} className="text-gray-700 font-semibold">{inner}</strong>
  })
}

/** 持久化存储的聊天数据结构 */
interface SavedReflectionChat {
  bubbles: ChatBubble[]
  messages: ReflectionMessage[]
  step: number
  savedAt: number
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
  /** 存储标识，如 "2026-03-20" 或 "week-2026-03-20"，用于持久化聊天记录 */
  storageKey?: string
  /** 图表引用回调：当用户点击 AI 消息中的图表标签时触发 */
  onChartRef?: (chartId: string) => void
  /** 反思完成回调（用于埋点） */
  onComplete?: (summary: string) => void
  /** 结束反思并关闭侧边栏 */
  onEndChat?: () => void
}

export default function ReflectionChat({
  systemPrompt,
  aiConfig,
  screenshotBase64,
  selectedDate,
  storageKey,
  onChartRef,
  onComplete,
  onEndChat,
}: ReflectionChatProps) {
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatActive, setChatActive] = useState(false) // false=等待AI首条, true=对话中
  const [restored, setRestored] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const [restartKey, setRestartKey] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<ReflectionMessage[]>([])
  const initCalledRef = useRef(false)
  const streamCleanupRef = useRef<(() => void) | null>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    })
  }, [])

  useEffect(() => {
    return () => { streamCleanupRef.current?.() }
  }, [])

  const sendToAI = useCallback((newMessages: ReflectionMessage[]): Promise<string | null> => {
    setLoading(true)
    setStreaming(false)
    setError(null)

    return new Promise((resolve) => {
      const placeholder: ChatBubble = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }
      setBubbles(prev => [...prev, placeholder])

      let settled = false
      let gotActivity = false
      const TIMEOUT_MS = 20_000

      const timeoutId = setTimeout(() => {
        if (settled || gotActivity) return
        settled = true
        console.warn('[ReflectionChat] 20s 超时，未收到任何 AI 响应')
        streamCleanupRef.current?.()
        setStreaming(false)
        setLoading(false)
        setError('AI 响应超时，请稍后重试')
        setBubbles(prev => prev.slice(0, -1))
        resolve(null)
      }, TIMEOUT_MS)

      chatReflectionStream(
        newMessages,
        aiConfig,
        (delta) => {
          gotActivity = true
          setStreaming(true)
          setLoading(false)
          setBubbles(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + delta }
            }
            return updated
          })
        },
        (fullText) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          setStreaming(false)
          setLoading(false)
          messagesRef.current = [
            ...newMessages,
            { role: 'assistant', content: fullText },
          ]
          if (!fullText) {
            setError('AI 回复为空')
            setBubbles(prev => prev.slice(0, -1))
            resolve(null)
          } else {
            resolve(fullText)
          }
        },
        (errMsg) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          setStreaming(false)
          setLoading(false)
          setError(errMsg)
          setBubbles(prev => prev.slice(0, -1))
          resolve(null)
        },
      ).then(cleanup => {
        streamCleanupRef.current = cleanup
      })
    })
  }, [aiConfig])

  // ---- 加载历史聊天记录 ----
  useEffect(() => {
    if (!storageKey) { setStorageReady(true); return }

    if (typeof window.electronAPI.loadReflectionChat !== 'function') {
      setStorageReady(true)
      return
    }

    window.electronAPI.loadReflectionChat(storageKey)
      .then((raw) => {
        const saved = raw as SavedReflectionChat | null
        if (saved && Array.isArray(saved.bubbles) && saved.bubbles.length > 0) {
          let cleaned = saved.bubbles
          while (cleaned.length > 0) {
            const last = cleaned[cleaned.length - 1]
            if (last.role === 'assistant' && !last.content) {
              cleaned = cleaned.slice(0, -1)
            } else break
          }
          if (cleaned.length > 0) {
            setBubbles(cleaned)
            messagesRef.current = saved.messages || []
            setChatActive((saved.step ?? 0) > 0)
            setRestored(true)
            initCalledRef.current = true
          }
        }
        setStorageReady(true)
      })
      .catch(() => setStorageReady(true))
  }, [storageKey])

  // ---- 自动保存聊天记录 ----
  useEffect(() => {
    if (!storageKey || bubbles.length === 0) return
    if (loading || streaming) return
    if (typeof window.electronAPI.saveReflectionChat !== 'function') return
    const timer = setTimeout(() => {
      window.electronAPI.saveReflectionChat(storageKey, {
        bubbles,
        messages: messagesRef.current,
        step: chatActive ? 1 : 0,
        savedAt: Date.now(),
      } satisfies SavedReflectionChat)
    }, 500)
    return () => clearTimeout(timer)
  }, [bubbles, chatActive, storageKey, loading, streaming])

  // ---- 重新开始对话 ----
  const handleRestart = useCallback(() => {
    if (storageKey && typeof window.electronAPI.saveReflectionChat === 'function') {
      window.electronAPI.saveReflectionChat(storageKey, null)
    }
    streamCleanupRef.current?.()
    setBubbles([])
    messagesRef.current = []
    setChatActive(false)
    setRestored(false)
    setError(null)
    setLoading(false)
    setStreaming(false)
    initCalledRef.current = false
    setRestartKey(k => k + 1)
  }, [storageKey])

  // ---- 结束反思 ----
  const handleEndChat = useCallback(() => {
    const lastAssistant = bubbles.filter(b => b.role === 'assistant').pop()
    if (onComplete && lastAssistant?.content) {
      onComplete(lastAssistant.content)
    }
    onEndChat?.()
  }, [bubbles, onComplete, onEndChat])

  // 初始化：发送第一条 AI 消息
  useEffect(() => {
    if (!storageReady) return
    if (initCalledRef.current || chatActive || bubbles.length > 0) return
    if (!systemPrompt) return
    initCalledRef.current = true

    const initMessages: ReflectionMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    if (screenshotBase64) {
      const todayStr = new Date().toISOString().slice(0, 10)
      const dateIsToday = !selectedDate || selectedDate === todayStr
      const dateLabel = dateIsToday ? '今天' : (selectedDate ?? todayStr)
      const multimodalContent: MessageContentPart[] = [
        { type: 'image_url', image_url: { url: screenshotBase64 } },
        { type: 'text', text: `上面是我${dateLabel}的数据仪表板截图，包含${dateIsToday ? '任务完成率、' : ''}核心指标卡片、任务用时条形图、活动热力图和使用节奏曲线。请结合这些可视化数据，开始我们的反思对话吧。` },
      ]
      initMessages.push({ role: 'user', content: multimodalContent })
    }

    messagesRef.current = initMessages

    sendToAI(initMessages).then(content => {
      if (content) setChatActive(true)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemPrompt, screenshotBase64, storageReady, restartKey])

  useEffect(() => {
    scrollToBottom()
  }, [bubbles, loading, streaming, scrollToBottom])

  const isBusy = loading || streaming
  const canSend = chatActive && !isBusy

  // 用户发送消息（开放式，没有步骤限制）
  const handleSend = async () => {
    const text = input.trim()
    if (!text || !canSend) return

    setInput('')

    const userBubble: ChatBubble = { role: 'user', content: text, timestamp: Date.now() }
    setBubbles(prev => [...prev, userBubble])

    const newMessages: ReflectionMessage[] = [
      ...messagesRef.current,
      { role: 'user', content: text },
    ]

    await sendToAI(newMessages)

    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-full">
      {/* 聊天区域 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {bubbles.map((b, i) => {
          const isLastEmpty = b.role === 'assistant' && !b.content && i === bubbles.length - 1
          return (
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
                {isLastEmpty ? (
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                ) : b.role === 'assistant' && onChartRef
                  ? parseChartRefs(b.content, onChartRef)
                  : b.content}
              </div>
            </div>
          )
        })}

        {/* 历史记录恢复提示 */}
        {restored && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200/60 text-amber-600 text-xxs px-3 py-1.5 rounded-full">
              <span>📋 这是上次的对话记录</span>
              <button
                onClick={handleRestart}
                className="text-amber-500 hover:text-amber-700 font-medium underline underline-offset-2 transition-colors"
              >
                重新开始
              </button>
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
      <div className="flex-shrink-0 border-t border-gray-100 bg-white">
        <div className="px-4 py-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
              placeholder={canSend ? '说说你的想法…' : '等待 AI 回复…'}
              disabled={!canSend}
              maxLength={500}
              className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-gray-200
                         focus:ring-2 outline-none bg-gray-50 focus:bg-white transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed
                         placeholder-gray-400"
              style={{ '--tw-ring-color': 'rgba(100,155,139,0.3)' } as React.CSSProperties}
              onFocus={e => (e.currentTarget.style.borderColor = '#649b8b')}
              onBlur={e => (e.currentTarget.style.borderColor = '')}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !canSend}
              className="px-4 py-2.5 rounded-xl text-white text-sm font-semibold
                         active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed
                         shadow-md transition-all flex-shrink-0"
              style={{ backgroundColor: '#649b8b', boxShadow: '0 4px 6px -1px rgba(100,155,139,0.3)' }}
              onMouseEnter={e => { if (input.trim() && canSend) e.currentTarget.style.backgroundColor = '#548676' }}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = '#649b8b'}
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
