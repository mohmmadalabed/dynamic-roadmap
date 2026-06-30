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

const WEEKS = 16
const WEEK_W = 62
const today = new Date()
const START_DATE = new Date(today.getFullYear(), today.getMonth(), 1)

function dateToX(d: string | null | undefined): number {
  if (!d) return 0
  const dt = new Date(d)
  const diff = (dt.getTime() - START_DATE.getTime()) / (1000 * 60 * 60 * 24 * 7)
  return Math.max(0, diff * WEEK_W)
}
function widthFromDates(s: string | null | undefined, e: string | null | undefined): number {
  if (!s || !e) return WEEK_W * 4
  const diff = (new Date(e).getTime() - new Date(s).getTime()) / (1000 * 60 * 60 * 24 * 7)
  return Math.max(WEEK_W, diff * WEEK_W)
}
function xToDate(x: number): string {
  const ms = START_DATE.getTime() + (x / WEEK_W) * 7 * 24 * 60 * 60 * 1000
  return new Date(ms).toISOString().split('T')[0]
}

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
    if (!collapsed.has(node.id) && node.children?.length) {
      result.push(...flattenTree(node.children, depth + 1, collapsed))
    }
  }
  return result
}

const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [items, setItems]     = useState<RoadmapItem[]>([])
  const itemsRef              = useRef<RoadmapItem[]>([])
  const [tree, setTree]       = useState<RoadmapItem[]>([])
  const [flat, setFlat]       = useState<Array<{ item: RoadmapItem; depth: number }>>([])
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set())
  const [selected, setSelected]     = useState<RoadmapItem | null>(null)
  const [hoveredId, setHoveredId]   = useState<string | null>(null)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [exporting, setExporting]   = useState(false)
  const [treeWidth, setTreeWidth]   = useState(290)
  const exportRef     = useRef<HTMLDivElement>(null)
  const treeResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

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

  useEffect(() => {
    if (tree.length) setFlat(flattenTree(tree, 0, collapsed))
  }, [collapsed, tree])

  const toggleCollapse = (itemId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
  }

  const addItem = async (parentId?: string, type: ItemType = 'goal') => {
    const newItem = {
      project_id: id!, parent_id: parentId ?? null, type,
      name: `${TYPE_LABELS[type]} جديد`, priority: 'medium' as Priority,
      status: 'not_started' as Status, position: items.length,
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 14*24*60*60*1000).toISOString().split('T')[0]
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
    setSelected(null)
    await reload()
  }

  // ── Export PDF (Canvas renderer) ─────────────────────────────────────────
  const exportPDF = async () => {
    if (exporting || flat.length === 0) return
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')

      // ── Layout constants ──
      const SCALE    = 3                  // high DPI
      const PNL_W    = 240                // tree panel width
      const TITLE_H  = 56                 // title section height
      const HDR_H    = 52                 // months + weeks header
      const ROW_H    = 40                 // row height
      const BAR_H    = 26                 // bar height
      const BAR_Y    = (ROW_H - BAR_H) / 2
      const HANDLE_W = 9
      const COLS     = WEEKS
      const COL_W    = WEEK_W
      const GANTT_W  = COLS * COL_W      // gantt area width (left side)

      const totalW = GANTT_W + PNL_W
      const totalH = TITLE_H + HDR_H + flat.length * ROW_H

      const cv  = document.createElement('canvas')
      cv.width  = totalW * SCALE
      cv.height = totalH * SCALE
      const ctx = cv.getContext('2d')!
      ctx.scale(SCALE, SCALE)

      const hexToRgb = (hex: string) => ({
        r: parseInt(hex.slice(1,3),16),
        g: parseInt(hex.slice(3,5),16),
        b: parseInt(hex.slice(5,7),16),
      })

      // ── Background ──
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, totalW, totalH)

      // ── Title section ──
      // Purple gradient background
      const grad = ctx.createLinearGradient(0, 0, totalW, 0)
      grad.addColorStop(0, '#5b6bff')
      grad.addColorStop(1, '#7c3aed')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, totalW, TITLE_H)

      // Logo mark
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.beginPath()
      ctx.roundRect(totalW - PNL_W - 20, 8, 40, 40, 8)
      ctx.fill()

      // Project name (right-aligned, Arabic)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 20px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(project?.name ?? 'خارطة الطريق', totalW - 16, 28)

      // Subtitle
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '12px sans-serif'
      ctx.fillText('خارطة الطريق التفاعلية', totalW - 16, 46)

      // Date & item count (left-aligned)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '12px sans-serif'
      ctx.textAlign = 'left'
      const exportDate = new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' })
      ctx.fillText(exportDate, 16, 26)
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.font = '11px sans-serif'
      ctx.fillText(`${flat.length} بند`, 16, 44)

      // ── Month headers ──
      ctx.fillStyle = '#f5f6fa'
      ctx.fillRect(0, TITLE_H, GANTT_W, 30)
      const months = Array.from({ length: 4 }, (_, i) => {
        const d = new Date(START_DATE); d.setMonth(d.getMonth() + i)
        return MONTHS[d.getMonth()]
      })
      const monthW = GANTT_W / 4
      months.forEach((m, i) => {
        if (i > 0) {
          ctx.strokeStyle = '#d1d5db'
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(i * monthW, TITLE_H); ctx.lineTo(i * monthW, TITLE_H + 30); ctx.stroke()
        }
        ctx.fillStyle = '#6b7280'
        ctx.font = 'bold 13px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(m, i * monthW + monthW / 2, TITLE_H + 21)
      })

      // ── Week headers ──
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, TITLE_H + 30, GANTT_W, 22)
      Array.from({ length: COLS }, (_, i) => {
        ctx.strokeStyle = '#e5e7eb'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(i * COL_W, TITLE_H + 30); ctx.lineTo(i * COL_W, TITLE_H + HDR_H); ctx.stroke()
        ctx.fillStyle = '#9ca3af'
        ctx.font = '11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(`${i+1}`, i * COL_W + COL_W / 2, TITLE_H + 45)
      })

      // ── Tree panel header ──
      ctx.fillStyle = '#f9fafb'
      ctx.fillRect(GANTT_W, TITLE_H, PNL_W, HDR_H)
      ctx.fillStyle = '#374151'
      ctx.font = 'bold 13px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText('البنود', totalW - 14, TITLE_H + 34)
      // item count badge
      const badgeX = GANTT_W + 12
      ctx.fillStyle = '#eef2ff'
      ctx.beginPath()
      ctx.roundRect(badgeX, TITLE_H + 16, 36, 20, 10)
      ctx.fill()
      ctx.fillStyle = '#5b6bff'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${flat.length}`, badgeX + 18, TITLE_H + 30)

      // ── Divider: gantt / tree panel ──
      ctx.strokeStyle = '#d1d5db'
      ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(GANTT_W, TITLE_H); ctx.lineTo(GANTT_W, totalH); ctx.stroke()

      // ── Header bottom line ──
      ctx.strokeStyle = '#d1d5db'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, TITLE_H + HDR_H); ctx.lineTo(totalW, TITLE_H + HDR_H); ctx.stroke()

      // ── Today line ──
      const todayPx = dateToX(today.toISOString().split('T')[0])
      ctx.strokeStyle = '#5b6bff'
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.moveTo(todayPx, TITLE_H + HDR_H); ctx.lineTo(todayPx, totalH); ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // ── Rows ──
      flat.forEach(({ item, depth }, idx) => {
        const current = items.find(i => i.id === item.id) ?? item
        const y = TITLE_H + HDR_H + idx * ROW_H

        // Row bg
        ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#fafafa'
        ctx.fillRect(0, y, totalW, ROW_H)

        // Row bottom border
        ctx.strokeStyle = '#e5e7eb'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, y + ROW_H); ctx.lineTo(totalW, y + ROW_H); ctx.stroke()

        // Vertical grid lines (gantt area)
        Array.from({ length: COLS }, (_, i) => {
          ctx.strokeStyle = '#e0e0e8'
          ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(i * COL_W, y); ctx.lineTo(i * COL_W, y + ROW_H); ctx.stroke()
        })

        // ── Bar ──
        const barLeft  = dateToX(current.start_date)
        const barWidth = widthFromDates(current.start_date, current.end_date)
        if (barWidth > 0 && barLeft < GANTT_W) {
          const tc = hexToRgb(TYPE_COLORS[current.type].bg)
          const pc = hexToRgb(PRIORITY_COLORS[current.priority])
          const clampedWidth = Math.min(barWidth, GANTT_W - barLeft)

          // Bar shadow
          ctx.shadowColor = 'rgba(0,0,0,0.12)'
          ctx.shadowBlur = 3
          ctx.shadowOffsetY = 1

          // Bar body
          ctx.fillStyle = `rgb(${tc.r},${tc.g},${tc.b})`
          ctx.beginPath()
          ctx.roundRect(barLeft, y + BAR_Y, clampedWidth, BAR_H, 5)
          ctx.fill()
          ctx.shadowColor = 'transparent'
          ctx.shadowBlur = 0
          ctx.shadowOffsetY = 0

          // Left handle (priority color)
          ctx.fillStyle = `rgb(${pc.r},${pc.g},${pc.b})`
          ctx.beginPath()
          ctx.roundRect(barLeft, y + BAR_Y, HANDLE_W, BAR_H, [5, 0, 0, 5])
          ctx.fill()

          // Right handle (priority color)
          if (clampedWidth >= HANDLE_W * 2) {
            ctx.beginPath()
            ctx.roundRect(barLeft + clampedWidth - HANDLE_W, y + BAR_Y, HANDLE_W, BAR_H, [0, 5, 5, 0])
            ctx.fill()
          }

          // Bar label
          if (clampedWidth > HANDLE_W * 2 + 20) {
            ctx.fillStyle = '#ffffff'
            ctx.font = '12px sans-serif'
            ctx.textAlign = 'left'
            const maxChars = Math.floor((clampedWidth - HANDLE_W * 2 - 10) / 7)
            const txt = current.name.length > maxChars ? current.name.slice(0, maxChars) + '…' : current.name
            ctx.fillText(txt, barLeft + HANDLE_W + 6, y + ROW_H / 2 + 4)
          }
        }

        // ── Tree panel: name (right side) ──
        const rightX = totalW - 14 - depth * 12

        // Priority dot (left side of panel near divider)
        const dotColor = hexToRgb(PRIORITY_COLORS[current.priority])
        ctx.fillStyle = `rgb(${dotColor.r},${dotColor.g},${dotColor.b})`
        ctx.beginPath()
        ctx.roundRect(GANTT_W + 10, y + ROW_H / 2 - 4, 8, 8, 2)
        ctx.fill()

        ctx.fillStyle = depth === 0 ? '#111827' : '#374151'
        ctx.font = depth === 0 ? 'bold 13px sans-serif' : '13px sans-serif'
        ctx.textAlign = 'right'
        const availW = PNL_W - 36 - depth * 12
        const maxC   = Math.floor(availW / 8)
        const raw    = `${TYPE_ICONS[current.type]} ${current.name}`
        const label  = raw.length > maxC ? raw.slice(0, maxC) + '…' : raw
        ctx.fillText(label, rightX, y + ROW_H / 2 + 5)
      })

      // ── Export to PDF ──
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const pdfW = 297; const pdfH = 210; const margin = 6

      const usableW = pdfW - margin * 2
      const usableH = pdfH - margin * 2
      const ratio   = Math.min(usableW / totalW, usableH / totalH)
      const drawW   = totalW * ratio
      const drawH   = totalH * ratio
      const offsetX = margin + (usableW - drawW) / 2
      const offsetY = margin + (usableH - drawH) / 2

      pdf.addImage(cv.toDataURL('image/png', 1.0), 'PNG', offsetX, offsetY, drawW, drawH)
      pdf.save(`roadmap-${project?.name ?? 'export'}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  // ── Tree panel resize ────────────────────────────────────────────────────
  const setupTreeResize = (e: React.MouseEvent) => {
    e.preventDefault()
    treeResizeRef.current = { startX: e.clientX, startWidth: treeWidth }
    const onMove = (ev: MouseEvent) => {
      if (!treeResizeRef.current) return
      // Moving mouse left → increase width (panel grows to the left)
      const dx = treeResizeRef.current.startX - ev.clientX
      setTreeWidth(Math.max(200, Math.min(520, treeResizeRef.current.startWidth + dx)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      treeResizeRef.current = null
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Inline rename ────────────────────────────────────────────────────────
  const startRename = (item: RoadmapItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(item.id)
    setEditingName(item.name)
  }

  const commitRename = async (itemId: string) => {
    const name = editingName.trim()
    if (name) await supabase.from('roadmap_items').update({ name }).eq('id', itemId)
    setEditingId(null)
    await reload()
  }

  // ── Bar drag (move + resize) ─────────────────────────────────────────────
  const dragRef = useRef<{
    type: 'move' | 'resize-left' | 'resize-right'
    id: string
    startX: number
    startLeft: number
    startWidth: number
  } | null>(null)

  const setupBarDrag = (
    e: React.MouseEvent,
    item: RoadmapItem,
    type: 'move' | 'resize-left' | 'resize-right'
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const startLeft  = dateToX(item.start_date)
    const startWidth = widthFromDates(item.start_date, item.end_date)
    dragRef.current  = { type, id: item.id, startX: e.clientX, startLeft, startWidth }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const { type: t, startLeft: sl, startWidth: sw } = dragRef.current
      let newLeft  = sl
      let newWidth = sw

      if (t === 'move') {
        newLeft = Math.max(0, sl + dx)
      } else if (t === 'resize-left') {
        newLeft  = Math.max(0, sl + dx)
        newWidth = Math.max(WEEK_W * 0.5, sw - dx)
      } else {
        newWidth = Math.max(WEEK_W * 0.5, sw + dx)
      }

      const newStart = xToDate(newLeft)
      const newEnd   = xToDate(newLeft + newWidth)
      setItems(prev => prev.map(i =>
        i.id === dragRef.current?.id ? { ...i, start_date: newStart, end_date: newEnd } : i
      ))
    }

    const onUp = async () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const moved = itemsRef.current.find(i => i.id === dragRef.current?.id)
      if (moved) {
        await supabase.from('roadmap_items').update({
          start_date: moved.start_date,
          end_date: moved.end_date
        }).eq('id', moved.id)
      }
      dragRef.current = null
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const todayX = dateToX(today.toISOString().split('T')[0])
  const months = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(START_DATE); d.setMonth(d.getMonth() + i)
    return MONTHS[d.getMonth()]
  })

  // Row height shared between tree and gantt
  const ROW_H = 44

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={exportPDF}
            disabled={exporting}
            style={{
              background: exporting ? '#f3f4f6' : '#fff',
              color: exporting ? '#9ca3af' : '#374151',
              border: '1px solid #e5e7eb',
              borderRadius: '8px', padding: '7px 14px', fontSize: '13px',
              fontWeight: '600', cursor: exporting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
            {exporting ? '⏳ جارٍ التصدير...' : '⬇ تصدير PDF'}
          </button>
          <button
            onClick={() => addItem(undefined, 'goal')}
            style={{
              background: '#5b6bff', color: '#fff', border: 'none',
              borderRadius: '8px', padding: '7px 16px', fontSize: '13px',
              fontWeight: '700', cursor: 'pointer',
            }}>
            + هدف جديد
          </button>
        </div>
      </header>

      <div
        style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
        onClick={e => {
          const panel = document.getElementById('side-panel')
          if (selected && panel && !panel.contains(e.target as Node)) {
            setSelected(null)
          }
        }}
      >

        {/* ── Tree Panel (first in DOM = RIGHT in RTL) ── */}
        <div style={{
          width: `${treeWidth}px`, flexShrink: 0, borderLeft: '1px solid #e5e7eb',
          background: '#fff', display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Resize handle (on left edge = faces the gantt) */}
          <div
            onMouseDown={setupTreeResize}
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '5px',
              cursor: 'col-resize', zIndex: 30,
              background: 'transparent', transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#c7d2fe')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          />
          <div style={{
            height: `${30 + 24}px`, padding: '0 16px 0 20px', borderBottom: '1px solid #d1d5db',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#f9fafb',
          }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#374151' }}>البنود</span>
            <span style={{
              fontSize: '12px', fontWeight: '700', padding: '2px 10px',
              borderRadius: '99px', background: '#eef2ff', color: '#5b6bff',
            }}>{flat.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {flat.map(({ item, depth }) => {
              const hasChildren = !!(item.children && item.children.length > 0)
              const isCollapsed = collapsed.has(item.id)
              const color       = PRIORITY_COLORS[item.priority]
              const isSelected  = selected?.id === item.id
              const isHovered   = hoveredId === item.id
              const isEditing   = editingId === item.id

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', height: `${ROW_H}px`,
                    gap: '6px', cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f5',
                    background: isSelected ? '#eef2ff' : isHovered ? '#f9fafb' : '#fff',
                    paddingRight: `${12 + depth * 16}px`,
                    paddingLeft: '10px',
                    transition: 'background 0.1s',
                  }}
                  onClick={() => !isEditing && setSelected(item)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <span
                    style={{ width: '16px', textAlign: 'center', color: '#d1d5db', fontSize: '11px', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); if (hasChildren) toggleCollapse(item.id) }}
                  >
                    {hasChildren ? (isCollapsed ? '▶' : '▼') : ''}
                  </span>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', flexShrink: 0 }}>{TYPE_ICONS[item.type]}</span>
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={() => commitRename(item.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(item.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        flex: 1, border: '1.5px solid #5b6bff', borderRadius: '6px',
                        padding: '2px 8px', fontSize: '13px', outline: 'none',
                        background: '#fff', minWidth: 0,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: isSelected ? '#5b6bff' : '#374151',
                        fontWeight: depth === 0 ? '700' : '400',
                      }}
                      onDoubleClick={e => startRename(item, e)}
                      title="انقر مرتين للتعديل"
                    >
                      {item.name}
                    </span>
                  )}
                  {CHILD_TYPE[item.type] && isHovered && !isEditing && (
                    <button
                      onClick={e => { e.stopPropagation(); addItem(item.id, CHILD_TYPE[item.type]!) }}
                      title={`إضافة ${TYPE_LABELS[CHILD_TYPE[item.type]!]}`}
                      style={{
                        width: '22px', height: '22px', borderRadius: '5px',
                        border: '1px solid #d1d5db', background: '#f9fafb',
                        color: '#6b7280', fontSize: '15px', lineHeight: 1,
                        cursor: 'pointer', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >+</button>
                  )}
                </div>
              )
            })}
            {flat.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '160px', color: '#d1d5db' }}>
                <p style={{ fontSize: '14px', margin: '0 0 8px' }}>لا توجد بنود بعد</p>
                <button onClick={() => addItem(undefined, 'goal')} style={{ fontSize: '13px', color: '#5b6bff', background: 'none', border: 'none', cursor: 'pointer' }}>
                  + أضف هدفاً
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Gantt (middle) ── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div ref={exportRef} style={{ minWidth: `${WEEKS * WEEK_W}px` }}>
            {/* Month headers */}
            <div style={{ display: 'flex', height: '30px', position: 'sticky', top: 0, zIndex: 10, background: '#f5f6fa', borderBottom: '1px solid #d1d5db' }}>
              {months.map((m, i) => (
                <div key={i} style={{
                  flex: 1, borderLeft: i > 0 ? '1px solid #d1d5db' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '13px', fontWeight: '700', color: '#6b7280',
                }}>{m}</div>
              ))}
            </div>

            {/* Week headers */}
            <div style={{ display: 'flex', height: '24px', position: 'sticky', top: '30px', zIndex: 10, background: '#fff', borderBottom: '1px solid #d1d5db' }}>
              {Array.from({ length: WEEKS }, (_, i) => (
                <div key={i} style={{
                  width: `${WEEK_W}px`, borderLeft: i > 0 ? '1px solid #e0e0e8' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', color: '#9ca3af', fontWeight: '600',
                }}>{i + 1}</div>
              ))}
            </div>

            {/* Rows */}
            <div style={{ position: 'relative' }}>
              {/* Today line */}
              <div style={{
                position: 'absolute', top: 0, bottom: 0, left: `${todayX}px`,
                width: '2px', background: '#5b6bff', opacity: 0.5, zIndex: 20, pointerEvents: 'none',
              }} />

              {flat.map(({ item }) => {
                const currentItem   = items.find(i => i.id === item.id) ?? item
                const barLeft       = dateToX(currentItem.start_date)
                const barWidth      = widthFromDates(currentItem.start_date, currentItem.end_date)
                const typeColor     = TYPE_COLORS[currentItem.type]
                const priorityColor = PRIORITY_COLORS[currentItem.priority]

                return (
                  <div key={item.id} style={{
                    position: 'relative', height: `${ROW_H}px`,
                    borderBottom: '1px solid #e5e7eb',
                    background: selected?.id === item.id ? '#fafbff' : 'transparent',
                  }}>
                    {/* Grid lines */}
                    {Array.from({ length: WEEKS }, (_, i) => (
                      <div key={i} style={{
                        position: 'absolute', top: 0, bottom: 0, left: `${i * WEEK_W}px`,
                        borderLeft: '1px solid #e0e0e8',
                      }} />
                    ))}

                    {/* Bar */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%', transform: 'translateY(-50%)',
                        left: `${barLeft}px`, width: `${barWidth}px`,
                        height: '28px', borderRadius: '6px',
                        display: 'flex', alignItems: 'center',
                        fontSize: '12px', fontWeight: '600',
                        userSelect: 'none', cursor: 'grab',
                        overflow: 'hidden',
                        background: typeColor.bg,
                        color: typeColor.text,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                      }}
                      onMouseDown={e => setupBarDrag(e, currentItem, 'move')}
                      onClick={() => setSelected(item)}
                    >
                      {/* Left resize handle */}
                      <div
                        style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: '10px', cursor: 'ew-resize',
                          background: priorityColor,
                          borderRadius: '6px 0 0 6px',
                          flexShrink: 0, zIndex: 2,
                        }}
                        onMouseDown={e => setupBarDrag(e, currentItem, 'resize-left')}
                      />

                      {/* Label */}
                      <span style={{ paddingRight: '16px', paddingLeft: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {TYPE_ICONS[currentItem.type]} {currentItem.name}
                      </span>

                      {/* Right resize handle */}
                      <div
                        style={{
                          position: 'absolute', right: 0, top: 0, bottom: 0,
                          width: '10px', cursor: 'ew-resize',
                          background: priorityColor,
                          borderRadius: '0 6px 6px 0',
                          zIndex: 2,
                        }}
                        onMouseDown={e => setupBarDrag(e, currentItem, 'resize-right')}
                      />
                    </div>
                  </div>
                )
              })}

              {flat.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#d1d5db', fontSize: '14px' }}>
                  اسحب الأشرطة لتغيير التواريخ · انقر مرتين على الاسم للتعديل
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Side Panel (last in DOM = LEFT in RTL) ── */}
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

      {/* Footer */}
      <div style={{
        background: '#fff', borderTop: '1px solid #e5e7eb', height: '42px',
        display: 'flex', alignItems: 'center', gap: '20px', padding: '0 16px',
      }}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#9ca3af' }}>الأولوية:</span>
        {(Object.entries(PRIORITY_COLORS) as [Priority, string][]).map(([p, c]) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#6b7280' }}>
            <div style={{ width: '9px', height: '9px', borderRadius: '2px', background: c }} />
            {p === 'critical' ? 'حرج' : p === 'high' ? 'عالي' : p === 'medium' ? 'متوسط' : 'منخفض'}
          </div>
        ))}
        <span style={{ marginRight: 'auto', fontSize: '12px', color: '#d1d5db' }}>
          💡 اسحب المنتصف للتحريك · اسحب الحواف لتغيير المدة · انقر مرتين على الاسم للتعديل
        </span>
      </div>
    </div>
  )
}

