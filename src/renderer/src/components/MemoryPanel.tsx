/**
 * MemoryPanel —— AI 记忆管理面板
 *
 * 让用户查看系统从反思对话中提炼的摘要和承诺，
 * 并可以删除不想保留的条目。
 * 遵循原则：Memory 应该可见、可删、可纠正。
 */

import { useState, useEffect, useCallback } from 'react'
import { tracker } from '../services/tracker'

interface SessionItem {
  id: string
  date: string
  mode: 'daily' | 'weekly'
  summary: string
  createdAt: number
}

interface CommitmentItem {
  id: string
  text: string
  sourceDate: string
  status: string
  createdAt: number
}

interface MemoryStore {
  sessions: SessionItem[]
  commitments: CommitmentItem[]
  lastUpdated: number
}

interface MemoryPanelProps {
  visible: boolean
  onClose: () => void
}

const EMPTY_STORE: MemoryStore = { sessions: [], commitments: [], lastUpdated: 0 }

export default function MemoryPanel({ visible, onClose }: MemoryPanelProps) {
  const [store, setStore] = useState<MemoryStore>(EMPTY_STORE)
  const [loading, setLoading] = useState(true)

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
      const raw = await window.electronAPI.loadMemoryStore()
      if (raw && typeof raw === 'object') {
        const s = raw as MemoryStore
        setStore({
          sessions: Array.isArray(s.sessions) ? s.sessions : [],
          commitments: Array.isArray(s.commitments) ? s.commitments : [],
          lastUpdated: s.lastUpdated || 0,
        })
      }
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

  const sessions = [...store.sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  const commitments = [...store.commitments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  const isEmpty = sessions.length === 0 && commitments.length === 0

  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000

  const handleDelete = async (type: 'session' | 'commitment', id: string) => {
    tracker.track('memory.deleted', { type, itemId: id })
    setDeletedId(id)

    setTimeout(async () => {
      try {
        const fresh = await window.electronAPI.loadMemoryStore() as MemoryStore | null
        if (!fresh) return

        const updated: MemoryStore = {
          sessions: type === 'session'
            ? (fresh.sessions || []).filter(s => s.id !== id)
            : (fresh.sessions || []),
          commitments: type === 'commitment'
            ? (fresh.commitments || []).filter(c => c.id !== id)
            : (fresh.commitments || []),
          lastUpdated: Date.now(),
        }

        await window.electronAPI.saveMemoryStore(updated)
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

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 pb-5">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-400">加载中...</div>
          ) : isEmpty ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-400">还没有记忆</p>
              <p className="text-xs text-gray-300 mt-1">完成一次反思对话后就会出现</p>
            </div>
          ) : (
            <>
              {/* 反思摘要 */}
              {sessions.length > 0 && (
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
                        <button
                          onClick={() => handleDelete('session', s.id)}
                          className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
                                     text-gray-300 opacity-0 group-hover:opacity-100
                                     hover:text-red-400 hover:bg-red-50 transition-all"
                          title="删除这条摘要"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 分割线 */}
              {sessions.length > 0 && commitments.length > 0 && (
                <div className="border-t border-gray-100 my-4" />
              )}

              {/* 想法与承诺 */}
              {commitments.length > 0 && (
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
                          <button
                            onClick={() => handleDelete('commitment', c.id)}
                            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center
                                       text-gray-300 opacity-0 group-hover:opacity-100
                                       hover:text-red-400 hover:bg-red-50 transition-all"
                            title="删除这条承诺"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
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

