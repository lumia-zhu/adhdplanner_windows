import { useState, useCallback } from 'react'
import { tracker } from '../services/tracker'

function getToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export { getToday }

export function useDateNavigation() {
  const [currentDate, setCurrentDate] = useState(getToday)
  const isToday = currentDate === getToday()

  const goPrevDate = useCallback(() => {
    setCurrentDate(d => {
      const to = shiftDate(d, -1)
      tracker.track('nav.date_changed', { from: d, to, method: 'arrow' })
      return to
    })
  }, [])

  const goNextDate = useCallback(() => {
    setCurrentDate(d => {
      const next = shiftDate(d, 1)
      tracker.track('nav.date_changed', { from: d, to: next, method: 'arrow' })
      return next
    })
  }, [])

  const goToday = useCallback(() => {
    setCurrentDate(d => {
      const today = getToday()
      if (d !== today) tracker.track('nav.date_changed', { from: d, to: today, method: 'today' })
      return today
    })
  }, [])

  const jumpToDate = useCallback((date: string) => {
    setCurrentDate(d => {
      if (d !== date) tracker.track('nav.date_changed', { from: d, to: date, method: 'calendar' })
      return date
    })
  }, [])

  return {
    currentDate, setCurrentDate,
    isToday,
    goPrevDate, goNextDate, goToday, jumpToDate,
    getToday,
  }
}
