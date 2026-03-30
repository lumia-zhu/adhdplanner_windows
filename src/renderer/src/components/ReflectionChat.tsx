/**
 * ReflectionChat —— AI 反思对话窗
 *
 * 开放式反思对话，围绕元认知四个方向自然推进
 * 对话历史在组件内管理
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { tracker } from '../services/tracker'
import type { AIConfig, ReflectionMessage, MessageContentPart } from '../services/ai'
import { chatReflectionStream, extractMemoryFromChat } from '../services/ai'

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

    const renderChartButton = (entry: { domId: string; label: string }) => (
      <button
        key={i}
        onClick={() => onRef(entry.domId)}
        className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-700
                   underline underline-offset-2 decoration-blue-300 hover:decoration-blue-500
                   transition-colors cursor-pointer font-medium"
        title={`点击查看${entry.label}图表`}
      >
        📊 {entry.label}
      </button>
    )

    // ---- 1. 精确 ID 匹配：【chart:week-heatmap】 ----
    const idMatch = inner.match(/^chart:(.+)$/)
    if (idMatch) {
      const entry = CHART_ID_MAP[idMatch[1]]
      if (entry) return renderChartButton(entry)
    }

    // ---- 2. 模糊 ID 匹配：AI 输出乱码时，在内容中搜索已知 chart ID ----
    const allChartIds = Object.keys(CHART_ID_MAP)
    for (const cid of allChartIds) {
      if (inner.includes(cid)) {
        return renderChartButton(CHART_ID_MAP[cid])
      }
    }

    // ---- 3. 中文 + 英文关键词兜底匹配 ----
    const keywordRules: [string[], string][] = [
      [['完成率', 'completion'],                       'completion-rate'],
      [['指标', '卡片', 'metrics'],                    'metrics'],
      [['用时', '时长', 'duration'],                   'task-duration'],
      [['活动', '热力', '分布', 'activity', 'heatmap', 'atmap'], 'activity'],
      [['节奏', '曲线', 'rhythm'],                     'rhythm'],
      [['week-completion', '每日任务', '日完成'],        'week-completion'],
      [['week-metrics', '周汇总', '周指标'],            'week-metrics'],
      [['week-ranking', '排行'],                       'week-ranking'],
      [['week-heatmap', '周热力', '周活动'],            'week-heatmap'],
      [['week-rhythm', '周节奏'],                      'week-rhythm'],
    ]
    for (const [keywords, id] of keywordRules) {
      if (keywords.some(kw => inner.toLowerCase().includes(kw))) {
        const entry = CHART_ID_MAP[id]
        if (entry) return renderChartButton(entry)
      }
    }

    // ---- 4. 都没匹配上：去掉【】，渲染为加粗文字 ----
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
  /** 反思模式：日反思 or 周反思，用于生成不同风格的探索方向 */
  mode?: 'daily' | 'weekly'
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
  mode = 'daily',
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
  const [restoredCount, setRestoredCount] = useState(0)
  const [storageReady, setStorageReady] = useState(false)
  const [restartKey, setRestartKey] = useState(0)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [endingState, setEndingState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<ReflectionMessage[]>([])
  const initCalledRef = useRef(false)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  const rawSessionRef = useRef<{ date: string; mode: 'daily' | 'weekly'; status: 'in_progress' | 'processed'; startedAt: number; messages: { role: 'user' | 'assistant'; content: string; ts: number }[] }>({
    date: selectedDate || new Date().toISOString().slice(0, 10),
    mode,
    status: 'in_progress',
    startedAt: Date.now(),
    messages: [],
  })

  /** 追加消息到 raw session 并持久化 */
  const persistRawMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const session = rawSessionRef.current
    session.messages.push({ role, content, ts: Date.now() })
    const key = storageKey || session.date
    window.electronAPI.saveRawSession(key, session).catch(e =>
      console.warn('[Memory] raw session 保存失败:', e)
    )
  }, [storageKey])

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
      const TIMEOUT_MS = 60_000
      const startTime = Date.now()

      const timeoutId = setTimeout(() => {
        if (settled || gotActivity) return
        settled = true
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.warn(`[ReflectionChat] ${elapsed}s 超时，未收到任何 AI 响应。消息数: ${newMessages.length}`)
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
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          console.log(`[ReflectionChat] AI 回复完成，耗时 ${elapsed}s，长度 ${fullText.length}`)
          setStreaming(false)
          setLoading(false)

          const rawContent = fullText.trim()
          if (!rawContent) {
            console.warn('[ReflectionChat] AI 回复为空')
            setError('AI 回复为空')
            setBubbles(prev => prev.slice(0, -1))
            resolve(null)
          } else {
            // 提取嵌入的探索方向标签
            const sugMatch = rawContent.match(/<!--SUGGESTIONS:\s*(\[[\s\S]*?\])\s*-->/)
            const content = rawContent.replace(/\s*<!--SUGGESTIONS:[\s\S]*?-->\s*$/, '').trim()

            if (sugMatch) {
              try {
                const dirs: string[] = JSON.parse(sugMatch[1])
                const cleaned = dirs
                  .map(d => d.trim())
                  .filter(d => d.length >= 4 && d.length <= 30)
                  .slice(0, 3)
                console.log('[ReflectionChat] 内嵌探索方向:', cleaned)
                if (cleaned.length > 0) setSuggestions(cleaned)
              } catch (e) {
                console.warn('[ReflectionChat] 解析探索方向失败:', e, sugMatch[1])
              }
            }

            // 更新 bubbles 中的最后一条消息为去掉标签后的内容
            setBubbles(prev => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last?.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content }
              }
              return updated
            })

            messagesRef.current = [
              ...newMessages,
              { role: 'assistant', content },
            ]
            persistRawMessage('assistant', content)
            resolve(content)
          }
        },
        (errMsg) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
          console.warn(`[ReflectionChat] AI 出错，耗时 ${elapsed}s:`, errMsg)
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
            setRestoredCount(cleaned.length)
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
    setRestoredCount(0)
    setError(null)
    setLoading(false)
    setStreaming(false)
    setSuggestions([])
    initCalledRef.current = false
    setRestartKey(k => k + 1)
  }, [storageKey])

  // ---- 结束反思（带收尾流程） ----
  const handleEndChat = useCallback(async () => {
    if (endingState !== 'idle') return
    setEndingState('saving')

    const session = rawSessionRef.current
    tracker.track('reflect.ended', {
      date: session.date,
      mode: session.mode,
      messageCount: bubbles.length,
      durationMs: Date.now() - session.startedAt,
    })

    try {
      const lastAssistant = bubbles.filter(b => b.role === 'assistant').pop()
      if (onComplete && lastAssistant?.content) {
        onComplete(lastAssistant.content)
      }

      // 从对话中提取记忆（带 3 秒超时保护）
      const session = rawSessionRef.current
      const chatMsgs = session.messages.filter(m => m.content.length > 0)

      if (chatMsgs.length >= 2) {
        const extractPromise = extractMemoryFromChat(chatMsgs, aiConfig)
        const timeoutPromise = new Promise<null>(r => setTimeout(() => r(null), 3000))
        const result = await Promise.race([extractPromise, timeoutPromise])

        if (result && (result.summary || result.commitments.length > 0)) {
          const dateStr = selectedDate || new Date().toISOString().slice(0, 10)
          try {
            const store = (await window.electronAPI.loadMemoryStore()) as {
              sessions?: unknown[]; commitments?: unknown[]; lastUpdated?: number
            } || { sessions: [], commitments: [], lastUpdated: 0 }

            if (result.summary) {
              const sessions = Array.isArray(store.sessions) ? store.sessions : []
              sessions.push({
                id: `${dateStr}-${mode}`,
                date: dateStr,
                mode,
                summary: result.summary,
                createdAt: Date.now(),
              })
              store.sessions = sessions
            }

            if (result.commitments.length > 0) {
              const commitments = Array.isArray(store.commitments) ? store.commitments : []
              for (const text of result.commitments) {
                commitments.push({
                  id: `${dateStr}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  text,
                  sourceDate: dateStr,
                  status: 'active',
                  createdAt: Date.now(),
                })
              }
              store.commitments = commitments
            }

            store.lastUpdated = Date.now()
            await window.electronAPI.saveMemoryStore(store)
            console.log('[Memory] 记忆已保存:', result.summary?.slice(0, 50), result.commitments)
          } catch (e) {
            console.warn('[Memory] 保存记忆失败:', e)
          }
        }
      }

      // 标记 raw session 为已处理
      session.status = 'processed'
      const key = storageKey || session.date
      window.electronAPI.saveRawSession(key, session).catch(() => {})

      setEndingState('saved')
      setTimeout(() => { onEndChat?.() }, 600)
    } catch (e) {
      console.error('[ReflectionChat] 结束反思收尾失败:', e)
      onEndChat?.()
    }
  }, [endingState, bubbles, onComplete, onEndChat, aiConfig, mode, selectedDate, storageKey])

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
  }, [bubbles, loading, streaming, suggestions, scrollToBottom])

  const isBusy = loading || streaming
  const canSend = chatActive && !isBusy

  // 发送一条用户消息（文本来自输入框或备选问题点击）
  const sendUserMessage = useCallback(async (text: string) => {
    if (!text || !canSend) return

    const msgIdx = bubbles.filter(b => b.role === 'user').length
    tracker.track('reflect.message_sent', {
      date: rawSessionRef.current.date,
      mode: rawSessionRef.current.mode,
      messageIndex: msgIdx,
      charCount: text.length,
    })

    setSuggestions([])
    persistRawMessage('user', text)
    const userBubble: ChatBubble = { role: 'user', content: text, timestamp: Date.now() }
    setBubbles(prev => [...prev, userBubble])

    const newMessages: ReflectionMessage[] = [
      ...messagesRef.current,
      { role: 'user', content: text },
    ]

    await sendToAI(newMessages)
    inputRef.current?.focus()
  }, [canSend, sendToAI, persistRawMessage])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendUserMessage(text)
  }

  const endButtonLabel = endingState === 'saving' ? '正在保存记忆...'
    : endingState === 'saved' ? '已保存' : '结束反思'

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏：结束反思按钮 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
        <span className="text-xs font-semibold text-gray-500">
          AI {mode === 'weekly' ? '周' : ''}反思助手
        </span>
        <button
          onClick={handleEndChat}
          disabled={endingState !== 'idle'}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold
                     transition-all active:scale-95
                     ${endingState === 'saved'
                       ? 'text-emerald-600 bg-emerald-50'
                       : endingState === 'saving'
                         ? 'text-gray-400 bg-gray-50 cursor-wait'
                         : 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                     }`}
        >
          {endingState === 'saving' ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {endButtonLabel}
        </button>
      </div>

      {/* 聊天区域 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
      >
        {bubbles.map((b, i) => {
          const isLastEmpty = b.role === 'assistant' && !b.content && i === bubbles.length - 1
          const showRestoredBanner = restored && restoredCount > 0 && i === restoredCount - 1 && bubbles.length > restoredCount
          return (
            <div key={i}>
              <div className={`flex ${b.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    b.role === 'user'
                      ? 'bg-blue-400/80 text-white rounded-br-md'
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
              {showRestoredBanner && (
                <div className="flex items-center gap-3 my-3">
                  <div className="flex-1 h-px bg-amber-200" />
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200/60 text-amber-600 text-xxs px-3 py-1.5 rounded-full flex-shrink-0">
                    <span>📋 以上是上次的对话记录</span>
                    <button
                      onClick={handleRestart}
                      className="text-amber-500 hover:text-amber-700 font-medium underline underline-offset-2 transition-colors"
                    >
                      重新开始
                    </button>
                  </div>
                  <div className="flex-1 h-px bg-amber-200" />
                </div>
              )}
            </div>
          )
        })}

        {/* 没有新消息时，在底部显示恢复提示 */}
        {restored && restoredCount > 0 && bubbles.length <= restoredCount && (
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

        {/* 备选反思问题 */}
        {suggestions.length > 0 && !isBusy && (
          <div className="flex flex-wrap gap-2 pl-1">
            {suggestions.map((q, i) => (
              <button
                key={i}
                onClick={() => sendUserMessage(q)}
                className="text-xs px-3 py-1.5 rounded-full border border-gray-200
                           bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300
                           hover:text-gray-800 transition-all cursor-pointer
                           leading-snug text-left"
              >
                {q}
              </button>
            ))}
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
              style={{ '--tw-ring-color': 'rgba(37,99,235,0.3)' } as React.CSSProperties}
              onFocus={e => (e.currentTarget.style.borderColor = '#2563eb')}
              onBlur={e => (e.currentTarget.style.borderColor = '')}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !canSend}
              className="px-4 py-2.5 rounded-xl text-blue-600 bg-blue-50 hover:bg-blue-100 text-sm font-semibold
                         active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all flex-shrink-0"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
