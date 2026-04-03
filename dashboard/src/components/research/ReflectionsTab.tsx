'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildReflectionsDetail, resolveUserNames } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
  sessions: Array<Record<string, unknown>>
  users: Array<{ user_id: string; email: string }>
}

export default function ReflectionsTab({ events, sessions, users }: Props) {
  const { metrics, table } = useMemo(
    () => buildReflectionsDetail(
      events,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessions as any[]
    ),
    [events, sessions]
  )

  const rows = useMemo(() => resolveUserNames(table.rows, users), [table.rows, users])

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={rows}
        csvFilename="reflections.csv"
        chatExpandable
      />
    </div>
  )
}
