'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildDailyPerUser } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
  tasks: Array<{ user_id: string; date: string; completed: boolean }>
}

export default function DailyTab({ events, tasks }: Props) {
  const { metrics, table } = useMemo(
    () => buildDailyPerUser(events, tasks),
    [events, tasks]
  )

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={table.rows}
        csvFilename="daily_per_user.csv"
      />
    </div>
  )
}
