/**
 * MemoryPanel —— AI 记忆管理面板
 *
 * 让用户查看系统从反思对话中提炼的摘要和承诺，
 * 并可以删除不想保留的条目。
 * 遵循原则：Memory 应该可见、可删、可纠正。
 */

import { useState, useEffect, useCallback } from 'react'
import { tracker } from '../services/tracker'
import {
  deleteMemoryItem,
  loadMemory,
  type MemoryItemType,
  type MemoryStore,
} from '../services/memory-manager'

interface MemoryPanelProps {
  visible: boolean
  onClose: () => void
}

type MemoryTab = 'all' | 'planning' | 'execution' | 'reflection'

const MEMORY_TABS: { id: MemoryTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'planning', label: '计划' },
  { id: 'execution', label: '执行' },
  { id: 'reflection', label: '反思' },
]

const EMPTY_STORE: MemoryStore = {
  sessions: [],
  commitments: [],
  firstSteps: [],
  stableFirstSteps: [],
  stuckReasons: [],
  hintFeedback: [],
  lastUpdated: 0,
}

export default function MemoryPanel({ visible, onClose }: MemoryPanelProps) {
  const [store, setStore] = useState<MemoryStore>(EMPTY_STORE)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<MemoryTab>('all')

  useEffect(() => {
    const styleId = 'memory-panel-anim'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes memoryPanelFadeIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `
      document.head.appendChild(style)
    }
  }, [])
  const [deletedId, setDeletedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setStore(await loadMemory())
    } catch (e) {
      console.warn('[MemoryPanel] 加载失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) loadData()
  }, [visible, loadData])

  if (!visible) return null

  const firstStepId = (item: { date: string; taskTitle: string; microAction: string }, index: number) =>
    `${item.date}|${item.taskTitle}|${item.microAction}|${index}`
  const stableFirstStepId = (item: { taskKey: string; microAction: string }) =>
    `${item.taskKey}|${item.microAction}`
  const stuckReasonId = (item: { date: string; taskTitle: string; microAction: string }, index: number) =>
    `${item.date}|${item.taskTitle}|${item.microAction}|${index}`
  const hintFeedbackId = (item: { date: string; taskTitle: string; hintText: string }, index: number) =>
    `${item.date}|${item.taskTitle}|${item.hintText}|${index}`

  const sessions = [...store.sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  const commitments = [...store.commitments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  const stableFirstSteps = [...store.stableFirstSteps]
    .map(item => ({ ...item, itemId: stableFirstStepId(item) }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
  const firstSteps = store.firstSteps
    .map((item, index) => ({ ...item, itemId: firstStepId(item, index) }))
    .slice(0, 8)
  const stuckReasons = store.stuckReasons
    .map((item, index) => ({ ...item, itemId: stuckReasonId(item, index) }))
    .slice(-10)
    .reverse()
  const hintFeedback = store.hintFeedback
    .map((item, index) => ({ ...item, itemId: hintFeedbackId(item, index) }))
    .slice(-8)
    .reverse()
  const isEmpty = sessions.length === 0 &&
    commitments.length === 0 &&
    stableFirstSteps.length === 0 &&
    firstSteps.length === 0 &&
    stuckReasons.length === 0 &&
    hintFeedback.length === 0
  const tabCounts: Record<MemoryTab, number> = {
    all: sessions.length + commitments.length + stableFirstSteps.length + firstSteps.length + stuckReasons.length + hintFeedback.length,
    planning: stableFirstSteps.length + firstSteps.length,
    execution: stuckReasons.length + hintFeedback.length,
    reflection: sessions.length + commitments.length,
  }
  const showAll = activeTab === 'all'
  const showPlanning = showAll || activeTab === 'planning'
  const showExecution = showAll || activeTab === 'execution'
  const showReflection = showAll || activeTab === 'reflection'
  const hasPlanning = tabCounts.planning > 0
  const hasExecution = tabCounts.execution > 0
  const hasReflection = tabCounts.reflection > 0
  const activeTabEmpty = !isEmpty && tabCounts[activeTab] === 0
  const emptyMessageByTab: Record<MemoryTab, string> = {
    all: '还没有记忆',
    planning: '计划阶段还没有记忆',
    execution: '执行阶段还没有记忆',
    reflection: '反思阶段还没有记忆',
  }
  const emptyHintByTab: Record<MemoryTab, string> = {
    all: '开始、执行或反思任务后就会出现',
    planning: '选择第一步后会沉淀启动偏好',
    execution: '提交卡住原因或提示反馈后会出现',
    reflection: '完成反思对话后会出现摘要和承诺',
  }

  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000

  const handleDelete = async (type: MemoryItemType, id: string) => {
    if (type === 'session' || type === 'commitment') {
      tracker.track('memory.deleted', { type, itemId: id })
    }
    setDeletedId(id)

    setTimeout(async () => {
      try {
        const updated = await deleteMemoryItem(type, id)
        setStore(updated)
      } catch (e) {
        console.warn('[MemoryPanel] 删除失败:', e)
      } finally {
        setDeletedId(null)
      }
    }, 300)
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (date: string, mode?: string) => {
    const modeLabel = mode === 'weekly' ? '周反思' : '日反思'
    const parts = date.split('-')
    if (parts.length === 3) {
      return `${parseInt(parts[1])}/${parseInt(parts[2])} ${modeLabel}`
    }
    return `${date} ${modeLabel}`
  }

  const formatCommitmentDate = (date: string) => {
    const parts = date.split('-')
    if (parts.length === 3) return `${parseInt(parts[1])}/${parseInt(parts[2])}`
    return date
  }

  const DeleteButton = ({ type, id, title }: { type: MemoryItemType; id: string; title: string }) => (
    <button
      onClick={() => handleDelete(type, id)}
      className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
                 text-gray-300 opacity-0 group-hover:opacity-100
                 hover:text-red-400 hover:bg-red-50 transition-all"
      title={title}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div
        className="relative z-10 w-[440px] max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ animation: 'memoryPanelFadeIn 0.15s ease-out' }}
      >
        {/* 标题栏 */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </span>
              AI 记忆
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              系统从你的反思对话中记住的要点，你可以随时删除。
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!loading && !isEmpty && (
          <div className="px-6 pb-3 flex-shrink-0">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-gray-50 p-1">
              {MEMORY_TABS.map(tab => {
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`h-8 rounded-lg text-xs font-medium transition-all ${
                      active
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`ml-1 ${active ? 'text-indigo-400' : 'text-gray-300'}`}>
                      {tabCounts[tab.id]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 pb-5">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">加载中...</div>
          ) : isEmpty || activeTabEmpty ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-400">{emptyMessageByTab[activeTab]}</p>
              <p className="text-xs text-gray-300 mt-1">{emptyHintByTab[activeTab]}</p>
            </div>
          ) : (
            <>
              {/* 计划阶段 */}
              {showPlanning && hasPlanning && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">计划阶段</h4>
                  <p className="text-xs text-gray-400 mb-3">你通常如何启动任务</p>
                  <div className="space-y-2">
                    {stableFirstSteps.map(item => (
                      <div
                        key={item.itemId}
                        className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all ${
                          deletedId === item.itemId ? 'opacity-0 scale-95 transition-all duration-300' : ''
                        }`}
                      >
                        <span className="flex-shrink-0 text-xs text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md mt-0.5 whitespace-nowrap">
                          稳定
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 leading-relaxed">
                            类似「{item.taskExamples[0] ?? item.taskKey}」时，常用第一步：{item.microAction}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            使用 {item.count} 次 · 置信度 {Math.round(item.confidence * 100)}%
                          </p>
                        </div>
                        <DeleteButton type="stableFirstStep" id={item.itemId} title="删除这条启动偏好" />
                      </div>
                    ))}
                    {firstSteps.map(item => (
                      <div
                        key={item.itemId}
                        className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all ${
                          deletedId === item.itemId ? 'opacity-0 scale-95 transition-all duration-300' : ''
                        }`}
                      >
                        <span className="flex-shrink-0 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md mt-0.5 whitespace-nowrap">
                          {formatCommitmentDate(item.date)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 leading-relaxed">{item.taskTitle}</p>
                          <p className="text-xs text-gray-400 mt-1">第一步：{item.microAction}</p>
                        </div>
                        <DeleteButton type="firstStep" id={item.itemId} title="删除这条第一步记录" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showAll && hasPlanning && (hasExecution || hasReflection) && (
                  <div className="border-t border-gray-100 my-4" />
                )}

              {/* 执行阶段 */}
              {showExecution && hasExecution && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">执行阶段</h4>
                  <p className="text-xs text-gray-400 mb-3">任务执行时的卡点和提示反馈</p>
                  <div className="space-y-2">
                    {stuckReasons.map(item => (
                      <div
                        key={item.itemId}
                        className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all ${
                          deletedId === item.itemId ? 'opacity-0 scale-95 transition-all duration-300' : ''
                        }`}
                      >
                        <span className="flex-shrink-0 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md mt-0.5 whitespace-nowrap">
                          卡住
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 leading-relaxed">{item.reason}</p>
                          <p className="text-xs text-gray-400 mt-1">{formatCommitmentDate(item.date)} · {item.taskTitle} / {item.microAction}</p>
                        </div>
                        <DeleteButton type="stuckReason" id={item.itemId} title="删除这条卡住记录" />
                      </div>
                    ))}
                    {hintFeedback.map(item => (
                      <div
                        key={item.itemId}
                        className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all ${
                          deletedId === item.itemId ? 'opacity-0 scale-95 transition-all duration-300' : ''
                        }`}
                      >
                        <span className="flex-shrink-0 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md mt-0.5 whitespace-nowrap">
                          {item.feedback === 'up' ? '有用' : '无效'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 leading-relaxed">{item.hintText}</p>
                          <p className="text-xs text-gray-400 mt-1">{formatCommitmentDate(item.date)} · {item.taskTitle}</p>
                        </div>
                        <DeleteButton type="hintFeedback" id={item.itemId} title="删除这条提示反馈" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showAll && hasExecution && hasReflection && (
                <div className="border-t border-gray-100 my-4" />
              )}

              {/* 反思摘要 */}
              {showReflection && sessions.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">反思摘要</h4>
                  <p className="text-xs text-gray-400 mb-3">每次反思对话中提炼的要点</p>
                  <div className="space-y-2">
                    {sessions.map(s => (
                      <div
                        key={s.id}
                        className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all ${
                          deletedId === s.id ? 'opacity-0 scale-95 transition-all duration-300' : ''
                        }`}
                      >
                        <span className="flex-shrink-0 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md mt-0.5 whitespace-nowrap">
                          {formatDate(s.date, s.mode)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p
                            onClick={() => toggleExpand(s.id)}
                            className={`text-sm text-gray-700 leading-relaxed cursor-pointer ${
                              expandedIds.has(s.id) ? '' : 'line-clamp-2'
                            }`}
                          >
                            {s.summary}
                          </p>
                          {s.summary.length > 60 && (
                            <button
                              onClick={() => toggleExpand(s.id)}
                              className="text-xs text-indigo-400 hover:text-indigo-600 mt-1 transition-colors"
                            >
                              {expandedIds.has(s.id) ? '收起' : '展开全文'}
                            </button>
                          )}
                        </div>
                        <DeleteButton type="session" id={s.id} title="删除这条摘要" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 分割线 */}
              {showReflection && sessions.length > 0 && commitments.length > 0 && (
                <div className="border-t border-gray-100 my-4" />
              )}

              {/* 想法与承诺 */}
              {showReflection && commitments.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">想法与承诺</h4>
                  <p className="text-xs text-gray-400 mb-3">你在反思时提到过想尝试的事</p>
                  <div className="space-y-2">
                    {commitments.map(c => {
                      const isOld = c.createdAt < threeDaysAgo
                      return (
                        <div
                          key={c.id}
                          className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all ${
                            deletedId === c.id ? 'opacity-0 scale-95 transition-all duration-300' : ''
                          } ${isOld ? 'opacity-60' : ''}`}
                        >
                          <span className="flex-shrink-0 text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md mt-0.5 whitespace-nowrap">
                            {formatCommitmentDate(c.sourceDate)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p
                              onClick={() => toggleExpand(c.id)}
                              className={`text-sm leading-relaxed cursor-pointer ${
                                isOld ? 'text-gray-400' : 'text-gray-700'
                              } ${expandedIds.has(c.id) ? '' : 'line-clamp-2'}`}
                            >
                              {c.text}
                            </p>
                            {c.text.length > 60 && (
                              <button
                                onClick={() => toggleExpand(c.id)}
                                className="text-xs text-indigo-400 hover:text-indigo-600 mt-1 transition-colors"
                              >
                                {expandedIds.has(c.id) ? '收起' : '展开全文'}
                              </button>
                            )}
                          </div>
                          <DeleteButton type="commitment" id={c.id} title="删除这条承诺" />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

