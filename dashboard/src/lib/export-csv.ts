function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function exportTimestamp(date = new Date()): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('') + '_' + [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('')
}

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/@app\.local$/i, '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unknown'
}

export function buildCSVFilename(userLabel: string, exportName: string, date = new Date()): string {
  const safeUser = safeFilenamePart(userLabel)
  const safeExportName = safeFilenamePart(exportName.replace(/\.csv$/i, ''))
  return `${safeUser}_${safeExportName}_${exportTimestamp(date)}.csv`
}

/**
 * 将对象数组转为 CSV 并触发浏览器下载
 */
export function exportCSV(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return

  const headers = Object.keys(rows[0])
  const csvRows = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h]
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')
        return `"${str.replace(/"/g, '""')}"`
      }).join(',')
    )
  ]

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
