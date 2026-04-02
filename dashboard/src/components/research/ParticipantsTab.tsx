'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildParticipantsSummary } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
  tasks: Array<{ user_id: string; completed: boolean }>
  users: Array<{ user_id: string; email: string }>
}

export default function ParticipantsTab({ events, tasks, users }: Props) {
  const { metrics, table } = useMemo(
    () => buildParticipantsSummary(events, tasks, users),
    [events, tasks, users]
  )

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={table.rows}
        csvFilename="participants.csv"
      />
    </div>
  )
}
