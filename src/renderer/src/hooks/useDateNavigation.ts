import { useState, useCallback } from 'react'

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
    setCurrentDate(d => shiftDate(d, -1))
  }, [])

  const goNextDate = useCallback(() => {
    setCurrentDate(d => {
      const next = shiftDate(d, 1)
      return next > getToday() ? d : next
    })
  }, [])

  const goToday = useCallback(() => {
    setCurrentDate(getToday())
  }, [])

  const jumpToDate = useCallback((date: string) => {
    const today = getToday()
    setCurrentDate(date > today ? today : date)
  }, [])

  return {
    currentDate, setCurrentDate,
    isToday,
    goPrevDate, goNextDate, goToday, jumpToDate,
    getToday,
  }
}
