'use client'

import { useMemo } from 'react'
import type { RawEvent } from '@/lib/research-export'
import { buildStuckEpisodes } from '@/lib/research-export'
import MetricCard from './MetricCard'
import DataTable from './DataTable'

interface Props {
  events: RawEvent[]
}

export default function StuckTab({ events }: Props) {
  const { metrics, table } = useMemo(
    () => buildStuckEpisodes(events),
    [events]
  )

  return (
    <div>
      <MetricCard metrics={metrics} />
      <DataTable
        columns={table.columns}
        rows={table.rows}
        csvFilename="stuck_episodes.csv"
        expandable
      />
    </div>
  )
}
