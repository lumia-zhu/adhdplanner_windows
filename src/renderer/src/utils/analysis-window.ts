const HOUR_MS = 60 * 60 * 1000

export interface AnalysisWindow {
  selectedDate: string
  startHour: number
  endHour: number
  startTs: number
  endTs: number
  durationHours: number
  loadDates: string[]
  label: string
  storageKey: string
  crossesMidnight: boolean
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function formatDateKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatShortDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatHour(hour: number): string {
  return hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`
}

export function formatWindowOffsetHour(offsetHour: number): string {
  if (offsetHour <= 24) return formatHour(offsetHour)
  return `次日 ${formatHour(offsetHour - 24)}`
}

export function buildAnalysisWindow(selectedDate: string, startHour: number, endHour: number): AnalysisWindow {
  const safeStartHour = Math.max(0, Math.min(23, Math.floor(startHour)))
  const rawEndHour = Math.floor(endHour)
  const migratedEndHour = rawEndHour <= safeStartHour ? rawEndHour + 24 : rawEndHour
  const safeEndHour = Math.max(safeStartHour + 1, Math.min(36, migratedEndHour))
  const startBase = parseLocalDate(selectedDate)
  const startTs = startBase.getTime() + safeStartHour * HOUR_MS

  const endTs = startBase.getTime() + safeEndHour * HOUR_MS

  const durationHours = Math.round((endTs - startTs) / HOUR_MS)
  const loadDates = Array.from(new Set([
    formatDateKey(startTs),
    formatDateKey(endTs - 1),
  ]))
  const label = `${formatShortDateTime(startTs)} - ${formatShortDateTime(endTs)}`
  const storageKey = `${formatDateKey(startTs)}_${formatHour(safeStartHour).replace(':', '')}-${formatDateKey(endTs)}_${formatHour(safeEndHour).replace(':', '')}`

  return {
    selectedDate,
    startHour: safeStartHour,
    endHour: safeEndHour,
    startTs,
    endTs,
    durationHours,
    loadDates,
    label,
    storageKey,
    crossesMidnight: loadDates.length > 1,
  }
}

export function isTimestampInWindow(ts: number, window: Pick<AnalysisWindow, 'startTs' | 'endTs'>): boolean {
  return Number.isFinite(ts) && ts >= window.startTs && ts < window.endTs
}

export function getWindowHourIndex(ts: number, windowStartTs: number): number {
  return Math.floor((ts - windowStartTs) / HOUR_MS)
}

export function getWindowHourLabel(windowStartTs: number, hourIndex: number): string {
  const start = windowStartTs + hourIndex * HOUR_MS
  const end = start + HOUR_MS
  const startDate = new Date(start)
  const endDate = new Date(end)
  return `${String(startDate.getHours()).padStart(2, '0')}:00-${String(endDate.getHours()).padStart(2, '0')}:00`
}
