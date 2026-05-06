/**
 * ReflectionChat —— AI 反思对话窗
 *
 * 开放式反思对话，围绕元认知四个方向自然推进
 * 对话历史在组件内管理
 */

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { tracker } from '../services/tracker'
import type { AIConfig, ReflectionMessage, MessageContentPart, VisualTarget } from '../services/ai'
import { chatReflectionStream, extractMemoryFromChat, selectReflectionVisualFocus } from '../services/ai'

interface ChatBubble {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  visualRef?: VisualRef | null
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
  'rhythm':          { domId: 'chart-rhythm',           label: '电脑活动' },
  'app-usage':       { domId: 'chart-app-usage',        label: '应用使用时长' },
  // 周视图图表
  'week-completion': { domId: 'chart-week-completion', label: '每日任务完成率' },
  'week-metrics':    { domId: 'chart-week-metrics',    label: '周汇总指标' },
  'week-ranking':    { domId: 'chart-week-ranking',    label: '任务排行' },
  'week-heatmap':    { domId: 'chart-week-heatmap',    label: '活动热力图' },
  'week-rhythm':     { domId: 'chart-week-rhythm',     label: '电脑活动' },
  'week-app-usage':  { domId: 'chart-week-app-usage',  label: '应用使用时长' },
}

const STREAM_CHART_FALLBACK_DELAY_MS = 700

export type VisualFocusType = 'activity-hour' | 'activity-range' | 'task-duration' | 'metric' | 'app-usage'

export type VisualFocusRef = Extract<VisualRef, { kind: 'focus' }>

export type VisualRef =
  | { kind: 'chart'; chartId: string; label: string }
  | { kind: 'focus'; focusType: VisualFocusType; value: string; label: string; chartId?: string; targetId?: string; startHour?: number; endHour?: number }
  /** 同一图表内多项并列（当前用于多条应用时长） */
  | { kind: 'multi-focus'; chartId: string; label: string; refs: VisualFocusRef[] }

const FOCUS_TYPE_LABELS: Record<VisualFocusType, string> = {
  'activity-hour': '电脑活动',
  'activity-range': '电脑活动',
  'task-duration': '任务',
  metric: '指标',
  'app-usage': '应用',
}

const METRIC_LABELS: Record<string, string> = {
  'completed-tasks': '完成任务数',
  'computer-usage': '电脑使用时长',
  'focus-minutes': '任务时长',
}

function chartIdToRef(chartId: string): Extract<VisualRef, { kind: 'chart' }> | null {
  const normalized = chartId.trim()
  if (!normalized) return null

  const direct = Object.entries(CHART_ID_MAP).find(([, entry]) => entry.domId === normalized)
  if (direct) {
    const [, entry] = direct
    return { kind: 'chart', chartId: entry.domId, label: entry.label }
  }

  const byKey = CHART_ID_MAP[normalized.replace(/^chart-/, '')] ?? CHART_ID_MAP[normalized]
  if (!byKey) return null
  return { kind: 'chart', chartId: byKey.domId, label: byKey.label }
}

function visualRefKey(ref: VisualRef): string {
  if (ref.kind === 'chart') return `chart:${ref.chartId}`
  if (ref.kind === 'multi-focus') return `multi:${ref.refs.map(r => r.targetId ?? `${r.focusType}:${r.value}`).join('|')}`
  return `focus:${ref.targetId ?? `${ref.focusType}:${ref.value}`}`
}

/** 轻量解析 Markdown 加粗：只支持 **重点文本**，避免引入完整 Markdown 渲染器 */
function parseBoldText(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const match = part.match(/^\*\*([^*]+)\*\*$/)
    if (!match) return <span key={`${keyPrefix}-${i}`}>{part}</span>
    return (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-gray-900">
        {match[1]}
      </strong>
    )
  })
}

/** 把编号行里位于句子中间的图表引用移动到编号后，形成稳定扫读结构 */
function normalizeNumberedChartRefs(text: string): string {
  return text.split('\n').map((line) => {
    const match = line.match(/^(\s*[1-3]️⃣\s+)(?!【\s*chart:)(.*?)(【\s*chart:[^】]+】)(.*)$/i)
    if (!match) return line

    const [, prefix, before, chartRef, after] = match
    const sentence = `${before.trim()}${after.trimStart()}`
    return `${prefix}${chartRef}${sentence ? ` ${sentence}` : ''}`
  }).join('\n')
}

