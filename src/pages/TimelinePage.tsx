import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Project, RoadmapItem, Priority, Status, ItemType } from '../types'

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#d97706', low: '#3b82f6'
}
const TYPE_COLORS: Record<ItemType, { bg: string; text: string }> = {
  goal:    { bg: '#5b6bff', text: '#fff' },
  feature: { bg: '#0891b2', text: '#fff' },
  story:   { bg: '#7c3aed', text: '#fff' },
  task:    { bg: '#16a34a', text: '#fff' },
  subtask: { bg: '#6b7280', text: '#fff' },
}
const STATUS_LABELS: Record<Status, string> = {
  not_started: 'لم يبدأ', in_progress: 'جارٍ', done: 'مكتمل', blocked: 'معلّق'
}
const TYPE_ICONS: Record<ItemType, string> = {
  goal: '🎯', feature: '⭐', story: '📖', task: '✅', subtask: '🔹'
}
const TYPE_LABELS: Record<ItemType, string> = {
  goal: 'هدف', feature: 'ميزة', story: 'قصة', task: 'مهمة', subtask: 'مهمة فرعية'
}
const CHILD_TYPE: Partial<Record<ItemType, ItemType>> = {
  goal: 'feature', feature: 'story', story: 'task', task: 'subtask'
}

// ── Layout constants ──────────────────────────────────────────────────────
const MONTH_W   = 220  // px per month
const PDF_WEEKS = 16   // weeks in PDF export

const today        = new Date()
// Extended range: 24 months before current → current → 24 months ahead
const START_DATE   = new Date(today.getFullYear(), today.getMonth() - 24, 1)
const TOTAL_MONTHS = 49  // 24 past + current + 24 future
const PDF_START    = new Date(today.getFullYear(), today.getMonth(), 1) // PDF reference

// Helper: numeric month label e.g. "6-2026"
function monthLabel(d: Date) { return `${d.getMonth() + 1}-${d.getFullYear()}` }

// ── Flexible date↔pixel helpers (take pxPerDay so they work in both modes) ──
function dateToX(d: string | null | undefined, pxPerDay: number): number {
  if (!d) return 0
  const days = (new Date(d).getTime() - START_DATE.getTime()) / 86400000
  return Math.max(0, days * pxPerDay)
}
function widthFromDates(s: string | null | undefined, e: string | null | undefined, pxPerDay: number): number {
  if (!s || !e) return 28 * pxPerDay
  const days = (new Date(e).getTime() - new Date(s).getTime()) / 86400000
  return Math.max(7 * pxPerDay, days * pxPerDay)
}
function xToDate(x: number, pxPerDay: number): string {
  const ms = START_DATE.getTime() + (x / pxPerDay) * 86400000
  return new Date(ms).toISOString().split('T')[0]
}

// ── Tree helpers ──────────────────────────────────────────────────────────
function buildTree(items: RoadmapItem[]): RoadmapItem[] {
  const map = new Map(items.map(i => [i.id, { ...i, children: [] as RoadmapItem[] }]))
  const roots: RoadmapItem[] = []
  map.forEach(item => {
    if (item.parent_id && map.has(item.parent_id)) map.get(item.parent_id)!.children!.push(item)
    else roots.push(item)
  })
  return roots
}
function flattenTree(nodes: RoadmapItem[], depth = 0, collapsed: Set<string>): Array<{ item: RoadmapItem; depth: number }> {
  const result: Array<{ item: RoadmapItem; depth: number }> = []
  for (const node of nodes) {
    result.push({ item: node, depth })
    if (!collapsed.has(node.id) && node.children?.length)
      result.push(...flattenTree(node.children, depth + 1, collapsed))
  }
  return result
}

