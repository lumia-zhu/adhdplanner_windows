import type { DailyMoodRecord } from '../types'

export type MoodValue = DailyMoodRecord['mood']
export type MoodThemeId = 'face' | 'weather' | 'plant' | 'moon'
export type MoodOption = { value: MoodValue; label: string; emoji: string }

export const MOOD_LABELS: Array<{ value: MoodValue; label: string }> = [
  { value: 1, label: '很低落' },
  { value: 2, label: '低落' },
  { value: 3, label: '平静' },
  { value: 4, label: '开心' },
  { value: 5, label: '很开心' },
]

const MOOD_THEMES: Record<MoodThemeId, readonly string[]> = {
  face: ['😭', '😟', '😶', '😃', '🤩'],
  weather: ['⛈️', '🌧️', '☁️', '🌤️', '☀️'],
  plant: ['🥀', '🍂', '🌱', '🌿', '🌸'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕'],
}

export function getMoodThemeForDate(_dateStr: string): MoodThemeId {
  return 'face'
}

export function getMoodOptions(themeId: MoodThemeId): MoodOption[] {
  const theme = MOOD_THEMES[themeId]
  return MOOD_LABELS.map((option, index) => ({
    ...option,
    emoji: theme[index],
  }))
}

export function getMoodOptionForDate(dateStr: string, mood: MoodValue): MoodOption | null {
  const themeId = getMoodThemeForDate(dateStr)
  return getMoodOptions(themeId).find(option => option.value === mood) ?? null
}

export function parseMoodRecord(value: unknown): DailyMoodRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const mood = Number(record.mood)
  if (!Number.isInteger(mood) || mood < 1 || mood > 5) return null
  return {
    date: String(record.date || ''),
    mood: mood as MoodValue,
    note: String(record.note || ''),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
  }
}
