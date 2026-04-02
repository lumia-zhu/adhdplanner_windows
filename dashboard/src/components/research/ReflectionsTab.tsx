'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildReflectionsDetail } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
  sessions: Array<Record<string, unknown>>
}

export default function ReflectionsTab({ events, sessions }: Props) {
  const { metrics, table } = useMemo(
    () => buildReflectionsDetail(
      events,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessions as any[]
    ),
    [events, sessions]
  )

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={table.rows}
        csvFilename="reflections.csv"
        chatExpandable
      />
    </div>
  )
}
