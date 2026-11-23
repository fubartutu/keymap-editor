import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { layoutBounds, type Layout } from '../../core/layout.ts'

export interface KeyRender {
  className?: string
  content: ReactNode
  title?: string
  style?: CSSProperties
}

interface Props {
  layout: Layout
  unit?: number
  renderKey: (index: number) => KeyRender
  onKeyClick?: (index: number, e: React.MouseEvent) => void
  onKeyDoubleClick?: (index: number) => void
  /** Enable dragging keys onto each other (used to swap bindings). */
  onSwap?: (from: number, to: number) => void
  className?: string
}

export function Keyboard({ layout, unit = 60, renderKey, onKeyClick, onKeyDoubleClick, onSwap, className }: Props) {
  const gap = 4
  const bounds = useMemo(() => layoutBounds(layout), [layout])
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const pad = 6
  const width = (bounds.maxX - bounds.minX) * unit + pad * 2
  const height = (bounds.maxY - bounds.minY) * unit + pad * 2

  return (
    <div className={`board ${className ?? ''}`} style={{ width, height }}>
      {layout.decorations?.map((d, i) => (
        <div key={'d' + i} className="trackball" style={{ left: (d.x - bounds.minX) * unit + pad, top: (d.y - bounds.minY) * unit + pad, width: d.d * unit, height: d.d * unit }} />
      ))}
      {layout.keys.map((k, i) => {
        const r = renderKey(i)
        const style: CSSProperties = {
          left: (k.x - bounds.minX) * unit + pad + gap / 2,
          top: (k.y - bounds.minY) * unit + pad + gap / 2,
          width: k.w * unit - gap,
          height: k.h * unit - gap,
          transform: k.r ? `rotate(${k.r}deg)` : undefined,
          transformOrigin: k.r ? `${(k.rx - k.x) * unit - gap / 2}px ${(k.ry - k.y) * unit - gap / 2}px` : undefined,
          fontSize: unit < 48 ? 10 : 12.5,
          ...r.style,
        }
        return (
          <div
            key={i}
            className={`key ${r.className ?? ''} ${drag === i ? 'dragging' : ''} ${over === i && drag !== null && drag !== i ? 'droptarget' : ''}`}
            style={style}
            title={r.title}
            draggable={!!onSwap}
            onClick={(e) => onKeyClick?.(i, e)}
            onDoubleClick={() => onKeyDoubleClick?.(i)}
            onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move' }}
            onDragEnd={() => { setDrag(null); setOver(null) }}
            onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i) } }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) onSwap?.(drag, i); setDrag(null); setOver(null) }}
          >
            {r.content}
          </div>
        )
      })}
    </div>
  )
}