// ── Component ─────────────────────────────────────────────────────────────
export default function TimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject]         = useState<Project | null>(null)
  const [items, setItems]             = useState<RoadmapItem[]>([])
  const itemsRef                      = useRef<RoadmapItem[]>([])
  const [tree, setTree]               = useState<RoadmapItem[]>([])
  const [flat, setFlat]               = useState<Array<{ item: RoadmapItem; depth: number }>>([])
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set())
  const [selected, setSelected]       = useState<RoadmapItem | null>(null)
  const [hoveredId, setHoveredId]     = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [exporting, setExporting]     = useState(false)
  const [treeWidth, setTreeWidth]     = useState(290)
  const [isPanning, setIsPanning]     = useState(false)

  const exportRef      = useRef<HTMLDivElement>(null)
  const treeResizeRef  = useRef<{ startX: number; startWidth: number } | null>(null)
  const ganttScrollRef = useRef<HTMLDivElement>(null)
  const panRef         = useRef<{ lastX: number } | null>(null)

  // ── View config (months only) ────────────────────────────────────────────
  const pxPerDay    = MONTH_W / 30.4375
  const totalGanttW = TOTAL_MONTHS * MONTH_W
  const todayX      = dateToX(today.toISOString().split('T')[0], pxPerDay)

  // Scroll to show current month in viewport (RTL: current month is right-of-center)
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = ganttScrollRef.current
      if (!el) return
      // In RTL layout, current month physical position = totalGanttW - todayX
      el.scrollLeft = Math.max(0, (totalGanttW - todayX) - el.clientWidth * 0.7)
    }, 0)
    return () => clearTimeout(timer)
  }, [totalGanttW, todayX])

  // Keep ref in sync for drag closures
  useEffect(() => { itemsRef.current = items }, [items])

  const reload = useCallback(async () => {
    if (!id) return
    const [{ data: proj }, { data: its }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('roadmap_items').select('*').eq('project_id', id).order('position')
    ])
    if (proj) setProject(proj)
    if (its) {
      setItems(its)
      const t = buildTree(its)
      setTree(t)
      setFlat(flattenTree(t, 0, collapsed))
    }
  }, [id, collapsed])

  useEffect(() => { reload() }, [id])
  useEffect(() => { if (tree.length) setFlat(flattenTree(tree, 0, collapsed)) }, [collapsed, tree])

  const toggleCollapse = (itemId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev); next.has(itemId) ? next.delete(itemId) : next.add(itemId); return next
    })
  }

  const addItem = async (parentId?: string, type: ItemType = 'goal') => {
    const newItem = {
      project_id: id!, parent_id: parentId ?? null, type,
      name: `${TYPE_LABELS[type]} جديد`, priority: 'medium' as Priority,
      status: 'not_started' as Status, position: items.length,
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 14*86400000).toISOString().split('T')[0]
    }
    const { data } = await supabase.from('roadmap_items').insert(newItem).select().single()
    if (data) { await reload(); setSelected(data) }
  }

  const saveItem = async (updated: Partial<RoadmapItem>) => {
    if (!selected) return
    await supabase.from('roadmap_items').update(updated).eq('id', selected.id)
    setSelected(s => s ? { ...s, ...updated } : s)
    await reload()
  }

  const deleteItem = async () => {
    if (!selected) return
    await supabase.from('roadmap_items').delete().eq('id', selected.id)
    setSelected(null); await reload()
  }

  // ── Gantt pan ─────────────────────────────────────────────────────────────
  const onGanttMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-bar]')) return
    e.preventDefault()
    panRef.current = { lastX: e.clientX }
    setIsPanning(true)
    const onMove = (ev: MouseEvent) => {
      if (!panRef.current || !ganttScrollRef.current) return
      const delta = ev.clientX - panRef.current.lastX
      panRef.current.lastX = ev.clientX
      ganttScrollRef.current.scrollLeft -= delta  // content follows hand
    }
    const onUp = () => {
      panRef.current = null; setIsPanning(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Bar drag ──────────────────────────────────────────────────────────────
  const dragRef = useRef<{
    type: 'move' | 'resize-left' | 'resize-right'
    id: string; startX: number; startLeft: number; startWidth: number; ppd: number
  } | null>(null)

  const setupBarDrag = (e: React.MouseEvent, item: RoadmapItem, type: 'move' | 'resize-left' | 'resize-right') => {
    e.preventDefault(); e.stopPropagation()
    const ppd = pxPerDay
    const startLeft  = dateToX(item.start_date, ppd)
    const startWidth = widthFromDates(item.start_date, item.end_date, ppd)
    dragRef.current  = { type, id: item.id, startX: e.clientX, startLeft, startWidth, ppd }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const { type: t, startLeft: sl, startWidth: sw, ppd: p } = dragRef.current
      let newLeft = sl, newWidth = sw
      // RTL: negate dx direction; left handle = end date, right handle = start date
      if (t === 'move')             { newLeft = Math.max(0, sl - dx) }
      else if (t === 'resize-right'){ newLeft = Math.max(0, sl - dx); newWidth = Math.max(7 * p, sw + dx) }
      else /* resize-left */        { newWidth = Math.max(7 * p, sw - dx) }
      const newStart = xToDate(newLeft, p)
      const newEnd   = xToDate(newLeft + newWidth, p)
      setItems(prev => prev.map(i => i.id === dragRef.current?.id ? { ...i, start_date: newStart, end_date: newEnd } : i))
    }
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
      const moved = itemsRef.current.find(i => i.id === dragRef.current?.id)
      if (moved) await supabase.from('roadmap_items').update({ start_date: moved.start_date, end_date: moved.end_date }).eq('id', moved.id)
      dragRef.current = null
    }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // ── Tree resize ───────────────────────────────────────────────────────────
  const setupTreeResize = (e: React.MouseEvent) => {
    e.preventDefault()
    treeResizeRef.current = { startX: e.clientX, startWidth: treeWidth }
    const onMove = (ev: MouseEvent) => {
      if (!treeResizeRef.current) return
      const dx = treeResizeRef.current.startX - ev.clientX
      setTreeWidth(Math.max(200, Math.min(520, treeResizeRef.current.startWidth + dx)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
      treeResizeRef.current = null
    }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // ── Inline rename ─────────────────────────────────────────────────────────
  const startRename = (item: RoadmapItem, e: React.MouseEvent) => {
    e.stopPropagation(); setEditingId(item.id); setEditingName(item.name)
  }
  const commitRename = async (itemId: string) => {
    const name = editingName.trim()
    if (name) await supabase.from('roadmap_items').update({ name }).eq('id', itemId)
    setEditingId(null); await reload()
  }

  // ── PDF Export ────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    if (exporting || flat.length === 0) return
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const SCALE    = 3; const PNL_W = 240; const TITLE_H = 56
      const HDR_H    = 52; const ROW_H_PDF = 40; const BAR_H = 26
      const BAR_Y    = (ROW_H_PDF - BAR_H) / 2; const HANDLE_W = 9
      const WEEK_W_PDF = 62
      const COLS     = PDF_WEEKS; const COL_W = WEEK_W_PDF; const GANTT_W = COLS * COL_W
      const pdfPpd   = WEEK_W_PDF / 7
      // PDF uses current-month start as reference (independent of app START_DATE)
      const pdfDateToX = (d: string | null | undefined) => {
        if (!d) return 0
        const days = (new Date(d).getTime() - PDF_START.getTime()) / 86400000
        return Math.max(0, days * pdfPpd)
      }
      const totalW   = GANTT_W + PNL_W
      const totalH   = TITLE_H + HDR_H + flat.length * ROW_H_PDF

      const cv = document.createElement('canvas')
      cv.width = totalW * SCALE; cv.height = totalH * SCALE
      const ctx = cv.getContext('2d')!; ctx.scale(SCALE, SCALE)

      const hexToRgb = (hex: string) => ({
        r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16)
      })

      // Background
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, totalW, totalH)

      // Title
      const grad = ctx.createLinearGradient(0, 0, totalW, 0)
      grad.addColorStop(0, '#5b6bff'); grad.addColorStop(1, '#7c3aed')
      ctx.fillStyle = grad; ctx.fillRect(0, 0, totalW, TITLE_H)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText(project?.name ?? 'خارطة الطريق', totalW - 16, 28)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '12px sans-serif'
      ctx.fillText('خارطة الطريق التفاعلية', totalW - 16, 46)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'
      ctx.fillText(new Date().toLocaleDateString('ar-SA', { year:'numeric', month:'long', day:'numeric' }), 16, 26)
      ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '11px sans-serif'
      ctx.fillText(`${flat.length} بند`, 16, 44)

      // Month headers
      ctx.fillStyle = '#f5f6fa'; ctx.fillRect(0, TITLE_H, GANTT_W, 30)
      const pdfMonths = Array.from({ length: 4 }, (_, i) => {
        const d = new Date(PDF_START); d.setMonth(d.getMonth() + i); return monthLabel(d)
      })
      const mW = GANTT_W / 4
      pdfMonths.forEach((m, i) => {
        if (i > 0) { ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(i*mW, TITLE_H); ctx.lineTo(i*mW, TITLE_H+30); ctx.stroke() }
        ctx.fillStyle = '#6b7280'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(m, i*mW + mW/2, TITLE_H + 21)
      })

      // Week headers
      ctx.fillStyle = '#fff'; ctx.fillRect(0, TITLE_H+30, GANTT_W, 22)
      Array.from({ length: COLS }, (_, i) => {
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(i*COL_W, TITLE_H+30); ctx.lineTo(i*COL_W, TITLE_H+HDR_H); ctx.stroke()
        ctx.fillStyle = '#9ca3af'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'
        ctx.fillText(`${i+1}`, i*COL_W + COL_W/2, TITLE_H + 45)
      })

      // Tree panel header
      ctx.fillStyle = '#f9fafb'; ctx.fillRect(GANTT_W, TITLE_H, PNL_W, HDR_H)
      ctx.fillStyle = '#374151'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'right'
      ctx.fillText('البنود', totalW - 14, TITLE_H + 34)

      // Dividers
      ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(GANTT_W, TITLE_H); ctx.lineTo(GANTT_W, totalH); ctx.stroke()
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, TITLE_H+HDR_H); ctx.lineTo(totalW, TITLE_H+HDR_H); ctx.stroke()

      // Today line
      const tPx = pdfDateToX(today.toISOString().split('T')[0])
      ctx.strokeStyle = '#5b6bff'; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.setLineDash([4,3])
      ctx.beginPath(); ctx.moveTo(tPx, TITLE_H+HDR_H); ctx.lineTo(tPx, totalH); ctx.stroke()
      ctx.setLineDash([]); ctx.globalAlpha = 1

      // Rows
      flat.forEach(({ item, depth }, idx) => {
        const cur = items.find(i => i.id === item.id) ?? item
        const y = TITLE_H + HDR_H + idx * ROW_H_PDF
        ctx.fillStyle = idx % 2 === 0 ? '#fff' : '#fafafa'; ctx.fillRect(0, y, totalW, ROW_H_PDF)
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y+ROW_H_PDF); ctx.lineTo(totalW, y+ROW_H_PDF); ctx.stroke()
        Array.from({ length: COLS }, (_, i) => {
          ctx.strokeStyle = '#e0e0e8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(i*COL_W, y); ctx.lineTo(i*COL_W, y+ROW_H_PDF); ctx.stroke()
        })
        // Bar
        const bL = pdfDateToX(cur.start_date)
        const bW = (() => { const s = cur.start_date, e = cur.end_date; if (!s || !e) return 28*pdfPpd; const d = (new Date(e).getTime()-new Date(s).getTime())/86400000; return Math.max(7*pdfPpd,d*pdfPpd) })()
        if (bW > 0 && bL < GANTT_W) {
          const isDone = cur.status === 'done'
          const tc = hexToRgb(isDone ? '#6b7280' : TYPE_COLORS[cur.type].bg)
          const pc = hexToRgb(PRIORITY_COLORS[cur.priority])
          const cW = Math.min(bW, GANTT_W - bL)
          ctx.shadowColor = 'rgba(0,0,0,0.1)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1
          ctx.fillStyle = `rgb(${tc.r},${tc.g},${tc.b})`
          ctx.beginPath(); ctx.roundRect(bL, y+BAR_Y, cW, BAR_H, 5); ctx.fill()
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
          ctx.fillStyle = `rgb(${pc.r},${pc.g},${pc.b})`
          ctx.beginPath(); ctx.roundRect(bL, y+BAR_Y, HANDLE_W, BAR_H, [5,0,0,5]); ctx.fill()
          if (cW >= HANDLE_W*2) { ctx.beginPath(); ctx.roundRect(bL+cW-HANDLE_W, y+BAR_Y, HANDLE_W, BAR_H, [0,5,5,0]); ctx.fill() }
          if (cW > HANDLE_W*2+20) {
            ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'
            const maxC = Math.floor((cW-HANDLE_W*2-10)/7)
            ctx.fillText(cur.name.length > maxC ? cur.name.slice(0,maxC)+'…' : cur.name, bL+HANDLE_W+6, y+ROW_H_PDF/2+4)
          }
        }
        // Tree label
        const dotC = hexToRgb(PRIORITY_COLORS[cur.priority])
        ctx.fillStyle = `rgb(${dotC.r},${dotC.g},${dotC.b})`
        ctx.beginPath(); ctx.roundRect(GANTT_W+10, y+ROW_H_PDF/2-4, 8, 8, 2); ctx.fill()
        ctx.fillStyle = depth === 0 ? '#111827' : '#374151'
        ctx.font = depth === 0 ? 'bold 13px sans-serif' : '13px sans-serif'; ctx.textAlign = 'right'
        const raw = `${TYPE_ICONS[cur.type]} ${cur.name}`
        const maxC = Math.floor((PNL_W-36-depth*12)/8)
        ctx.fillText(raw.length > maxC ? raw.slice(0,maxC)+'…' : raw, totalW-14-depth*12, y+ROW_H_PDF/2+5)
      })

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pW = 297; const pH = 210; const mg = 6
      const ratio = Math.min((pW-mg*2)/totalW, (pH-mg*2)/totalH)
      pdf.addImage(cv.toDataURL('image/png', 1.0), 'PNG', mg+(pW-mg*2-totalW*ratio)/2, mg+(pH-mg*2-totalH*ratio)/2, totalW*ratio, totalH*ratio)
      pdf.save(`roadmap-${project?.name ?? 'export'}.pdf`)
    } finally { setExporting(false) }
  }

  // ── Row height ────────────────────────────────────────────────────────────
  const ROW_H = 44

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', display: 'flex', flexDirection: 'column' }}>

      {/* ── Topbar ── */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        height: '56px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 20px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
          <button onClick={() => navigate('/')} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px' }}>
            المشاريع
          </button>
          <span style={{ color: '#d1d5db' }}>/</span>
          <span style={{ fontWeight: '700' }}>{project?.name}</span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={exportPDF} disabled={exporting} style={{
            background: exporting ? '#f3f4f6' : '#fff', color: exporting ? '#9ca3af' : '#374151',
            border: '1px solid #e5e7eb', borderRadius: '8px', padding: '7px 14px',
            fontSize: '13px', fontWeight: '600', cursor: exporting ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            {exporting ? '⏳ جارٍ التصدير...' : '⬇ تصدير PDF'}
          </button>

          <button onClick={() => addItem(undefined, 'goal')} style={{
            background: '#5b6bff', color: '#fff', border: 'none',
            borderRadius: '8px', padding: '7px 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer',
          }}>
            + هدف جديد
          </button>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div
        style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
        onClick={e => {
          const panel = document.getElementById('side-panel')
          if (selected && panel && !panel.contains(e.target as Node)) setSelected(null)
        }}
      >

        {/* ── Tree Panel (RIGHT in RTL — first in DOM) ── */}
        <div style={{
          width: `${treeWidth}px`, flexShrink: 0, borderLeft: '1px solid #e5e7eb',
          background: '#fff', display: 'flex', flexDirection: 'column', position: 'relative',
        }}>
          {/* Resize handle */}
          <div
            onMouseDown={setupTreeResize}
            style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '5px', cursor: 'col-resize', zIndex: 30, background: 'transparent', transition: 'background 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#c7d2fe')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          />

          {/* Header */}
          <div style={{ height: `${30+24}px`, padding: '0 16px 0 20px', borderBottom: '1px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>البنود</span>
            <span style={{ fontSize: '12px', fontWeight: '700', padding: '2px 10px', borderRadius: '99px', background: '#eef2ff', color: '#5b6bff' }}>{flat.length}</span>
          </div>

          {/* Items */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {flat.map(({ item, depth }) => {
              const hasChildren = !!(item.children?.length)
              const isCollapsed = collapsed.has(item.id)
              const isSelected  = selected?.id === item.id
              const isHovered   = hoveredId === item.id
              const isEditing   = editingId === item.id
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', height: `${ROW_H}px`,
                    gap: '6px', cursor: 'pointer', borderBottom: '1px solid #f0f0f5',
                    background: isSelected ? '#eef2ff' : isHovered ? '#f9fafb' : '#fff',
                    paddingRight: `${12 + depth * 16}px`, paddingLeft: '10px',
                    transition: 'background 0.1s',
                  }}
                  onDoubleClick={() => !isEditing && setSelected(item)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span style={{ width: '16px', textAlign: 'center', color: '#d1d5db', fontSize: '11px', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); if (hasChildren) toggleCollapse(item.id) }}>
                    {hasChildren ? (isCollapsed ? '▶' : '▼') : ''}
                  </span>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: PRIORITY_COLORS[item.priority], flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>{TYPE_ICONS[item.type]}</span>
                  {isEditing ? (
                    <input autoFocus value={editingName} onChange={e => setEditingName(e.target.value)}
                      onBlur={() => commitRename(item.id)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(item.id); if (e.key === 'Escape') setEditingId(null) }}
                      onClick={e => e.stopPropagation()}
                      style={{ flex: 1, border: '1.5px solid #5b6bff', borderRadius: '6px', padding: '2px 8px', fontSize: '13px', outline: 'none', background: '#fff', minWidth: 0 }} />
                  ) : (
                    <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isSelected ? '#5b6bff' : '#374151', fontWeight: depth === 0 ? '700' : '400' }}
                      onDoubleClick={e => startRename(item, e)} title="انقر مرتين للتعديل">
                      {item.name}
                    </span>
                  )}
                  {CHILD_TYPE[item.type] && isHovered && !isEditing && (
                    <button onClick={e => { e.stopPropagation(); addItem(item.id, CHILD_TYPE[item.type]!) }}
                      style={{ width: '22px', height: '22px', borderRadius: '5px', border: '1px solid #d1d5db', background: '#f9fafb', color: '#6b7280', fontSize: '15px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  )}
                </div>
              )
            })}
            {flat.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '160px', color: '#d1d5db' }}>
                <p style={{ fontSize: '14px', margin: '0 0 8px' }}>لا توجد بنود بعد</p>
                <button onClick={() => addItem(undefined, 'goal')} style={{ fontSize: '13px', color: '#5b6bff', background: 'none', border: 'none', cursor: 'pointer' }}>+ أضف هدفاً</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Gantt (MIDDLE) ── */}
        <div
          ref={ganttScrollRef}
          style={{ flex: 1, overflow: 'auto', direction: 'ltr', cursor: isPanning ? 'grabbing' : 'default', userSelect: isPanning ? 'none' : 'auto' }}
          onMouseDown={onGanttMouseDown}
        >
          <div ref={exportRef} style={{ minWidth: `${totalGanttW}px` }}>

            {/* ── Month header row (RTL: future on left, current/past on right) ── */}
            <div style={{ display: 'flex', height: '30px', position: 'sticky', top: 0, zIndex: 10, background: '#f5f6fa', borderBottom: '1px solid #d1d5db' }}>
              {Array.from({ length: TOTAL_MONTHS }, (_, i) => {
                const actualI = TOTAL_MONTHS - 1 - i  // RTL: render in reverse
                const d = new Date(START_DATE); d.setMonth(d.getMonth() + actualI)
                const isCurrent = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
                return (
                  <div key={i} style={{
                    width: `${MONTH_W}px`, flexShrink: 0,
                    borderLeft: i > 0 ? '1px solid #d1d5db' : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: '700',
                    color: isCurrent ? '#5b6bff' : '#6b7280',
                    background: isCurrent ? '#eef2ff' : 'transparent',
                  }}>
                    {monthLabel(d)}
                  </div>
                )
              })}
            </div>

            {/* ── Sub-header row (day ticks per month) — RTL reversed ── */}
            <div style={{ display: 'flex', height: '24px', position: 'sticky', top: '30px', zIndex: 10, background: '#fff', borderBottom: '1px solid #d1d5db' }}>
              {Array.from({ length: TOTAL_MONTHS }, (_, mi) => {
                const actualMi = TOTAL_MONTHS - 1 - mi
                return [22, 15, 8, 1].map((day, wi) => (
                  <div key={`${actualMi}-${wi}`} style={{
                    width: `${MONTH_W / 4}px`, flexShrink: 0,
                    borderLeft: wi > 0 ? '1px solid #e8e8f0' : (mi > 0 ? '1px solid #e0e0e8' : 'none'),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', color: '#b0b0c0', fontWeight: '600',
                  }}>
                    {day}
                  </div>
                ))
              }).flat()}
            </div>

            {/* ── Rows ── */}
            <div style={{ position: 'relative' }}>
              {/* Today line — RTL: today is near RIGHT side */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${totalGanttW - todayX}px`, width: '2px', background: '#5b6bff', opacity: 0.5, zIndex: 20, pointerEvents: 'none' }} />

              {flat.map(({ item }) => {
                const cur           = items.find(i => i.id === item.id) ?? item
                const barLeft       = dateToX(cur.start_date, pxPerDay)
                const barWidth      = widthFromDates(cur.start_date, cur.end_date, pxPerDay)
                const isDone        = cur.status === 'done'
                const barBg         = isDone ? '#6b7280' : TYPE_COLORS[cur.type].bg
                const priorityColor = PRIORITY_COLORS[cur.priority]

                return (
                  <div key={item.id} style={{ position: 'relative', height: `${ROW_H}px`, borderBottom: '1px solid #e5e7eb', background: selected?.id === item.id ? '#fafbff' : 'transparent' }}>

                    {/* Major grid lines (one per month) */}
                    {Array.from({ length: TOTAL_MONTHS }, (_, i) => (
                      <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${i * MONTH_W}px`, borderLeft: '1px solid #d8d8e4' }} />
                    ))}

                    {/* Minor grid lines (day ticks within each month) */}
                    {Array.from({ length: TOTAL_MONTHS * 4 }, (_, i) => (
                      <div key={`m${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${i * (MONTH_W / 4)}px`, borderLeft: i % 4 === 0 ? 'none' : '1px solid #eeeef5' }} />
                    ))}

                    {/* Bar */}
                    <div
                      data-bar="true"
                      style={{
                        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                        left: `${totalGanttW - barLeft - barWidth}px`, width: `${barWidth}px`,
                        height: '28px', borderRadius: '6px',
                        display: 'flex', alignItems: 'center',
                        fontSize: '12px', fontWeight: '600',
                        userSelect: 'none', cursor: 'grab', overflow: 'hidden',
                        background: barBg, color: '#fff',
                        boxShadow: isDone ? 'none' : '0 1px 4px rgba(0,0,0,0.18)',
                        opacity: isDone ? 0.75 : 1,
                      }}
                      onMouseDown={e => setupBarDrag(e, cur, 'move')}
                      onDoubleClick={() => setSelected(item)}
                    >
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '10px', cursor: 'ew-resize', background: priorityColor, borderRadius: '6px 0 0 6px', zIndex: 2 }}
                        onMouseDown={e => setupBarDrag(e, cur, 'resize-left')} />
                      <span style={{ paddingRight: '16px', paddingLeft: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {isDone ? '✓' : TYPE_ICONS[cur.type]} {cur.name}
                      </span>
                      <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '10px', cursor: 'ew-resize', background: priorityColor, borderRadius: '0 6px 6px 0', zIndex: 2 }}
                        onMouseDown={e => setupBarDrag(e, cur, 'resize-right')} />
                    </div>
                  </div>
                )
              })}

              {flat.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#d1d5db', fontSize: '14px' }}>
                  اسحب الأشرطة لتغيير التواريخ · انقر مرتين لفتح التفاصيل
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Side Panel (LEFT in RTL — last in DOM) ── */}
        {selected && (
          <SidePanel
            item={selected}
            onSave={saveItem}
            onDelete={deleteItem}
            onClose={() => setSelected(null)}
            onAddChild={CHILD_TYPE[selected.type] ? () => addItem(selected.id, CHILD_TYPE[selected.type]!) : undefined}
          />
        )}

      </div>

      {/* ── Footer legend ── */}
      <div style={{ background: '#fff', borderTop: '1px solid #e5e7eb', height: '42px', display: 'flex', alignItems: 'center', gap: '20px', padding: '0 16px' }}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#9ca3af' }}>الأولوية:</span>
        {(Object.entries(PRIORITY_COLORS) as [Priority, string][]).map(([p, c]) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280' }}>
            <div style={{ width: '9px', height: '9px', borderRadius: '2px', background: c }} />
            {p === 'critical' ? 'حرج' : p === 'high' ? 'عالي' : p === 'medium' ? 'متوسط' : 'منخفض'}
          </div>
        ))}
        <span style={{ marginRight: 'auto', fontSize: '12px', color: '#c0c0d0' }}>
          💡 اسحب الأرضية للتنقل · اسحب الشريط للتحريك · اسحب الحواف للتمديد · انقر مرتين لفتح التفاصيل
        </span>
      </div>
    </div>
  )
}

