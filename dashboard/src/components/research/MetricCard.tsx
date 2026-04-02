'use client'

import { useState } from 'react'
import type { Metric } from '@/lib/research-export'

interface Props {
  metrics: Metric[]
}

export default function MetricCard({ metrics }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {metrics.map((m, i) => (
        <div
          key={m.label}
          className="relative bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
          onMouseEnter={() => setHoveredIdx(i)}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
            {m.label}
            <span className="inline-block w-3.5 h-3.5 text-[10px] leading-[14px] text-center rounded-full bg-gray-200 text-gray-500 cursor-help">?</span>
          </p>
          <p className="text-xl font-bold text-gray-800">{m.value}</p>
          {m.detail && <p className="text-xs text-gray-400 mt-0.5">{m.detail}</p>}

          {hoveredIdx === i && (
            <div className="absolute z-20 left-0 top-full mt-1 w-64 bg-gray-800 text-white text-xs rounded-lg p-3 shadow-lg pointer-events-none">
              <p className="font-medium mb-1">计算公式</p>
              <p className="text-gray-300">{m.formula}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
