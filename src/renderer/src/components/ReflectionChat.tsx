/**
 * ReflectionChat —— AI 反思对话窗
 *
 * 开放式反思对话，围绕元认知四个方向自然推进
 * 对话历史在组件内管理
 */

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { tracker } from '../services/tracker'
import type { AIConfig, ReflectionMessage, MessageContentPart, ReflectionStyle, VisualTarget } from '../services/ai'
import { chatReflectionStream, extractMemoryFromChat, generateSuggestions, getReflectionTagBank, selectReflectionVisualFocus } from '../services/ai'
import { recordReflectionMemory } from '../services/memory-manager'

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
  'week-app-usage':  { domId: 'chart-week-app-usage',  label: '周应用使用时长' },
}

const STREAM_CHART_FALLBACK_DELAY_MS = 700
const SUGGESTIONS_PER_PAGE = 3

const FALLBACK_SUGGESTIONS: Record<'daily' | 'weekly', string[]> = {
  daily: ['哪些做法值得保留？', '哪些任务还停在计划里？', '电脑开着时在做什么？'],
  weekly: ['哪些做法值得保留？', '哪些任务还停在计划里？', '电脑开着时在做什么？'],
}

type FreeReflectionIntent =
  | 'topic_entry'
  | 'emotion_first'
  | 'emotion_source'
  | 'stuck_soften'
  | 'data_guided'
  | 'extract_strategy'
  | 'small_experiment'
  | 'gentle_close'
  | 'open_reflection'

function hasAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword))
}

function detectFreeReflectionIntent(text: string, source: 'input' | 'suggestion'): FreeReflectionIntent {
  const normalized = text.trim().toLowerCase()
  if (source === 'suggestion') return 'topic_entry'
  if (hasAny(normalized, ['差不多', '结束', '先这样', '可以了', '不用了', '没了'])) return 'gentle_close'
  if (hasAny(normalized, ['怎么办', '怎么做', '有什么办法', '有啥办法', '建议', '小招'])) return 'small_experiment'
  if (hasAny(normalized, ['不知道聊什么', '不知道说什么', '不知道', '随便', '都行', '没想法'])) return 'data_guided'

  const hasEmotion = hasAny(normalized, ['情绪', '烦', '累', '焦虑', '低落', '难受', '压力', '不想做', '没动力', '崩'])
  if (hasEmotion) {
    return hasAny(normalized, ['因为', '来自', '原因', '就是', '从', '开始前', '做着做着'])
      ? 'emotion_source'
      : 'emotion_first'
  }

  if (hasAny(normalized, ['卡住', '做不下去', '拖', '压力大', '太难', '接不上'])) return 'stuck_soften'
  if (hasAny(normalized, ['子任务', '小任务', '拆', '先打开', '先做', '启动', '做完', '完成'])) return 'extract_strategy'
  return 'open_reflection'
}

function buildFreeReflectionDirectorInstruction(
  text: string,
  source: 'input' | 'suggestion',
  mode: 'daily' | 'weekly',
): string {
  const intent = detectFreeReflectionIntent(text, source)
  const nextLabel = mode === 'weekly' ? '下周' : '下次'
  const dataLabel = mode === 'weekly' ? '周数据' : '当天数据'

  const instructionMap: Record<FreeReflectionIntent, string> = {
    topic_entry: `用户只是选择了一个探索方向。先用 1 个${dataLabel}线索解释这个方向为什么值得看；如果还缺背景，只轻问 1 个问题，不要给建议。`,
    emotion_first: '用户正在主动表达情绪。本轮只做“接住情绪 + 轻问感受来源”，不要立刻夸完成、分析效率或给建议。',
    emotion_source: `用户已经补充了一点情绪来源。先承接原话，再连接 1 个${dataLabel}线索，帮助用户看见情绪下仍能动起来的条件；如果背景足够，可以提取 1 个可保留做法。`,
    stuck_soften: `用户在说困难或卡住。本轮不要问“为什么卡住”，把问题变轻：围绕${nextLabel}怎么少费点劲、哪一部分需要变小来回应。`,
    data_guided: '用户没有明确话题或能量较低。本轮不要追问，降低负担，并提示可以看下面标准方向或换一批。',
    extract_strategy: `用户提到可能有效的做法。本轮优先提取成${nextLabel}可保留的小做法，不问“怎么想到的”。`,
    small_experiment: `用户主动问怎么办。本轮可以直接给 1 个低压力小实验，动作要小、具体、可尝试，不要给一整套方法。`,
    gentle_close: '用户可能想结束。本轮用 1-2 句话收束成一个小发现，不挽留、不生成新问题。',
    open_reflection: `用户在自由补充。本轮先判断是否有可见模式；能总结就总结，确实缺关键信息才问 1 个能帮助${nextLabel}更容易开始/继续/恢复的问题。`,
  }

  return [
    '【自由反思调度】',
    `前端轻量判断：${intent}。这只是内部对话管理指令，不要在正文提到。`,
    instructionMap[intent],
    '本轮只能选择一个核心动作。不要写成“承接 + 数据 + 建议 + 鼓励”的固定四段。',
  ].join('\n')
}

