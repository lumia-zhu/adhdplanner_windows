'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildSessionsDetail, resolveUserNames } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
  users: Array<{ user_id: string; email: string }>
}

export default function SessionsTab({ events, users }: Props) {
  const { metrics, table } = useMemo(
    () => buildSessionsDetail(events),
    [events]
  )

  const rows = useMemo(() => resolveUserNames(table.rows, users), [table.rows, users])

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={rows}
        csvFilename="sessions.csv"
        expandable
      />
    </div>
  )
}