/** 清理 AI 流式输出里不该展示给用户的控制语法 */
function sanitizeAssistantDisplayText(text: string): string {
  let cleaned = text

  cleaned = cleaned
    .replace(/<!--\s*VISUAL_REF:[\s\S]*?-->/gi, '')
    .replace(/<!--\s*VISUAL_REF:[\s\S]*$/gi, '')
    .replace(/<!--\s*VISUAL_[\s\S]*$/gi, '')
    .replace(/<!--\s*VIS[\s\S]*$/gi, '')
    .replace(/<!--\s*V[\s\S]*$/gi, '')

  const suggestionStart = cleaned.search(/<!--\s*SUGGESTIONS:/i)
  if (suggestionStart >= 0) {
    cleaned = cleaned.slice(0, suggestionStart)
  }

  cleaned = cleaned
    .replace(/<!--\s*SUGGESTIONS:[\s\S]*?-->/gi, '')
    .replace(/^\s*.*SUGGESTIONS\s*:.*$/gim, '')
    .replace(/^\s*.*VISUAL_REF\s*:.*$/gim, '')
    .replace(/^\s*【\s*chart(?::[A-Za-z-]*)?\s*$/gim, '')
    .replace(/【\s*chart(?::[A-Za-z-]*)?$/gim, '')
    .replace(/^\s*【\s*focus(?::[^】]*)?\s*$/gim, '')
    .replace(/【\s*focus(?::[^】]*)?$/gim, '')

  return normalizeNumberedChartRefs(cleaned).trimEnd()
}

function sanitizeFocusValue(value: string): string | null {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned || cleaned.length > 40) return null
  if (/[<>【】]/.test(cleaned)) return null
  return cleaned
}

function buildFocusLabel(focusType: VisualFocusType, value: string): string {
  if (focusType === 'activity-hour') {
    const hour = Number(value)
    return Number.isInteger(hour) ? `重点位置：电脑活动 ${hour}:00-${hour + 1}:00` : '重点位置：电脑活动'
  }

  if (focusType === 'activity-range') {
    const match = value.match(/^(\d{1,2})-(\d{1,2})$/)
    if (match) return `重点位置：电脑活动 ${Number(match[1])}:00-${Number(match[2])}:00`
    return '重点位置：电脑活动'
  }

  if (focusType === 'metric') {
    return `重点位置：${METRIC_LABELS[value] ?? FOCUS_TYPE_LABELS[focusType]}`
  }

  return `重点位置：${FOCUS_TYPE_LABELS[focusType]} ${value}`
}

function visualTargetToRef(target: VisualTarget | null): VisualRef | null {
  if (!target) return null

  if (target.type === 'activity_hour') {
    const hour = target.startHour ?? Number(target.value)
    if (!Number.isInteger(hour)) return null
    return {
      kind: 'focus',
      focusType: 'activity-hour',
      value: String(hour),
      label: target.label,
      chartId: target.chartId,
      targetId: target.targetId,
      startHour: hour,
      endHour: hour + 1,
    }
  }

  if (target.type === 'activity_range') {
    if (!Number.isInteger(target.startHour) || !Number.isInteger(target.endHour)) return null
    return {
      kind: 'focus',
      focusType: 'activity-range',
      value: `${target.startHour}-${target.endHour}`,
      label: target.label,
      chartId: target.chartId,
      targetId: target.targetId,
      startHour: target.startHour,
      endHour: target.endHour,
    }
  }

  const focusTypeMap = {
    task_duration: 'task-duration',
    metric: 'metric',
    app_usage: 'app-usage',
  } as const
  const focusType = focusTypeMap[target.type as keyof typeof focusTypeMap]
  if (!focusType) return null

  return {
    kind: 'focus',
    focusType,
    value: target.value ?? target.label,
    label: target.label,
    chartId: target.chartId,
    targetId: target.targetId,
  }
}

