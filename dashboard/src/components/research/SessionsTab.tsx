'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildSessionsDetail } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
}

export default function SessionsTab({ events }: Props) {
  const { metrics, table } = useMemo(
    () => buildSessionsDetail(events),
    [events]
  )

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={table.rows}
        csvFilename="sessions.csv"
        expandable
      />
    </div>
  )
}
