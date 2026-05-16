'use client'

import { useState } from 'react'

interface DefinitionTooltipProps {
  label?: string
  description: string
}

export default function DefinitionTooltip({ label = '口径', description }: DefinitionTooltipProps) {
  const [open, setOpen] = useState(false)

  return (
    <span
      className="relative inline-flex group align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}
    >
      <span
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] leading-none text-gray-500 cursor-help"
        style={{
          alignItems: 'center',
          background: '#e5e7eb',
          borderRadius: 999,
          color: '#6b7280',
          cursor: 'help',
          display: 'inline-flex',
          fontSize: 10,
          height: 16,
          justifyContent: 'center',
          lineHeight: '16px',
          width: 16,
        }}
      >
        ?
      </span>
      <span
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-72 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg group-hover:block"
        style={{
          background: '#1f2937',
          borderRadius: 10,
          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.22)',
          color: 'white',
          display: open ? 'block' : 'none',
          fontSize: 12,
          fontWeight: 400,
          left: '50%',
          lineHeight: 1.6,
          marginTop: 6,
          padding: '8px 12px',
          pointerEvents: 'none',
          position: 'absolute',
          textAlign: 'left',
          top: '100%',
          transform: 'translateX(-50%)',
          width: 288,
          zIndex: 30,
        }}
      >
        <span className="mb-1 block font-medium text-white">{label}</span>
        <span className="block text-gray-200">{description}</span>
      </span>
    </span>
  )
}