function buildSuggestionPool(items: string[], mode: 'daily' | 'weekly', allowStandardFill: boolean): string[] {
  const standardTags = getReflectionTagBank(mode)
  const standardSet = new Set(standardTags)
  const normalized = items
    .map(cleanSuggestionLabel)
    .filter((item): item is string => Boolean(item))
    .filter(item => standardSet.has(item))

  const pool = Array.from(new Set(normalized))
  if (allowStandardFill && pool.length > 0) {
    for (const tag of standardTags) {
      if (pool.length >= 9) break
      if (!pool.includes(tag)) pool.push(tag)
    }
  }

  return pool.slice(0, 9)
}

function getSuggestionPage(pool: string[], page: number): string[] {
  if (pool.length === 0) return []
  const pageCount = Math.max(Math.ceil(pool.length / SUGGESTIONS_PER_PAGE), 1)
  const start = (page % pageCount) * SUGGESTIONS_PER_PAGE
  const batch = pool.slice(start, start + SUGGESTIONS_PER_PAGE)
  return batch.length > 0 ? batch : pool.slice(0, SUGGESTIONS_PER_PAGE)
}

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

  // 模型偶尔会把隐藏注释写坏，例如 "<!--SUG这周前半段GESTIONS..."。
  // 只要控制注释开始泄漏到正文，就从显示文本中截掉，避免暴露协议细节。
  const commentStart = cleaned.search(/<!--|<!|<\s*!--/i)
  if (commentStart >= 0) {
    cleaned = cleaned.slice(0, commentStart)
  }

  const brokenSuggestionsStart = cleaned.search(/SUG[\s\S]{0,80}?GESTIONS\s*:/i)
  if (brokenSuggestionsStart >= 0) {
    cleaned = cleaned.slice(0, brokenSuggestionsStart)
  }

  cleaned = cleaned
    .replace(/<!--\s*SUGGESTIONS:[\s\S]*?-->/gi, '')
    .replace(/^\s*.*SUGGESTIONS\s*:.*$/gim, '')
    .replace(/^\s*.*VISUAL_REF\s*:.*$/gim, '')
    .replace(/^\s*【\s*chart(?::[A-Za-z-]*)?\s*$/gim, '')
    .replace(/【\s*chart(?::[A-Za-z-]*)?$/gim, '')
    .replace(/^\s*【\s*focus(?::[^】]*)?\s*$/gim, '')
    .replace(/【\s*focus(?::[^】]*)?$/gim, '')

  // 把 3 个及以上连续换行压缩为 2 个，保证段落间距统一
  cleaned = normalizeNumberedChartRefs(cleaned).replace(/\n{3,}/g, '\n\n')
  return cleaned.trimEnd()
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

function visualTextContainsCandidate(text: string, candidate?: string): boolean {
  const normalizedText = text.trim().toLowerCase()
  const normalizedCandidate = candidate?.trim().toLowerCase()
  if (!normalizedText || !normalizedCandidate) return false

  return normalizedText.includes(normalizedCandidate) ||
    normalizedText.replace(/\s+/g, '').includes(normalizedCandidate.replace(/\s+/g, ''))
}

function visualRefMatchesAssistantText(ref: VisualRef, text: string): boolean {
  const visibleText = sanitizeAssistantDisplayText(text)
  if (ref.kind === 'multi-focus') {
    return ref.refs.every(item => visualRefMatchesAssistantText(item, visibleText))
  }
  if (ref.kind !== 'focus') return true
  if (ref.focusType !== 'app-usage' && ref.focusType !== 'task-duration') return true

  return visualTextContainsCandidate(visibleText, ref.value) ||
    visualTextContainsCandidate(visibleText, ref.label)
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
        if (ref && visualRefMatchesAssistantText(ref, text)) refs.push(ref)
        continue
      }

      if (typeof payload.chartId === 'string') {
        const ref = chartIdToRef(payload.chartId)
        if (ref && hasLocalVisualTargets(ref.chartId, visualTargets)) continue
        if (ref) refs.push(ref)
      }
    } catch (e) {
      console.warn('[ReflectionChat] VISUAL_REF 标记解析失败:', e, match[1])
    }
  }

  return refs
}

