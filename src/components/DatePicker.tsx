import { useEffect, useRef, useState } from 'react'

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']
const WEEKDAYS = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت']

const pad = (n: number) => String(n).padStart(2, '0')
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

function parseISO(value: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function formatDisplay(value: string): string {
  const d = parseISO(value)
  if (!d) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Days to render for the visible 6x7 grid of a given month, including leading/trailing days from adjacent months. */
function buildGrid(viewYear: number, viewMonth: number): Date[] {
  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const startOffset = firstOfMonth.getDay() // 0 = Sunday
  const gridStart = new Date(viewYear, viewMonth, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))
}

export default function DatePicker({
  value, onChange, placeholder = 'اختر تاريخاً', style,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const selected = parseISO(value ?? '')
  const [viewDate, setViewDate] = useState(() => selected ?? new Date())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) setViewDate(selected)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const today = new Date()
  const grid = buildGrid(viewDate.getFullYear(), viewDate.getMonth())

  const goMonth = (delta: number) => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1))

  const pick = (d: Date) => {
    onChange(toISO(d))
    setOpen(false)
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '8px', cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit',
          color: selected ? '#111827' : '#9ca3af',
          ...style,
        }}>
        <span>{selected ? formatDisplay(value ?? '') : placeholder}</span>
        <span style={{ fontSize: '14px', flexShrink: 0, color: '#9ca3af' }}>📅</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.12)', padding: '14px', width: '272px',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <button type="button" onClick={() => goMonth(-1)} title="الشهر السابق"
              style={{ border: 'none', background: '#f3f4f6', borderRadius: '8px', width: '26px', height: '26px', cursor: 'pointer', color: '#374151', fontSize: '13px' }}>
              ‹
            </button>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>
              {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button type="button" onClick={() => goMonth(1)} title="الشهر التالي"
              style={{ border: 'none', background: '#f3f4f6', borderRadius: '8px', width: '26px', height: '26px', cursor: 'pointer', color: '#374151', fontSize: '13px' }}>
              ›
            </button>
          </div>

          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '4px' }}>
            {WEEKDAYS.map(w => (
              <div key={w} style={{ textAlign: 'center', fontSize: '10px', fontWeight: '700', color: '#9ca3af', padding: '4px 0' }}>{w}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
            {grid.map((d, i) => {
              const inMonth = d.getMonth() === viewDate.getMonth()
              const isToday = sameDay(d, today)
              const isSelected = selected ? sameDay(d, selected) : false
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(d)}
                  style={{
                    aspectRatio: '1', border: isToday && !isSelected ? '1.5px solid #5b6bff' : 'none',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit',
                    background: isSelected ? '#5b6bff' : 'transparent',
                    color: isSelected ? '#fff' : inMonth ? '#374151' : '#d1d5db',
                    fontWeight: isToday || isSelected ? '700' : '400',
                  }}>
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          {/* Footer actions */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f3f4f6' }}>
            <button type="button" onClick={() => pick(today)}
              style={{ flex: 1, padding: '7px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              اليوم
            </button>
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false) }}
                style={{ flex: 1, padding: '7px', borderRadius: '8px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#ef4444', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                مسح
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
