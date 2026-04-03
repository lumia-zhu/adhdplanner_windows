'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildDailyPerUser, resolveUserNames } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
  tasks: Array<{ user_id: string; date: string; completed: boolean }>
  users: Array<{ user_id: string; email: string }>
}

export default function DailyTab({ events, tasks, users }: Props) {
  const { metrics, table } = useMemo(
    () => buildDailyPerUser(events, tasks),
    [events, tasks]
  )

  const rows = useMemo(() => resolveUserNames(table.rows, users), [table.rows, users])

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={rows}
        csvFilename="daily_per_user.csv"
      />
    </div>
  )
}