function hasLocalVisualTargets(chartId: string, visualTargets: VisualTarget[]): boolean {
  return visualTargets.some(target => target.chartId === chartId)
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

function hasSuggestionMarkerIntent(rawText: string): boolean {
  return /<!--\s*SUG/i.test(rawText) || /SUG[\s\S]{0,80}?GESTIONS\s*:/i.test(rawText)
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
    .replace(/^\d{1,2}[点:：].*(学习|任务|推进|效率).*$/g, '哪些时间效率较高？')
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
  /** 对话结构：默认三段式 or 自由反思模式 */
  reflectionStyle?: ReflectionStyle
  /** 切换对话结构 */
  onReflectionStyleChange?: (style: ReflectionStyle) => void
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
  reflectionStyle = 'structured',
  onReflectionStyleChange,
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
  const [suggestionPool, setSuggestionPool] = useState<string[]>([])
  const [suggestionPage, setSuggestionPage] = useState(0)
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
    window.electronAPI.saveAIConversation({
      conversationId: `reflection-${key}`,
      conversationType: 'reflection',
      date: session.date,
      logicalDate: session.date,
      mode: session.mode,
      status: session.status,
      startedAt: session.startedAt,
      savedAt: Date.now(),
      messages: session.messages,
      metadata: { storageKey: key },
    }).catch(e => console.warn('[Conversation] 反思对话保存失败:', e))
  }, [storageKey])

  const applySuggestionPool = useCallback((items: string[], allowStandardFill = true) => {
    const pool = buildSuggestionPool(items, mode, allowStandardFill)
    setSuggestionPool(pool)
    setSuggestionPage(0)
    setSuggestions(getSuggestionPage(pool, 0))
  }, [mode])

  const clearSuggestions = useCallback(() => {
    setSuggestionPool([])
    setSuggestionPage(0)
    setSuggestions([])
  }, [])

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
        timer: number
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
            applySuggestionPool(cleanedSuggestions)
          } else {
            const shouldFallbackOnEmpty = hasSuggestionMarkerIntent(rawContent)
            void generateSuggestions(
              [
                ...newMessages,
                { role: 'assistant', content },
              ],
              aiConfig,
              mode,
              reflectionStyle,
            ).then(generated => {
              const nextSuggestions = generated.length > 0
                ? generated
                : shouldFallbackOnEmpty && reflectionStyle === 'structured' ? FALLBACK_SUGGESTIONS[mode] : []
              applySuggestionPool(nextSuggestions)
            }).catch(error => {
              console.warn('[ReflectionChat] 探索方向兜底生成失败:', error)
              applySuggestionPool(shouldFallbackOnEmpty && reflectionStyle === 'structured'
                ? FALLBACK_SUGGESTIONS[mode]
                : [])
            })
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
        if (hasLocalVisualTargets(chartRef.chartId, visualTargets)) return
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
          if (visualRef && !visualRefMatchesAssistantText(visualRef, content)) {
            visualRef = null
          }
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
  }, [aiConfig, applySuggestionPool, mode, onVisualRef, reflectionStyle, visualTargets])

  useEffect(() => {
    if (messagesRef.current[0]?.role === 'system') {
      messagesRef.current = [
        { role: 'system', content: systemPrompt },
        ...messagesRef.current.slice(1),
      ]
    }
  }, [systemPrompt])

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
    clearSuggestions()
    initCalledRef.current = false
    setRestartKey(k => k + 1)
  }, [clearSuggestions, storageKey])

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
    }, {
      date: session.date,
      logicalDate: session.date,
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
            await recordReflectionMemory(result, { date: dateStr, mode })
            console.log('[Memory] 记忆已保存:', result.summary?.slice(0, 50), result.commitments)
          } catch (e) {
            console.warn('[Memory] 保存记忆失败:', e)
          }
        }
      }

      sess.status = 'processed'
      const key = storageKey || sess.date
      window.electronAPI.saveRawSession(key, sess).catch(() => {})
      window.electronAPI.saveAIConversation({
        conversationId: `reflection-${key}`,
        conversationType: 'reflection',
        date: sess.date,
        logicalDate: sess.date,
        mode: sess.mode,
        status: sess.status,
        startedAt: sess.startedAt,
        endedAt: Date.now(),
        savedAt: Date.now(),
        messages: sess.messages,
        metadata: { storageKey: key },
      }).catch(() => {})

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
  const canRerollSuggestions = suggestionPool.length > SUGGESTIONS_PER_PAGE

  const handleRerollSuggestions = useCallback(() => {
    if (suggestionPool.length <= SUGGESTIONS_PER_PAGE) return
    const nextPage = suggestionPage + 1
    setSuggestionPage(nextPage)
    setSuggestions(getSuggestionPage(suggestionPool, nextPage))
  }, [suggestionPage, suggestionPool])

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
    }, {
      date: rawSessionRef.current.date,
      logicalDate: rawSessionRef.current.date,
    })

    clearSuggestions()
    persistRawMessage('user', text)
    const userBubble: ChatBubble = { role: 'user', content: text, timestamp: Date.now() }
    setBubbles(prev => [...prev, userBubble])

    const messageForAI = reflectionStyle === 'free'
      ? `${aiText}\n\n${buildFreeReflectionDirectorInstruction(text, source, mode)}`
      : aiText

    const newMessages: ReflectionMessage[] = [
      ...messagesRef.current,
      { role: 'user', content: messageForAI },
    ]

    await sendToAI(newMessages, { suppressSuggestions: source === 'suggestion' })
    inputRef.current?.focus()
  }, [canSend, clearSuggestions, mode, reflectionStyle, sendToAI, persistRawMessage])

  const sendSuggestionMessage = useCallback((label: string) => {
    const scopeText = mode === 'weekly' ? '本周行为模式和历史行为记录' : '用户当天行为模式和历史行为记录'
    const aiText = reflectionStyle === 'free'
      ? [
        `用户想顺着这个话题聊：${label}`,
        `这个话题来自${scopeText}里的一个可探索线索。请像自然聊天一样回应：如果用户还没给背景，只解释 1 个最相关的数据现象并问 1 个轻问题；如果用户主动问怎么办或背景已经足够，只给 1 个低压力小实验；如果已经有清楚发现，就温和收束。每轮只做一个核心动作，不要把它当成固定第二步。`,
      ].join('\n')
      : [
        `用户选择了分析角度：${label}`,
        `这是 AI 基于${scopeText}发现的一个任务管理问题入口。请按这个 Tag 进入第二步：先结合相关图表、行为记录或近期记忆解释它背后可能对应的任务管理 pattern；再问 1 个开放式上下文问题，帮助用户觉察自己的任务、状态或策略；不要直接跳到建议，也不要问用户是否想聊这个。本轮只等待用户补充上下文，禁止输出 SUGGESTIONS 注释，禁止生成新的探索方向。`,
      ].join('\n')
    sendUserMessage(label, aiText, 'suggestion')
  }, [mode, reflectionStyle, sendUserMessage])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendUserMessage(text)
  }

  const endButtonLabel = endingState === 'saving' ? '正在保存记忆...'
    : endingState === 'saved' ? '已保存' : '结束复盘'

  return (
    <div className="flex flex-col h-full">
      {/* 顶栏：结束复盘按钮 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">
            AI助手
          </span>
          <button
            type="button"
            onClick={() => onReflectionStyleChange?.(reflectionStyle === 'free' ? 'structured' : 'free')}
            className={`group relative inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              reflectionStyle === 'free'
                ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}
            title="关闭时按稳定三段式复盘；打开后 AI 会更自由地判断什么时候追问、建议或继续给新方向。"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${reflectionStyle === 'free' ? 'bg-indigo-500' : 'bg-gray-300'}`} />
            自由反思
          </button>
        </div>
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
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <span>可以聊聊这几个方向：</span>
              {canRerollSuggestions && (
                <button
                  type="button"
                  onClick={handleRerollSuggestions}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title="换一批方向"
                  aria-label="换一批方向"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6.5A6.5 6.5 0 0 0 5.1 4.3L3.5 6" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 3.5V6h2.5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 13.5a6.5 6.5 0 0 0 11.4 2.2L16.5 14" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 16.5V14H14" />
                  </svg>
                </button>
              )}
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