// ─── Side Panel ────────────────────────────────────────────────────────────
function SidePanel({ item, onSave, onDelete, onClose, onAddChild }: {
  item: RoadmapItem
  onSave: (u: Partial<RoadmapItem>) => void
  onDelete: () => void
  onClose: () => void
  onAddChild?: () => void
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
  const statuses: Status[] = ['not_started', 'in_progress', 'done', 'blocked']
  const PRIORITY_LABELS: Record<Priority, string> = { critical: 'حرج', high: 'عالي', medium: 'متوسط', low: 'منخفض' }

  return (
    <div id="side-panel" style={{ width: '360px', flexShrink: 0, background: '#fff', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e7eb', boxShadow: '-4px 0 16px rgba(0,0,0,0.06)' }}>
      {/* Header */}
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
        <Section>
          <Field label="الاسم">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم البند"
              style={inputStyle} onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
          </Field>
        </Section>

        <Section>
          <Field label="الوصف">
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="وصف تفصيلي (اختياري)"
              style={{ ...inputStyle, resize: 'none', lineHeight: '1.6' } as React.CSSProperties}
              onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
          </Field>
        </Section>

        <Section>
          <Field label="المدة الزمنية">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>البداية</span>
                <input type="date" value={start} onChange={e => setStart(e.target.value)}
                  style={{ ...inputStyle, fontSize: '13px', padding: '8px 10px' }}
                  onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>النهاية</span>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                  style={{ ...inputStyle, fontSize: '13px', padding: '8px 10px' }}
                  onFocus={e => (e.target.style.borderColor = '#5b6bff')} onBlur={e => (e.target.style.borderColor = '#e5e7eb')} />
              </div>
            </div>
          </Field>
        </Section>

        <Section>
          <Field label="الأولوية">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {priorities.map(p => (
                <button key={p} onClick={() => setPriority(p)} style={{
                  padding: '8px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  background: priority === p ? `${PRIORITY_COLORS[p]}12` : '#f9fafb',
                  color: priority === p ? PRIORITY_COLORS[p] : '#9ca3af',
                  border: priority === p ? `1.5px solid ${PRIORITY_COLORS[p]}50` : '1.5px solid transparent',
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: PRIORITY_COLORS[p], flexShrink: 0 }} />
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </Field>
        </Section>

        <Section>
          <Field label="الحالة">
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
          </Field>
        </Section>

        {onAddChild && (
          <Section>
            <button onClick={onAddChild} style={{
              width: '100%', padding: '11px', borderRadius: '10px', fontSize: '14px',
              fontWeight: '600', color: '#5b6bff', background: '#f5f3ff',
              border: '1.5px dashed #c4b5fd', cursor: 'pointer',
            }}>
              + إضافة {TYPE_LABELS[CHILD_TYPE[item.type]!]}
            </button>
          </Section>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid #f0f0f5', display: 'flex', gap: '10px', background: '#fafafa' }}>
        <button onClick={save} style={{
          flex: 1, padding: '11px', borderRadius: '10px', background: '#5b6bff',
          color: '#fff', fontWeight: '700', fontSize: '14px', border: 'none', cursor: 'pointer',
        }}>حفظ التغييرات</button>
        <button onClick={onDelete} style={{
          width: '44px', height: '44px', borderRadius: '10px', border: '1px solid #fee2e2',
          background: '#fef2f2', color: '#f87171', cursor: 'pointer', fontSize: '16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>🗑</button>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid #e5e7eb', borderRadius: '10px',
  padding: '10px 14px', fontSize: '14px', background: '#f9fafb',
  outline: 'none', width: '100%', transition: 'border-color 0.15s',
  fontFamily: 'inherit',
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