/** 将结构化解析出的多个 VisualTarget 转为气泡引用（仅并列多条应用时合成 multi-focus） */
function visualTargetsToVisualRef(targets: VisualTarget[]): VisualRef | null {
  if (targets.length === 0) return null

  const pairs = targets
    .map(t => ({ t, ref: visualTargetToRef(t) }))
    .filter((p): p is { t: VisualTarget; ref: VisualFocusRef } => Boolean(p.ref))

  if (pairs.length === 0) return null
  if (pairs.length === 1) return pairs[0].ref

  const allApps = pairs.every(p => p.t.type === 'app_usage')
  if (!allApps) return pairs[0].ref

  const chartId = pairs[0].t.chartId
  const aligned = pairs.filter(p => p.t.chartId === chartId)
  if (aligned.length <= 1) return aligned[0]?.ref ?? pairs[0].ref

  return {
    kind: 'multi-focus',
    chartId,
    label: aligned.map(p => p.t.label).join('、'),
    refs: aligned.map(p => p.ref),
  }
}

function parseVisualRefMarkers(text: string, visualTargets: VisualTarget[]): VisualRef[] {
  const refs: VisualRef[] = []
  const targetMap = new Map(visualTargets.map(target => [target.targetId, target]))
  const markerRe = /<!--\s*VISUAL_REF:\s*([\s\S]*?)\s*-->/gi

  for (const match of text.matchAll(markerRe)) {
    try {
      const payload = JSON.parse(match[1]) as { targetIds?: unknown; chartId?: unknown }
      if (Array.isArray(payload.targetIds)) {
        const targets = payload.targetIds
          .filter((id): id is string => typeof id === 'string')
          .map(id => targetMap.get(id))
          .filter((target): target is VisualTarget => Boolean(target))
        const ref = visualTargetsToVisualRef(targets)
        if (ref) refs.push(ref)
        continue
      }

      if (typeof payload.chartId === 'string') {
        const ref = chartIdToRef(payload.chartId)
        if (ref) refs.push(ref)
      }
    } catch (e) {
      console.warn('[ReflectionChat] VISUAL_REF 标记解析失败:', e, match[1])
    }
  }

  return refs
}

function cleanSuggestionLabel(label: unknown): string | null {
  const cleaned = normalizeSuggestionDirection(String(label)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/【\s*chart:[^】]*】/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/SUGGESTIONS\s*:.*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim())

  if (!cleaned) return null
  if (cleaned.length < 4 || cleaned.length > 30) return null
  if (/chart:|SUGGESTIONS|<!--|\*\*/i.test(cleaned)) return null
  return cleaned
}

function extractSuggestions(rawText: string): string[] {
  const match = rawText.match(/<!--\s*SUGGESTIONS:\s*(\[[\s\S]*?\])\s*-->/i)
  if (!match) return []

  try {
    const parsed = JSON.parse(match[1])
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(cleanSuggestionLabel)
      .filter((item): item is string => Boolean(item))
      .slice(0, 3)
  } catch (e) {
    console.warn('[ReflectionChat] 解析探索方向失败:', e, match[1])
    return []
  }
}

function normalizeSuggestionDirection(label: string): string {
  let normalized = label
    .replace(/^和前几天相比$/g, '和前几天的区别')
    .replace(/^停下来的是哪一步$/g, '分析卡顿情况')
    .replace(/^卡住后怎么继续的$/g, '分析卡顿情况')
    .replace(/^类似的一次卡住$/g, '分析卡顿情况')
    .replace(/(总被留到后面的|被留到后面的|一直没碰的|这几天都没动的|反复出现在计划里的)(学习|论文|英语|数学|课程|作业|复习|考试|编程|代码|项目|阅读|写作|实验|报告|文献|研究|开发|工作|课堂|学校|专业|实习)任务/g, '$1任务')
    .replace(/(列了但没开始的|计划里没写的|做了但没计划的|很快勾掉的|花最久的|顺手做完的|真正开始的)(学习|论文|英语|数学|课程|作业|复习|考试|编程|代码|项目|阅读|写作|实验|报告|文献|研究|开发|工作|课堂|学校|专业|实习)任务/g, '$1任务')
    .replace(/^(论文|英语|数学|课程|作业|复习|考试|编程|代码|项目|阅读|写作|实验|报告|文献|研究|开发|学习)任务(一直没开始|没开始|没推进|总被留下|总被留到后面)$/g, '列了但没开始的任务')
    .replace(/^(Cursor|Edge|Chrome|浏览器|微信|Word|Excel|PowerPoint|VS Code|Visual Studio Code).*(使用|时长|占用)$/i, '电脑开着时在做什么')
    .replace(/^\d{1,2}[点:：].*(学习|任务|推进).*$/g, '比较集中的推进时间')
    .replace(/^(上午|中午|下午|晚上|夜里).*(学习|任务|推进).*$/g, '更容易动起来的时间')

  normalized = normalized.replace(/\s+/g, ' ').trim()
  return normalized
}

