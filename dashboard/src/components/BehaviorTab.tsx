'use client'

import { useState } from 'react'
import EventTable from './EventTable'
import TimelineView from './TimelineView'
import type { TimelineItem } from '@/lib/merge-timeline'

interface EventRow {
  id: number
  event_id: string
  event_type: string
  timestamp: number
  payload: Record<string, unknown>
  date: string
}

interface Props {
  events: EventRow[]
  timelineItems: TimelineItem[]
  initialTypeFilter?: string
  exportUserLabel?: string
}

export default function BehaviorTab({ events, timelineItems, initialTypeFilter, exportUserLabel }: Props) {
  const [view, setView] = useState<'table' | 'timeline'>('table')

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-gray-100 rounded-lg p-0.5 flex">
          <button
            onClick={() => setView('table')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${view === 'table' ? 'bg-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            表格
          </button>
          <button
            onClick={() => setView('timeline')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${view === 'timeline' ? 'bg-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'}`}
          >
            时间线
          </button>
        </div>
        <span className="text-xs text-gray-400">
          {view === 'table' ? `${events.length} 条事件` : `${timelineItems.length} 条记录`}
        </span>
      </div>

      {view === 'table'
        ? <EventTable events={events} initialTypeFilter={initialTypeFilter} exportUserLabel={exportUserLabel} />
        : <TimelineView items={timelineItems} />
      }
    </div>
  )
}
