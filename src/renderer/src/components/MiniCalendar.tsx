/**
 * MiniCalendar —— 轻量日历弹窗组件
 *
 * 点击日期文字时弹出，支持：
 *   - 按月翻页（不能超过今天所在月份）
 *   - 点击任意历史日期跳转
 *   - "回到今天" 快捷按钮
 *   - 点击外部自动关闭
 */

import React, { useState, useRef, useEffect } from 'react'

// ===================== 工具函数 =====================

/** 获取今天的 YYYY-MM-DD 字符串 */
function getTodayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 格式化为 YYYY-MM-DD（month 是 0-based） */
function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ===================== 组件 =====================

interface MiniCalendarProps {
  /** 当前选中的日期 YYYY-MM-DD */
  selectedDate: string
  /** 用户点击某一天时触发 */
  onSelect: (date: string) => void
  /** 关闭日历弹窗 */
  onClose: () => void
}

const MiniCalendar = React.forwardRef<HTMLDivElement, MiniCalendarProps>(
  function MiniCalendar({ selectedDate, onSelect, onClose }, ref) {
    const today = getTodayStr()
    const selDate = new Date(selectedDate + 'T00:00:00')
    const [viewYear, setViewYear] = useState(selDate.getFullYear())
    const [viewMonth, setViewMonth] = useState(selDate.getMonth()) // 0-based

    // 点击外部关闭
    const containerRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
      const handle = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          onClose()
        }
      }
      // 延迟注册，避免打开时的点击立即触发关闭
      const timer = setTimeout(() => document.addEventListener('mousedown', handle), 50)
      return () => {
        clearTimeout(timer)
        document.removeEventListener('mousedown', handle)
      }
    }, [onClose])

    // 上一月
    const prevMonth = () => {
      if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
      else setViewMonth(m => m - 1)
    }

    // 下一月（不能超过当前月）
    const todayDate = new Date()
    const canGoNext = viewYear < todayDate.getFullYear() ||
      (viewYear === todayDate.getFullYear() && viewMonth < todayDate.getMonth())
    const nextMonth = () => {
      if (!canGoNext) return
      if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
      else setViewMonth(m => m + 1)
    }

    // 构建日历网格
    const firstDay = new Date(viewYear, viewMonth, 1).getDay() // 0=周日
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

    const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
    const monthLabel = `${viewYear}年${viewMonth + 1}月`

    // 构建网格单元格
    const cells: Array<{ day: number; inMonth: boolean; dateStr: string; isFuture: boolean }> = []

    // 上月尾部填充
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const m = viewMonth === 0 ? 11 : viewMonth - 1
      const y = viewMonth === 0 ? viewYear - 1 : viewYear
      cells.push({ day: d, inMonth: false, dateStr: toDateStr(y, m, d), isFuture: false })
    }
    // 当月日期
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = toDateStr(viewYear, viewMonth, d)
      cells.push({ day: d, inMonth: true, dateStr: ds, isFuture: ds > today })
    }
    // 下月头部填充（补满到当前行结束）
    const remaining = 7 - (cells.length % 7)
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const m = viewMonth === 11 ? 0 : viewMonth + 1
        const y = viewMonth === 11 ? viewYear + 1 : viewYear
        cells.push({ day: d, inMonth: false, dateStr: toDateStr(y, m, d), isFuture: toDateStr(y, m, d) > today })
      }
    }

    return (
      <div
        ref={(node) => {
          (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
        }}
        className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50
                   bg-white rounded-2xl shadow-xl border border-gray-200
                   p-3 w-[280px]"
        style={{ animation: 'calendarFadeIn 0.15s ease-out' }}
      >
        {/* 月份切换头部 */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={prevMonth}
            className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center
                       text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-700">{monthLabel}</span>
          <button
            onClick={nextMonth}
            disabled={!canGoNext}
            className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center
                       text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* 星期标头 */}
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAY_LABELS.map(w => (
            <div key={w} className="text-center text-[10px] text-gray-400 font-medium py-1">{w}</div>
          ))}
        </div>

        {/* 日期网格 */}
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const isSelected = cell.dateStr === selectedDate
            const isTodayCell = cell.dateStr === today
            const disabled = cell.isFuture || !cell.inMonth
            return (
              <button
                key={i}
                onClick={() => !disabled && onSelect(cell.dateStr)}
                disabled={disabled}
                className={`w-full aspect-square flex items-center justify-center text-xs rounded-lg
                           transition-all duration-100 ${
                  isSelected
                    ? 'bg-indigo-500 text-white font-bold shadow-sm shadow-indigo-200'
                    : isTodayCell
                      ? 'bg-indigo-50 text-indigo-600 font-semibold'
                      : !cell.inMonth
                        ? 'text-gray-200 cursor-default'
                        : cell.isFuture
                          ? 'text-gray-200 cursor-not-allowed'
                          : 'text-gray-600 hover:bg-gray-100 active:scale-90'
                }`}
              >
                {cell.day}
              </button>
            )
          })}
        </div>

        {/* 快捷按钮 */}
        <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-gray-100">
          <button
            onClick={() => onSelect(today)}
            className="text-[11px] text-indigo-500 hover:text-indigo-700 font-medium
                       px-2.5 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
          >
            回到今天
          </button>
        </div>
      </div>
    )
  }
)

export default MiniCalendar

// 注入日历弹窗动画样式（仅在浏览器环境中执行一次）
if (typeof document !== 'undefined') {
  const styleId = 'mini-calendar-anim'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      @keyframes calendarFadeIn {
        from { opacity: 0; transform: translate(-50%, -4px); }
        to   { opacity: 1; transform: translate(-50%, 0); }
      }
    `
    document.head.appendChild(style)
  }
}