// ─── Side Panel ────────────────────────────────────────────────────────────
function SidePanel({ item, onSave, onDelete, onClose, onAddChild }: {
  item: RoadmapItem; onSave: (u: Partial<RoadmapItem>) => void
  onDelete: () => void; onClose: () => void; onAddChild?: () => void
}) {
  const [name, setName]         = useState(item.name)
  const [desc, setDesc]         = useState(item.description ?? '')
  const [start, setStart]       = useState(item.start_date ?? '')
  const [end, setEnd]           = useState(item.end_date ?? '')
  const [priority, setPriority] = useState<Priority>(item.priority)
  const [status, setStatus]     = useState<Status>(item.status)

  useEffect(() => {
    setName(item.name); setDesc(item.description ?? '')
    setStart(item.start_date ?? ''); setEnd(item.end_date ?? '')
    setPriority(item.priority); setStatus(item.status)
  }, [item.id])

  const save = () => onSave({ name, description: desc, start_date: start, end_date: end, priority, status })
  const priorities: Priority[] = ['critical', 'high', 'medium', 'low']
  const statuses:   Status[]   = ['not_started', 'in_progress', 'done', 'blocked']
  const PRIORITY_LABELS: Record<Priority, string> = { critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض' }

  return (
    <div id="side-panel" style={{ width: '360px', flexShrink: 0, background: '#fff', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', boxShadow: '-4px 0 16px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>{TYPE_ICONS[item.type]}</span>
          <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>{TYPE_LABELS[item.type]}</span>
          <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '99px', background: `${PRIORITY_COLORS[item.priority]}15`, color: PRIORITY_COLORS[item.priority], fontWeight: '600' }}>
            {PRIORITY_LABELS[item.priority]}
          </span>
        </div>
        <button onClick={onClose} style={{ width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e5e7eb', background: '#f9fafb', color: '#9ca3af', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Section><Field label="الاسم">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم البند" style={inputStyle}
            onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
        </Field></Section>

        <Section><Field label="الوصف">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="وصف تفصيلي (اختياري)"
            style={{ ...inputStyle, resize: 'none', lineHeight: '1.6' } as React.CSSProperties}
            onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
        </Field></Section>

        <Section><Field label="المدة الزمنية">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>البداية</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ ...inputStyle, fontSize: '13px', padding: '8px 10px' }}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>النهاية</span>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ ...inputStyle, fontSize: '13px', padding: '8px 10px' }}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
            </div>
          </div>
        </Field></Section>

        <Section><Field label="الأولوية">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {priorities.map(p => (
              <button key={p} onClick={() => setPriority(p)} style={{
                padding: '8px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                background: priority === p ? `${PRIORITY_COLORS[p]}12` : '#f9fafb',
                color: priority === p ? PRIORITY_COLORS[p] : '#9ca3af',
                border: priority === p ? `1.5px solid ${PRIORITY_COLORS[p]}50` : '1.5px solid transparent',
              }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: PRIORITY_COLORS[p], flexShrink: 0 }} />
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </Field></Section>

        <Section><Field label="الحالة">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {statuses.map(s => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '9px 14px', borderRadius: '10px', fontSize: '14px', fontWeight: '500',
                textAlign: 'right', cursor: 'pointer', border: 'none',
                background: status === s ? '#5b6bff' : '#f9fafb',
                color: status === s ? '#fff' : '#6b7280',
              }}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </Field></Section>

        {onAddChild && (
          <Section>
            <button onClick={onAddChild} style={{ width: '100%', padding: '11px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', color: '#5b6bff', background: '#f5f3ff', border: '1.5px dashed #c4b5fd', cursor: 'pointer' }}>
              + إضافة {TYPE_LABELS[CHILD_TYPE[item.type]!]}
            </button>
          </Section>
        )}
      </div>

      <div style={{ padding: '14px 20px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '10px', background: '#fafafa' }}>
        <button onClick={save} style={{ flex: 1, padding: '11px', borderRadius: '10px', background: '#5b6bff', color: '#fff', fontWeight: '700', fontSize: '14px', border: 'none', cursor: 'pointer' }}>حفظ التغييرات</button>
        <button onClick={onDelete} style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#f87171', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🗑</button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid #e5e7eb', borderRadius: '10px', padding: '10px 14px',
  fontSize: '14px', background: '#f9fafb', outline: 'none', width: '100%',
  transition: 'border-color 0.15s', fontFamily: 'inherit',
}
function Section({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '16px 20px', borderBottom: '1px solid #f5f5f8' }}>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label style={{ fontSize: '12px', fontWeight: '700', color: '#9ca3af' }}>{label}</label>
      {children}
    </div>
  )
}