function findFallbackChartRef(text: string): Extract<VisualRef, { kind: 'chart' }> | null {
  const chartMatch = text.match(/【\s*chart:([^】\s]+)\s*】/i)
  if (chartMatch) {
    const ref = chartIdToRef(chartMatch[1].trim().toLowerCase())
    if (ref) return ref
  }

  const keywordRules: [string[], string][] = [
    [['完成率', 'completion'],                       'completion-rate'],
    [['指标', '卡片', 'metrics'],                    'metrics'],
    [['用时', '时长', 'duration'],                   'task-duration'],
    [['应用使用', '应用时长', 'app-usage'],           'app-usage'],
    [['活动', '热力', '分布', '电脑活动', 'activity', 'heatmap', 'atmap'], 'activity'],
    [['节奏', '曲线', 'rhythm'],                     'rhythm'],
    [['week-completion', '每日任务', '日完成'],        'week-completion'],
    [['week-metrics', '周汇总', '周指标'],            'week-metrics'],
    [['week-ranking', '排行'],                       'week-ranking'],
    [['week-heatmap', '周热力', '周活动'],            'week-heatmap'],
    [['week-rhythm', '周节奏'],                      'week-rhythm'],
    [['week-app-usage', '周应用', '本周应用'],         'week-app-usage'],
  ]

  const bracketTexts = [...text.matchAll(/【([^】]+)】/g)].map(match => match[1].toLowerCase())
  for (const inner of bracketTexts) {
    for (const [keywords, id] of keywordRules) {
      if (keywords.some(kw => inner.includes(kw))) {
        const entry = CHART_ID_MAP[id]
        if (entry) return { kind: 'chart', chartId: entry.domId, label: entry.label }
      }
    }
  }

  return null
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
  onRef: (ref: VisualRef) => void,
  focusState: { rendered: boolean },
  bubbleVisualRef?: VisualRef | null,
): React.ReactNode[] {
  // 匹配所有 【xxx】 模式（包括 【chart:xxx】 和 【中文】）
  const parts = text.split(/(【[^】]+】)/g)
  return parts.map((part, i) => {
    const match = part.match(/^【([^】]+)】$/)
    if (!match) return <span key={i}>{parseBoldText(part, `text-${i}`)}</span>

    const inner = match[1]

    const getRefForChartButton = (entry: { domId: string; label: string }): VisualRef => {
      if (bubbleVisualRef?.kind === 'multi-focus') {
        if (bubbleVisualRef.chartId === entry.domId) return bubbleVisualRef
      }
      if (bubbleVisualRef?.kind === 'focus') {
        const isExactChart = bubbleVisualRef.chartId === entry.domId
        const isActivityChart = bubbleVisualRef.chartId === 'chart-activity-heatmap' &&
          (entry.domId === 'chart-rhythm' || entry.domId === 'chart-activity-heatmap')
        if (isExactChart || isActivityChart) return bubbleVisualRef
      }
      return { kind: 'chart', chartId: entry.domId, label: entry.label }
    }

    const chartRefTitle = (entry: { label: string }) => {
      if (bubbleVisualRef?.kind === 'multi-focus') return `点击高亮：${bubbleVisualRef.label}`
      if (bubbleVisualRef?.kind === 'focus') return `点击高亮${bubbleVisualRef.label}`
      return `点击查看${entry.label}图表`
    }

    const renderChartButton = (entry: { domId: string; label: string }) => (
      <button
        key={i}
        onClick={() => onRef(getRefForChartButton(entry))}
        className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-700
                   underline underline-offset-2 decoration-blue-300 hover:decoration-blue-500
                   transition-colors cursor-pointer font-medium"
        title={chartRefTitle(entry)}
      >
        📊 {entry.label}
      </button>
    )

    const renderFocusButton = (ref: Extract<VisualRef, { kind: 'focus' }>) => (
      <button
        key={i}
        onClick={() => onRef(ref)}
        className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800
                   underline underline-offset-2 decoration-amber-300 hover:decoration-amber-500
                   transition-colors cursor-pointer font-semibold"
        title={`点击高亮${ref.label}`}
      >
        ◉ {ref.label}
      </button>
    )

    // ---- 1. 重点局部高亮：【focus:activity-hour:14】 ----
    const focusMatch = inner.match(/^focus:([^:]+):(.+)$/i)
    if (focusMatch) {
      const focusType = focusMatch[1].trim() as VisualFocusType
      const value = sanitizeFocusValue(focusMatch[2])
      const isKnownType = Object.prototype.hasOwnProperty.call(FOCUS_TYPE_LABELS, focusType)

      if (isKnownType && value) {
        const label = buildFocusLabel(focusType, value)
        if (!focusState.rendered) {
          focusState.rendered = true
          return renderFocusButton({ kind: 'focus', focusType, value, label })
        }

        return <strong key={i} className="text-gray-700 font-semibold">{label.replace(/^重点位置：/, '')}</strong>
      }
    }

    // ---- 2. 精确 ID 匹配：【chart:week-heatmap】 ----
    const idMatch = inner.match(/^chart:(.+)$/)
    if (idMatch) {
      const entry = CHART_ID_MAP[idMatch[1]]
      if (entry) return renderChartButton(entry)
    }

    // ---- 3. 模糊 ID 匹配：AI 输出乱码时，在内容中搜索已知 chart ID ----
    const allChartIds = Object.keys(CHART_ID_MAP)
    for (const cid of allChartIds) {
      if (inner.includes(cid)) {
        return renderChartButton(CHART_ID_MAP[cid])
      }
    }

    // ---- 4. 中文 + 英文关键词兜底匹配 ----
    const keywordRules: [string[], string][] = [
      [['完成率', 'completion'],                       'completion-rate'],
      [['指标', '卡片', 'metrics'],                    'metrics'],
      [['用时', '时长', 'duration'],                   'task-duration'],
      [['应用使用', '应用时长', 'app-usage'],           'app-usage'],
      [['活动', '热力', '分布', 'activity', 'heatmap', 'atmap'], 'activity'],
      [['节奏', '曲线', 'rhythm'],                     'rhythm'],
      [['week-completion', '每日任务', '日完成'],        'week-completion'],
      [['week-metrics', '周汇总', '周指标'],            'week-metrics'],
      [['week-ranking', '排行'],                       'week-ranking'],
      [['week-heatmap', '周热力', '周活动'],            'week-heatmap'],
      [['week-rhythm', '周节奏'],                      'week-rhythm'],
      [['week-app-usage', '周应用', '本周应用'],         'week-app-usage'],
    ]
    for (const [keywords, id] of keywordRules) {
      if (keywords.some(kw => inner.toLowerCase().includes(kw))) {
        const entry = CHART_ID_MAP[id]
        if (entry) return renderChartButton(entry)
      }
    }

    // ---- 5. 都没匹配上：去掉【】，渲染为加粗文字 ----
    return <strong key={i} className="text-gray-700 font-semibold">{inner}</strong>
  })
}

