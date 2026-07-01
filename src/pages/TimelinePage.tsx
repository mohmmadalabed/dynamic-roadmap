import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Project, RoadmapItem, Priority, Status, ItemType } from '../types'

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#3b82f6', low: '#22c55e'
}
const PRIORITY_ICONS: Record<Priority, string> = {
  critical: '⬆⬆', high: '⬆', medium: '◎', low: '⬇'
}
// depth → blue gradient (dark → light), all support white text
const DEPTH_COLORS = ['#0f2d6e', '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6']
const DONE_COLOR   = '#15803d'
const depthDots    = (d: number) => '•'.repeat(d + 1)
const depthColor   = (d: number) => DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)]
const STATUS_LABELS: Record<Status, string> = {
  not_started: 'لم يبدأ', in_progress: 'جارٍ', done: 'مكتمل', blocked: 'معلّق'
}
const TYPE_ICONS: Record<ItemType, string> = {
  goal: '🎯', feature: '⭐', story: '📖', task: '🔧', subtask: '🔹'
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
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set())

  // O(1) id → item lookup — replaces repeated items.find() calls
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // Single memo replaces: tree state + flat state + 3 useEffects (was 3 renders per items change → 1)
  const flat = useMemo(() => flattenTree(buildTree(items), 0, collapsed), [items, collapsed])
  const [selected, setSelected]       = useState<RoadmapItem | null>(null)
  const [hoveredId, setHoveredId]     = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [, setDragTick]               = useState(0)
  const dragDatesRef                  = useRef<{ id: string; start_date: string; end_date: string } | null>(null)
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

  // Memoize static headers — 49 months + 196 day-ticks never change
  const monthHeaderData = useMemo(() =>
    Array.from({ length: TOTAL_MONTHS }, (_, i) => {
      const actualI = TOTAL_MONTHS - 1 - i
      const d = new Date(START_DATE); d.setMonth(d.getMonth() + actualI)
      const isCurrent = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
      return { key: i, label: monthLabel(d), isCurrent }
    }), [])

  const subHeaderData = useMemo(() =>
    Array.from({ length: TOTAL_MONTHS }, (_, mi) =>
      [22, 15, 8, 1].map((day, wi) => ({ key: `${TOTAL_MONTHS - 1 - mi}-${wi}`, day, wi, mi }))
    ).flat(), [])

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

  const reload = useCallback(async () => {
    if (!id) return
    const [{ data: proj }, { data: its }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('roadmap_items').select('*').eq('project_id', id).order('position')
    ])
    if (proj) setProject(proj)
    if (its) setItems(its)
  }, [id])

  useEffect(() => { reload() }, [id])

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
    if (data) {
      setItems(prev => [...prev, data])
      setSelected(data)
    }
  }

  const saveItem = async (updated: Partial<RoadmapItem>) => {
    if (!selected) return
    await supabase.from('roadmap_items').update(updated).eq('id', selected.id)
    const merged = { ...selected, ...updated }
    setSelected(merged)
    setItems(prev => prev.map(i => i.id === selected.id ? merged : i))
  }

  const deleteItem = async () => {
    if (!selected) return
    await supabase.from('roadmap_items').delete().eq('id', selected.id)
    const deletedId = selected.id
    setSelected(null)
    setItems(prev => prev.filter(i => i.id !== deletedId))
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
      const { type: t, startLeft: sl, startWidth: sw, ppd: p, id: itemId } = dragRef.current
      let newLeft = sl, newWidth = sw
      // RTL: negate dx direction; left handle = end date, right handle = start date
      if (t === 'move')             { newLeft = Math.max(0, sl - dx) }
      else if (t === 'resize-right'){ newLeft = Math.max(0, sl - dx); newWidth = Math.max(7 * p, sw + dx) }
      else /* resize-left */        { newWidth = Math.max(7 * p, sw - dx) }
      // Store drag state in ref — no setItems cascade, just one cheap re-render tick
      dragDatesRef.current = { id: itemId, start_date: xToDate(newLeft, p), end_date: xToDate(newLeft + newWidth, p) }
      setDragTick(n => n + 1)
    }
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
      // Commit final position to DB and items state once on release
      if (dragDatesRef.current) {
        const { id: itemId, start_date, end_date } = dragDatesRef.current
        await supabase.from('roadmap_items').update({ start_date, end_date }).eq('id', itemId)
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, start_date, end_date } : i))
        dragDatesRef.current = null
      }
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
    setEditingId(null)
    if (name) {
      await supabase.from('roadmap_items').update({ name }).eq('id', itemId)
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, name } : i))
      if (selected?.id === itemId) setSelected(s => s ? { ...s, name } : s)
    }
  }

  // ── PDF Export (multi-page) ───────────────────────────────────────────────
  const exportPDF = async () => {
    if (exporting || flat.length === 0) return
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')
      const SCALE = 3; const PNL_W = 240; const TITLE_H = 56
      const HDR_H = 52; const ROW_H_PDF = 40; const BAR_H = 26
      const BAR_Y = (ROW_H_PDF - BAR_H) / 2; const HANDLE_W = 9
      const WEEK_W_PDF = 62
      const COLS = PDF_WEEKS; const COL_W = WEEK_W_PDF; const GANTT_W = COLS * COL_W
      const pdfPpd = WEEK_W_PDF / 7
      const LEGEND_H = 54
      const totalW = GANTT_W + PNL_W

      const pdfDateToX = (d: string | null | undefined) => {
        if (!d) return 0
        const days = (new Date(d).getTime() - PDF_START.getTime()) / 86400000
        return Math.max(0, days * pdfPpd)
      }
      const hexToRgb = (hex: string) => ({
        r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16)
      })

      // A4 landscape: fit to width, split rows across pages
      const pW = 297; const pH = 210; const mg = 6
      const printW = pW - mg * 2          // 285 mm
      const printH = pH - mg * 2          // 198 mm
      const ratio  = printW / totalW      // mm per canvas-px
      const availH_px = Math.floor(printH / ratio)

      // Rows that fit per page (title only on p1, legend only on last)
      const ROWS_P1    = Math.max(1, Math.floor((availH_px - TITLE_H - HDR_H - LEGEND_H) / ROW_H_PDF))
      const ROWS_OTHER = Math.max(1, Math.floor((availH_px - HDR_H - LEGEND_H) / ROW_H_PDF))

      // Split flat into page chunks
      const chunks: Array<{ rows: typeof flat; startIdx: number }> = []
      let fi = 0
      while (fi < flat.length) {
        const limit = chunks.length === 0 ? ROWS_P1 : ROWS_OTHER
        chunks.push({ rows: flat.slice(fi, fi + limit), startIdx: fi })
        fi += limit
      }

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

      for (let pageIdx = 0; pageIdx < chunks.length; pageIdx++) {
        const { rows: chunkRows, startIdx } = chunks[pageIdx]
        const isFirst = pageIdx === 0
        const isLast  = pageIdx === chunks.length - 1
        const topH    = isFirst ? TITLE_H : 0
        const botH    = isLast  ? LEGEND_H : 0
        const pageH   = topH + HDR_H + chunkRows.length * ROW_H_PDF + botH

        const cv  = document.createElement('canvas')
        cv.width  = totalW * SCALE; cv.height = pageH * SCALE
        const ctx = cv.getContext('2d')!; ctx.scale(SCALE, SCALE)

        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, totalW, pageH)

        // ── Title (first page) ──
        if (isFirst) {
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
        }

        // ── Header (every page) ──
        const hdrY = topH
        ctx.fillStyle = '#f5f6fa'; ctx.fillRect(0, hdrY, GANTT_W, 30)
        const pdfMonths = Array.from({ length: 4 }, (_, mi) => {
          const d = new Date(PDF_START); d.setMonth(d.getMonth() + mi); return monthLabel(d)
        })
        const mW = GANTT_W / 4
        pdfMonths.forEach((m, mi) => {
          if (mi > 0) { ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mi*mW, hdrY); ctx.lineTo(mi*mW, hdrY+30); ctx.stroke() }
          ctx.fillStyle = '#6b7280'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'
          ctx.fillText(m, mi*mW + mW/2, hdrY + 21)
        })
        ctx.fillStyle = '#fff'; ctx.fillRect(0, hdrY+30, GANTT_W, 22)
        Array.from({ length: COLS }, (_, ci) => {
          ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ci*COL_W, hdrY+30); ctx.lineTo(ci*COL_W, hdrY+HDR_H); ctx.stroke()
          ctx.fillStyle = '#9ca3af'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'
          ctx.fillText(`${ci+1}`, ci*COL_W + COL_W/2, hdrY + 45)
        })
        ctx.fillStyle = '#f9fafb'; ctx.fillRect(GANTT_W, hdrY, PNL_W, HDR_H)
        ctx.fillStyle = '#374151'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'right'
        ctx.fillText('البنود', totalW - 14, hdrY + 34)

        ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.moveTo(GANTT_W, hdrY); ctx.lineTo(GANTT_W, pageH); ctx.stroke()
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, hdrY+HDR_H); ctx.lineTo(totalW, hdrY+HDR_H); ctx.stroke()

        const rowsY = hdrY + HDR_H
        // Today line
        const tPx = pdfDateToX(today.toISOString().split('T')[0])
        ctx.strokeStyle = '#5b6bff'; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.setLineDash([4,3])
        ctx.beginPath(); ctx.moveTo(tPx, rowsY); ctx.lineTo(tPx, rowsY + chunkRows.length * ROW_H_PDF); ctx.stroke()
        ctx.setLineDash([]); ctx.globalAlpha = 1

        // ── Rows ──
        chunkRows.forEach(({ item, depth }, rowIdx) => {
          const globalIdx = startIdx + rowIdx
          const cur = itemsById.get(item.id) ?? item   // O(1)
          const y   = rowsY + rowIdx * ROW_H_PDF
          ctx.fillStyle = globalIdx % 2 === 0 ? '#fff' : '#fafafa'; ctx.fillRect(0, y, totalW, ROW_H_PDF)
          ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y+ROW_H_PDF); ctx.lineTo(totalW, y+ROW_H_PDF); ctx.stroke()
          Array.from({ length: COLS }, (_, ci) => {
            ctx.strokeStyle = '#e0e0e8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ci*COL_W, y); ctx.lineTo(ci*COL_W, y+ROW_H_PDF); ctx.stroke()
          })
          const bL = pdfDateToX(cur.start_date)
          const bW = (() => { const s = cur.start_date, e = cur.end_date; if (!s || !e) return 28*pdfPpd; const d = (new Date(e).getTime()-new Date(s).getTime())/86400000; return Math.max(7*pdfPpd,d*pdfPpd) })()
          if (bW > 0 && bL < GANTT_W) {
            const isDone = cur.status === 'done'
            const tc = hexToRgb(isDone ? DONE_COLOR : depthColor(depth))
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
              const textY = y + ROW_H_PDF / 2 + 4
              const rightEdge = bL + cW - HANDLE_W - 5; const leftEdge = bL + HANDLE_W + 5
              const pIcon = PRIORITY_ICONS[cur.priority]
              ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'right'
              ctx.fillText(pIcon, rightEdge, textY)
              const iconW = ctx.measureText(pIcon).width
              const dots = '•'.repeat(depth + 1)
              ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '9px sans-serif'; ctx.textAlign = 'left'
              ctx.fillText(dots, leftEdge, textY)
              const dotsW = ctx.measureText(dots).width
              const availW = (rightEdge - iconW - 6) - (leftEdge + dotsW + 6)
              if (availW > 16) {
                ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'
                const maxC = Math.floor(availW / 6.5)
                ctx.fillText(cur.name.length > maxC ? cur.name.slice(0, maxC) + '…' : cur.name, rightEdge - iconW - 6, textY)
              }
            }
          }
          const treeY = y + ROW_H_PDF / 2 + 5
          const treeRight = totalW - 10 - depth * 10
          const pIconC = hexToRgb(PRIORITY_COLORS[cur.priority])
          ctx.fillStyle = `rgb(${pIconC.r},${pIconC.g},${pIconC.b})`
          ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText(PRIORITY_ICONS[cur.priority], treeRight, treeY)
          const pIconW = ctx.measureText(PRIORITY_ICONS[cur.priority]).width
          const dotsStr = '•'.repeat(depth + 1)
          ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'
          ctx.fillText(dotsStr, treeRight - pIconW - 4, treeY)
          const dotsW2 = ctx.measureText(dotsStr).width
          ctx.fillStyle = depth === 0 ? '#111827' : '#374151'
          ctx.font = depth === 0 ? 'bold 12px sans-serif' : '12px sans-serif'
          const availTree = PNL_W - pIconW - dotsW2 - 28 - depth * 10
          const maxCT = Math.floor(availTree / 6.5)
          ctx.fillText(cur.name.length > maxCT ? cur.name.slice(0, maxCT) + '…' : cur.name, treeRight - pIconW - dotsW2 - 10, treeY)
        })

        // ── Legend (last page only) ──
        if (isLast) {
          const ly = rowsY + chunkRows.length * ROW_H_PDF
          const LY_MID = ly + LEGEND_H / 2; const CHIP = 11
          ctx.fillStyle = '#f9fafb'; ctx.fillRect(0, ly, totalW, LEGEND_H)
          ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(totalW, ly); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(totalW / 2, ly + 10); ctx.lineTo(totalW / 2, ly + LEGEND_H - 10); ctx.stroke()
          ctx.fillStyle = '#9ca3af'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText('المستوى:', totalW - 10, LY_MID + 4)
          let rx = totalW - 76
          DEPTH_COLORS.forEach((col, di) => {
            const rc = hexToRgb(col)
            ctx.fillStyle = `rgb(${rc.r},${rc.g},${rc.b})`
            ctx.beginPath(); ctx.roundRect(rx - CHIP, LY_MID - CHIP / 2, CHIP, CHIP, 3); ctx.fill()
            ctx.fillStyle = '#374151'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
            ctx.fillText(`${'•'.repeat(di + 1)}`, rx - CHIP - 4, LY_MID + 4); rx -= 42
          })
          const doneRgb2 = hexToRgb(DONE_COLOR)
          ctx.fillStyle = `rgb(${doneRgb2.r},${doneRgb2.g},${doneRgb2.b})`
          ctx.beginPath(); ctx.roundRect(rx - CHIP, LY_MID - CHIP / 2, CHIP, CHIP, 3); ctx.fill()
          ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText('مكتمل', rx - CHIP - 4, LY_MID + 4)
          const priorityEntries: [string, string, string][] = [
            ['⬆⬆', 'حرج', '#ef4444'], ['⬆', 'عالي', '#f97316'],
            ['◎', 'متوسط', '#3b82f6'], ['⬇', 'منخفض', '#22c55e'],
          ]
          ctx.fillStyle = '#9ca3af'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'
          ctx.fillText('الأولوية:', 10, LY_MID + 4)
          let lxp = 76
          priorityEntries.forEach(([icon, label, color]) => {
            const rc = hexToRgb(color)
            ctx.fillStyle = `rgb(${rc.r},${rc.g},${rc.b})`; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'left'
            ctx.fillText(icon, lxp, LY_MID + 4)
            const iconW = ctx.measureText(icon).width
            ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'
            ctx.fillText(label, lxp + iconW + 4, LY_MID + 4)
            lxp += iconW + ctx.measureText(label).width + 18
          })
        }

        // ── Page number ──
        if (chunks.length > 1) {
          ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'
          ctx.fillText(`${pageIdx + 1} / ${chunks.length}`, 8, pageH - 6)
        }

        if (pageIdx > 0) pdf.addPage()
        pdf.addImage(cv.toDataURL('image/png', 1.0), 'PNG', mg, mg, printW, pageH * ratio)
      }

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
                    background: isSelected ? '#eef2ff' : isHovered ? `${depthColor(depth)}18` : '#fff',
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
                  <span style={{ fontSize: '10px', color: PRIORITY_COLORS[item.priority], flexShrink: 0, minWidth: '18px', textAlign: 'center', letterSpacing: '-2px', lineHeight: 1 }}>{PRIORITY_ICONS[item.priority]}</span>
                  <span style={{ fontSize: '11px', color: '#9ca3af', letterSpacing: '-1px', flexShrink: 0, minWidth: '20px' }}>{depthDots(depth)}</span>
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

            {/* ── Month header row — uses memoized data, not recreated every render ── */}
            <div style={{ display: 'flex', height: '30px', position: 'sticky', top: 0, zIndex: 10, background: '#f5f6fa', borderBottom: '1px solid #d1d5db' }}>
              {monthHeaderData.map(({ key, label, isCurrent }) => (
                <div key={key} style={{
                  width: `${MONTH_W}px`, flexShrink: 0,
                  borderLeft: key > 0 ? '1px solid #d1d5db' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: '700',
                  color: isCurrent ? '#5b6bff' : '#6b7280',
                  background: isCurrent ? '#eef2ff' : 'transparent',
                }}>
                  {label}
                </div>
              ))}
            </div>

            {/* ── Sub-header row — memoized ── */}
            <div style={{ display: 'flex', height: '24px', position: 'sticky', top: '30px', zIndex: 10, background: '#fff', borderBottom: '1px solid #d1d5db' }}>
              {subHeaderData.map(({ key, day, wi, mi }) => (
                <div key={key} style={{
                  width: `${MONTH_W / 4}px`, flexShrink: 0,
                  borderLeft: wi > 0 ? '1px solid #e8e8f0' : (mi > 0 ? '1px solid #e0e0e8' : 'none'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', color: '#b0b0c0', fontWeight: '600',
                }}>
                  {day}
                </div>
              ))}
            </div>

            {/* ── Rows ── */}
            <div style={{ position: 'relative' }}>
              {/* Today line — RTL: today is near RIGHT side */}
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${totalGanttW - todayX}px`, width: '2px', background: '#5b6bff', opacity: 0.5, zIndex: 20, pointerEvents: 'none' }} />

              {/* Parent-child connector lines (SVG overlay) */}
              {flat.length > 0 && (() => {
                const connectors: React.ReactElement[] = []
                // Pre-computed O(1) index map — replaces O(n) flat.findIndex inside forEach
                const flatIdxMap = new Map(flat.map((f, i) => [f.item.id, i]))
                flat.forEach(({ item, depth }, parentIdx) => {
                  if (!item.children?.length || collapsed.has(item.id)) return
                  let lastIdx = parentIdx
                  for (let i = parentIdx + 1; i < flat.length; i++) {
                    if (flat[i].depth <= depth) break
                    lastIdx = i
                  }
                  if (lastIdx === parentIdx) return
                  const cur = itemsById.get(item.id) ?? item   // O(1)
                  const x   = totalGanttW - dateToX(cur.start_date, pxPerDay)
                  const y1  = parentIdx * ROW_H + ROW_H
                  const y2  = lastIdx   * ROW_H + ROW_H / 2
                  const color = depthColor(depth)
                  connectors.push(
                    <g key={item.id}>
                      <line x1={x} y1={y1} x2={x} y2={y2} stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.45} />
                      {flat.slice(parentIdx + 1, lastIdx + 1)
                        .filter(f => f.item.parent_id === item.id)
                        .map(f => {
                          const ci = flatIdxMap.get(f.item.id) ?? -1  // O(1)
                          const cy = ci * ROW_H + ROW_H / 2
                          return <line key={f.item.id} x1={x} y1={cy} x2={x - 14} y2={cy} stroke={color} strokeWidth={1.5} strokeDasharray="5 4" opacity={0.45} />
                        })
                      }
                    </g>
                  )
                })
                return (
                  <svg style={{ position: 'absolute', top: 0, left: 0, width: `${totalGanttW}px`, height: `${flat.length * ROW_H}px`, pointerEvents: 'none', zIndex: 6 }}>
                    {connectors}
                  </svg>
                )
              })()}

              {flat.map(({ item, depth }) => {
                const _base = itemsById.get(item.id) ?? item   // O(1)
                // During drag: read visual position from ref (no setItems cascade)
                const cur   = dragDatesRef.current?.id === item.id
                  ? { ..._base, start_date: dragDatesRef.current.start_date, end_date: dragDatesRef.current.end_date }
                  : _base
                const barLeft       = dateToX(cur.start_date, pxPerDay)
                const barWidth      = widthFromDates(cur.start_date, cur.end_date, pxPerDay)
                const isDone        = cur.status === 'done'
                const barBg         = isDone ? DONE_COLOR : depthColor(depth)
                const priorityColor = PRIORITY_COLORS[cur.priority]

                return (
                  <div key={item.id}
                    onMouseEnter={() => setHoveredId(item.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      position: 'relative', height: `${ROW_H}px`, borderBottom: '1px solid #e5e7eb',
                      backgroundColor: selected?.id === item.id ? '#fafbff' : hoveredId === item.id ? `${depthColor(depth)}14` : 'transparent',
                      // Grid lines via CSS — replaces ~245 DOM divs per row
                      backgroundImage: 'repeating-linear-gradient(90deg,#d8d8e4 0,#d8d8e4 1px,transparent 1px,transparent 220px),repeating-linear-gradient(90deg,#eeeef5 0,#eeeef5 1px,transparent 1px,transparent 55px)',
                    }}>

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
                      {/* Label: RTL layout — dots → priority → title (right to left) */}
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', flexDirection: 'row-reverse', paddingRight: '14px', paddingLeft: '12px', gap: '5px', overflow: 'hidden', minWidth: 0 }}>
                        <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.9)', letterSpacing: '-1px', flexShrink: 0 }}>{PRIORITY_ICONS[cur.priority]}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: '600', flex: 1, textAlign: 'right' }}>{cur.name}</span>
                        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)', letterSpacing: '-1px', flexShrink: 0 }}>{depthDots(depth)}</span>
                      </div>
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
        {(Object.entries(PRIORITY_ICONS) as [Priority, string][]).map(([p, icon]) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#6b7280' }}>
            <span style={{ fontSize: '11px', color: PRIORITY_COLORS[p], letterSpacing: '-2px', lineHeight: 1 }}>{icon}</span>
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
  const [start, setStart]       = useState(item.start_date ?? '')
  const [end, setEnd]           = useState(item.end_date ?? '')
  const [priority, setPriority] = useState<Priority>(item.priority)
  const [status, setStatus]     = useState<Status>(item.status)
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'>('idle')
  const skipSave = useRef(true)

  // Reset fields when switching items
  useEffect(() => {
    skipSave.current = true
    setName(item.name)
    setStart(item.start_date ?? ''); setEnd(item.end_date ?? '')
    setPriority(item.priority); setStatus(item.status)
    setSaveStatus('idle')
  }, [item.id])

  // Autosave with 700ms debounce
  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    setSaveStatus('saving')
    const t = setTimeout(() => {
      onSave({ name, start_date: start, end_date: end, priority, status })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    }, 700)
    return () => clearTimeout(t)
  }, [name, start, end, priority, status])

  const priorities: Priority[] = ['critical', 'high', 'medium', 'low']
  const statuses:   Status[]   = ['not_started', 'in_progress', 'done', 'blocked']
  const PRIORITY_LABELS: Record<Priority, string> = { critical: '⬆⬆ حرج', high: '⬆ عالي', medium: '◎ متوسط', low: '⬇ منخفض' }

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

        <Section>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="الأولوية">
              <select value={priority} onChange={e => setPriority(e.target.value as Priority)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {priorities.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </Field>
            <Field label="الحالة">
              <select value={status} onChange={e => setStatus(e.target.value as Status)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {statuses.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        {onAddChild && (
          <Section>
            <button onClick={onAddChild} style={{ width: '100%', padding: '11px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', color: '#5b6bff', background: '#f5f3ff', border: '1.5px dashed #c4b5fd', cursor: 'pointer' }}>
              + إضافة {TYPE_LABELS[CHILD_TYPE[item.type]!]}
            </button>
          </Section>
        )}
      </div>

      <div style={{ padding: '14px 20px', borderTop: '1px solid #f0f0f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa' }}>
        <span style={{ fontSize: '12px', color: saveStatus === 'saved' ? '#16a34a' : saveStatus === 'saving' ? '#9ca3af' : 'transparent', transition: 'color 0.3s' }}>
          {saveStatus === 'saving' ? '⏳ جارٍ الحفظ...' : '✓ تم الحفظ'}
        </span>
        <button onClick={onDelete} style={{ width: '36px', height: '36px', borderRadius: '10px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#f87171', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🗑</button>
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