function parseAssistantContent(
  text: string,
  onRef: (ref: VisualRef) => void,
  bubbleVisualRef?: VisualRef | null,
): React.ReactNode[] {
  const lines = sanitizeAssistantDisplayText(text).split('\n')
  const focusState = { rendered: false }
  return lines.map((line, i) => {
    const quoteMatch = line.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      return (
        <div
          key={i}
          className="my-1.5 border-l-2 border-gray-200 pl-3 py-0.5 text-gray-500"
        >
          {parseChartRefs(quoteMatch[1], onRef, focusState, bubbleVisualRef)}
        </div>
      )
    }

    return (
      <span key={i}>
        {parseChartRefs(line, onRef, focusState, bubbleVisualRef)}
        {i < lines.length - 1 ? '\n' : null}
      </span>
    )
  })
}

/** 持久化存储的聊天数据结构 */
interface SavedReflectionChat {
  bubbles: ChatBubble[]
  messages: ReflectionMessage[]
  step: number
  savedAt: number
}

export interface ReflectionChatHandle {
  /** 外部触发结束反思收尾流程（保存记忆等），完成后 resolve */
  triggerEnd: () => Promise<void>
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
  /** 当前左侧真实可高亮目标，供结构化输出从中选择 */
  visualTargets?: VisualTarget[]
  /** 图表/重点位置引用回调：当用户点击 AI 消息中的引用标签时触发 */
  onVisualRef?: (ref: VisualRef) => void
  /** 反思完成回调（用于埋点） */
  onComplete?: (summary: string) => void
  /** 结束反思并关闭侧边栏 */
  onEndChat?: () => void
}

const ReflectionChat = forwardRef<ReflectionChatHandle, ReflectionChatProps>(function ReflectionChat({
  systemPrompt,
  aiConfig,
  mode = 'daily',
  screenshotBase64,
  selectedDate,
  storageKey,
  visualTargets = [],
  onVisualRef,
  onComplete,
  onEndChat,
}, ref) {
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
  const triggeredVisualRefKeysRef = useRef<Set<string>>(new Set())
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

  const sendToAI = useCallback((
    newMessages: ReflectionMessage[],
    options: { suppressSuggestions?: boolean } = {},
  ): Promise<string | null> => {
    setLoading(true)
    setStreaming(false)
    setError(null)
    triggeredVisualRefKeysRef.current.clear()

    return new Promise((resolve) => {
      const placeholder: ChatBubble = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }
      setBubbles(prev => [...prev, placeholder])

      let settled = false
      let gotActivity = false
      let streamedText = ''
      let pendingChartFallback: {
        timer: ReturnType<typeof window.setTimeout>
        ref: Extract<VisualRef, { kind: 'chart' }>
      } | null = null
      const TIMEOUT_MS = 60_000
      const startTime = Date.now()

      const clearPendingChartFallback = () => {
        if (pendingChartFallback) {
          window.clearTimeout(pendingChartFallback.timer)
          pendingChartFallback = null
        }
      }

      const flushPendingChartFallback = () => {
        const pending = pendingChartFallback
        clearPendingChartFallback()
        if (pending && triggeredVisualRefKeysRef.current.size === 0) {
          triggerVisualRef(pending.ref, 0)
        }
      }

      const timeoutId = setTimeout(() => {
        if (settled || gotActivity) return
        settled = true
        clearPendingChartFallback()
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.warn(`[ReflectionChat] ${elapsed}s 超时，未收到任何 AI 响应。消息数: ${newMessages.length}`)
        streamCleanupRef.current?.()
        setStreaming(false)
        setLoading(false)
        setError('AI 响应超时，请稍后重试')
        setBubbles(prev => prev.slice(0, -1))
        resolve(null)
      }, TIMEOUT_MS)

      const finishAssistantMessage = (
        rawContent: string,
        visualRef: VisualRef | null,
        source: 'structured' | 'stream',
      ): string | null => {
        const content = sanitizeAssistantDisplayText(rawContent).trim()
        if (!content) return null

        if (source === 'stream' && !options.suppressSuggestions) {
          const cleanedSuggestions = extractSuggestions(rawContent)
          if (cleanedSuggestions.length > 0) {
            console.log('[ReflectionChat] 内嵌探索方向:', cleanedSuggestions)
            setSuggestions(cleanedSuggestions)
          }
        }

        setBubbles(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content, visualRef }
          }
          return updated
        })

        messagesRef.current = [
          ...newMessages,
          { role: 'assistant', content },
        ]
        persistRawMessage('assistant', content)
        return content
      }

      const attachVisualRefToBubble = (visualRef: VisualRef) => {
        setBubbles(prev => prev.map(bubble =>
          bubble.role === 'assistant' && bubble.timestamp === placeholder.timestamp
            ? { ...bubble, visualRef }
            : bubble
        ))
      }

      const triggerVisualRef = (visualRef: VisualRef, delayMs = 300): boolean => {
        const key = visualRefKey(visualRef)
        if (triggeredVisualRefKeysRef.current.has(key)) return false
        triggeredVisualRefKeysRef.current.add(key)

        attachVisualRefToBubble(visualRef)
        if (onVisualRef) {
          window.setTimeout(() => onVisualRef(visualRef), delayMs)
        }
        return true
      }

      const scheduleChartFallback = (chartRef: Extract<VisualRef, { kind: 'chart' }>) => {
        if (pendingChartFallback || triggeredVisualRefKeysRef.current.size > 0) return
        pendingChartFallback = {
          ref: chartRef,
          timer: window.setTimeout(() => {
            const pending = pendingChartFallback
            pendingChartFallback = null
            if (pending && triggeredVisualRefKeysRef.current.size === 0) {
              triggerVisualRef(pending.ref, 0)
            }
          }, STREAM_CHART_FALLBACK_DELAY_MS),
        }
      }

      const selectVisualFocusAfterStream = async (content: string, fallbackChartRef: Extract<VisualRef, { kind: 'chart' }> | null) => {
        const hasStreamTriggeredRef = triggeredVisualRefKeysRef.current.size > 0
        let visualRef: VisualRef | null = null

        if (!hasStreamTriggeredRef && visualTargets.length > 0) {
          const selected = await selectReflectionVisualFocus(content, aiConfig, visualTargets)
          visualRef = visualTargetsToVisualRef(selected.result?.visualFocusTargets ?? [])
        }

        if (visualRef) {
          triggerVisualRef(visualRef)
          return
        }

        if (!hasStreamTriggeredRef && fallbackChartRef) {
          triggerVisualRef(fallbackChartRef)
        }
      }

      void (async () => {
        chatReflectionStream(
        newMessages,
        aiConfig,
        (delta) => {
          gotActivity = true
          streamedText += delta
          const explicitRefs = parseVisualRefMarkers(streamedText, visualTargets)
          if (explicitRefs.length > 0) {
            clearPendingChartFallback()
          }
          for (const ref of explicitRefs) {
            triggerVisualRef(ref, 0)
          }
          if (triggeredVisualRefKeysRef.current.size === 0) {
            const fallbackChartRef = findFallbackChartRef(streamedText)
            if (fallbackChartRef) scheduleChartFallback(fallbackChartRef)
          }
          setStreaming(true)
          setLoading(false)
          setBubbles(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: sanitizeAssistantDisplayText(streamedText) }
            }
            return updated
          })
        },
        (fullText) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          flushPendingChartFallback()
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
            const content = finishAssistantMessage(rawContent, null, 'stream')
            if (content) {
              void selectVisualFocusAfterStream(content, findFallbackChartRef(rawContent))
            }
            resolve(content)
          }
        },
        (errMsg) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          clearPendingChartFallback()
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
      })()
    })
  }, [aiConfig, onVisualRef, visualTargets])

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

  // ---- 核心收尾逻辑（保存记忆、标记 session） ----
  const doEndChat = useCallback(async () => {
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

      const sess = rawSessionRef.current
      // 优先使用 messagesRef（还原对话时它会被正确赋值），rawSessionRef 仅在本次会话中累积
      const chatMsgs = (messagesRef.current.length > sess.messages.length
        ? messagesRef.current
        : sess.messages
      ).filter(m => {
        if (typeof m.content === 'string') return m.content.length > 0
        return Array.isArray(m.content) && m.content.length > 0
      }).filter(m => (m as { role: string }).role !== 'system')

      if (chatMsgs.length >= 2) {
        const extractPromise = extractMemoryFromChat(
          chatMsgs.map(m => ({
            role: (m as { role: 'user' | 'assistant' }).role,
            content: typeof m.content === 'string'
              ? m.content
              : (m.content as { type: string; text?: string }[]).filter(p => p.type === 'text').map(p => p.text ?? '').join(''),
          })),
          aiConfig,
        )
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
              const sessionId = `${dateStr}-${mode}`
              const existIdx = sessions.findIndex((s: { id?: string }) => s.id === sessionId)
              const entry = { id: sessionId, date: dateStr, mode, summary: result.summary, createdAt: Date.now() }
              if (existIdx >= 0) {
                sessions[existIdx] = entry
              } else {
                sessions.push(entry)
              }
              store.sessions = sessions.slice(-20)
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

      sess.status = 'processed'
      const key = storageKey || sess.date
      window.electronAPI.saveRawSession(key, sess).catch(() => {})

      setEndingState('saved')
    } catch (e) {
      console.error('[ReflectionChat] 结束反思收尾失败:', e)
    }
  }, [endingState, bubbles, onComplete, aiConfig, mode, selectedDate, storageKey])

  // ---- 按钮点击：收尾 + 延迟关闭侧边栏 ----
  const handleEndChat = useCallback(async () => {
    await doEndChat()
    setTimeout(() => { onEndChat?.() }, 600)
  }, [doEndChat, onEndChat])

  // ---- 暴露给父组件的 ref 方法 ----
  useImperativeHandle(ref, () => ({
    triggerEnd: doEndChat,
  }), [doEndChat])

  // 初始化：发送第一条 AI 消息
  useEffect(() => {
    if (!storageReady) return
    if (initCalledRef.current || chatActive || bubbles.length > 0) return
    if (!systemPrompt) return
    initCalledRef.current = true
    console.log('[ReflectionChat Init] 启动对话, systemPrompt包含记忆:', systemPrompt.includes('对话记忆'), ', prompt长度:', systemPrompt.length)

    const initMessages: ReflectionMessage[] = [
      { role: 'system', content: systemPrompt },
    ]

    if (screenshotBase64) {
      const todayStr = new Date().toISOString().slice(0, 10)
      const dateIsToday = !selectedDate || selectedDate === todayStr
      const dateLabel = dateIsToday ? '今天' : (selectedDate ?? todayStr)
      const multimodalContent: MessageContentPart[] = [
        { type: 'image_url', image_url: { url: screenshotBase64 } },
        { type: 'text', text: `上面是我${dateLabel}的数据仪表板截图，包含${dateIsToday ? '任务完成率、' : ''}核心指标卡片、任务用时条形图、活动热力图和电脑活动图。请结合这些可视化数据，开始我们的反思对话吧。` },
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

  // 发送一条用户消息；displayText 给用户看，aiText 可以携带不展示的流程语义
  const sendUserMessage = useCallback(async (
    displayText: string,
    aiText = displayText,
    source: 'input' | 'suggestion' = 'input',
  ) => {
    const text = displayText.trim()
    if (!text || !canSend) return

    const msgIdx = bubbles.filter(b => b.role === 'user').length
    tracker.track('reflect.message_sent', {
      date: rawSessionRef.current.date,
      mode: rawSessionRef.current.mode,
      messageIndex: msgIdx,
      charCount: text.length,
      source,
    })

    setSuggestions([])
    persistRawMessage('user', text)
    const userBubble: ChatBubble = { role: 'user', content: text, timestamp: Date.now() }
    setBubbles(prev => [...prev, userBubble])

    const newMessages: ReflectionMessage[] = [
      ...messagesRef.current,
      { role: 'user', content: aiText },
    ]

    await sendToAI(newMessages, { suppressSuggestions: source === 'suggestion' })
    inputRef.current?.focus()
  }, [canSend, sendToAI, persistRawMessage])

  const sendSuggestionMessage = useCallback((label: string) => {
    const scopeText = mode === 'weekly' ? '本周行为模式和历史行为记录' : '用户当天行为模式和历史行为记录'
    const aiText = [
      `用户选择了分析角度：${label}`,
      `这是 AI 基于${scopeText}发现的一个任务管理问题入口。请按这个 Tag 进入第二步：先结合相关图表、行为记录或近期记忆解释它背后可能对应的任务管理 pattern；再问 1 个开放式上下文问题，帮助用户觉察自己的任务、状态或策略；不要直接跳到建议，也不要问用户是否想聊这个。本轮只等待用户补充上下文，禁止输出 SUGGESTIONS 注释，禁止生成新的探索方向。`,
    ].join('\n')
    sendUserMessage(label, aiText, 'suggestion')
  }, [mode, sendUserMessage])

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
                  ) : b.role === 'assistant' && onVisualRef
                    ? parseAssistantContent(b.content, onVisualRef, b.visualRef)
                    : b.role === 'assistant'
                      ? sanitizeAssistantDisplayText(b.content)
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
          <div className="pl-1 space-y-2">
            <div className="text-[11px] text-gray-400">
              几个或许值得探索的方向：
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendSuggestionMessage(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200
                             bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300
                             hover:text-gray-800 transition-all cursor-pointer
                             leading-snug text-left"
                >
                  {q}
                </button>
              ))}
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
})

export default ReflectionChat
