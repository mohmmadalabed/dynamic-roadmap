import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Project, RoadmapItem, Priority, Status, ItemType } from '../types'

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#d97706', low: '#3b82f6'
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

const ZOOM_LABELS = ['يوم', 'أسبوع', 'شهر', 'ربع']
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

export default function TimelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [items, setItems]     = useState<RoadmapItem[]>([])
  const [tree, setTree]       = useState<RoadmapItem[]>([])
  const [flat, setFlat]       = useState<Array<{ item: RoadmapItem; depth: number }>>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected]   = useState<RoadmapItem | null>(null)
  const [zoom, setZoom]           = useState(1)
  const dragRef = useRef<{ id: string; startX: number; startRight: number } | null>(null)

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

  // Drag bar
  const onBarMouseDown = (e: React.MouseEvent, item: RoadmapItem) => {
    e.preventDefault()
    dragRef.current = { id: item.id, startX: e.clientX, startRight: dateToX(item.start_date) }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const newRight = Math.max(0, dragRef.current.startRight + dx)
      const newStart = xToDate(newRight)
      const dur = item.end_date && item.start_date
        ? new Date(item.end_date).getTime() - new Date(item.start_date).getTime() : 14*24*60*60*1000
      const newEnd = new Date(new Date(newStart).getTime() + dur).toISOString().split('T')[0]
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, start_date: newStart, end_date: newEnd } : i))
    }
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const moved = items.find(i => i.id === dragRef.current?.id)
      if (moved) await supabase.from('roadmap_items').update({ start_date: moved.start_date, end_date: moved.end_date }).eq('id', moved.id)
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Topbar */}
      <header className="bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate('/')} className="text-gray-400 hover:text-indigo-500 transition">المشاريع</button>
          <span className="text-gray-300">/</span>
          <span className="font-bold">{project?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {ZOOM_LABELS.map((l, i) => (
              <button key={l} onClick={() => setZoom(i)}
                className={`px-3 py-1.5 text-xs font-medium border-l border-gray-200 first:border-l-0 transition ${zoom === i ? 'bg-indigo-50 text-indigo-600 font-bold' : 'text-gray-400 hover:text-gray-600'}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => addItem(undefined, 'goal')}
            className="text-sm font-semibold text-white px-4 py-1.5 rounded-lg shadow"
            style={{ background: '#5b6bff' }}>+ هدف جديد</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Tree Panel */}
        <div className="w-72 shrink-0 border-l border-gray-200 bg-white flex flex-col">
          <div className="h-12 px-4 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500">البنود</span>
            <span className="text-xs bg-indigo-50 text-indigo-500 font-bold px-2.5 py-1 rounded-full">{flat.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {flat.map(({ item, depth }) => {
              const hasChildren = item.children && item.children.length > 0
              const isCollapsed = collapsed.has(item.id)
              const color = PRIORITY_COLORS[item.priority]
              const isSelected = selected?.id === item.id
              return (
                <div key={item.id}
                  className={`flex items-center h-10 gap-1 cursor-pointer border-b border-gray-50 transition ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                  style={{ paddingRight: `${12 + depth * 16}px`, paddingLeft: '12px' }}
                  onClick={() => setSelected(item)}>
                  <span className="w-4 text-center text-gray-300 text-xs shrink-0"
                    onClick={e => { e.stopPropagation(); if (hasChildren) toggleCollapse(item.id) }}>
                    {hasChildren ? (isCollapsed ? '▶' : '▼') : ''}
                  </span>
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                  <span className={`text-xs flex-1 truncate ${isSelected ? 'text-indigo-600 font-semibold' : 'text-gray-700'} ${depth === 0 ? 'font-bold' : ''}`}>
                    {TYPE_ICONS[item.type]} {item.name}
                  </span>
                  {CHILD_TYPE[item.type] && (
                    <button className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-gray-300 hover:text-indigo-500 text-sm w-5 transition"
                      onClick={e => { e.stopPropagation(); addItem(item.id, CHILD_TYPE[item.type]!) }}>+</button>
                  )}
                </div>
              )
            })}
            {flat.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-gray-300">
                <p className="text-sm">لا توجد بنود بعد</p>
                <button onClick={() => addItem(undefined, 'goal')} className="mt-2 text-xs text-indigo-400 hover:underline">+ أضف هدفاً</button>
              </div>
            )}
          </div>
        </div>

        {/* Gantt */}
        <div className="flex-1 overflow-auto">
          <div style={{ minWidth: WEEKS * WEEK_W + 'px' }}>
            {/* Month headers */}
            <div className="flex h-6 sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              {months.map((m, i) => (
                <div key={i} className="flex-1 border-l border-gray-200 first:border-l-0 flex items-center justify-center text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {m}
                </div>
              ))}
            </div>
            {/* Week headers */}
            <div className="flex h-5 sticky top-6 z-10 bg-white border-b border-gray-200">
              {Array.from({ length: WEEKS }, (_, i) => (
                <div key={i} className="border-l border-gray-100 first:border-l-0 flex items-center justify-center text-xs text-gray-300 font-medium"
                  style={{ width: WEEK_W }}>W{i + 1}</div>
              ))}
            </div>
            {/* Rows */}
            <div className="relative">
              {/* Today line */}
              <div className="absolute top-0 bottom-0 w-0.5 bg-indigo-400 opacity-60 z-20 pointer-events-none"
                style={{ left: todayX }}>
                <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs bg-indigo-100 text-indigo-600 font-bold px-1.5 rounded whitespace-nowrap">اليوم</span>
              </div>

              {flat.map(({ item }) => {
                const barLeft  = dateToX(item.start_date)
                const barWidth = widthFromDates(item.start_date, item.end_date)
                const color    = PRIORITY_COLORS[item.priority]
                const isGoal   = item.type === 'goal'
                return (
                  <div key={item.id} className="relative h-10 border-b border-gray-50 hover:bg-indigo-50/30 transition">
                    {Array.from({ length: WEEKS }, (_, i) => (
                      <div key={i} className="absolute top-0 bottom-0 border-l border-gray-100"
                        style={{ left: i * WEEK_W }} />
                    ))}
                    <div className="absolute top-1/2 -translate-y-1/2 h-6 rounded-md flex items-center px-3 text-xs font-semibold select-none cursor-grab shadow-sm hover:shadow-md hover:scale-y-105 transition-all"
                      style={{
                        left: barLeft, width: barWidth,
                        background: isGoal ? `${color}18` : `linear-gradient(90deg, ${color}, ${color}dd)`,
                        color: isGoal ? color : '#fff',
                        border: isGoal ? `1.5px solid ${color}55` : 'none',
                      }}
                      onMouseDown={e => onBarMouseDown(e, item)}
                      onClick={() => setSelected(item)}>
                      {TYPE_ICONS[item.type]} {item.name}
                    </div>
                  </div>
                )
              })}
              {flat.length === 0 && (
                <div className="flex items-center justify-center h-48 text-gray-300 text-sm">
                  اسحب الأشرطة لتغيير التواريخ · انقر لتحرير البند
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Side Panel */}
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

      {/* Footer legend */}
      <div className="bg-white border-t border-gray-200 h-10 flex items-center gap-5 px-4">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">الأولوية:</span>
        {(Object.entries(PRIORITY_COLORS) as [Priority, string][]).map(([p, c]) => (
          <div key={p} className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-2.5 h-2.5 rounded" style={{ background: c }} />
            {p === 'critical' ? 'حرج' : p === 'high' ? 'عالي' : p === 'medium' ? 'متوسط' : 'منخفض'}
          </div>
        ))}
        <span className="mr-auto text-xs text-gray-300">💡 اسحب الأشرطة لتغيير التواريخ · انقر لتحرير البند</span>
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
    <div className="w-96 shrink-0 bg-white flex flex-col" style={{ borderRight: '1px solid #e5e7eb', boxShadow: '-4px 0 16px rgba(0,0,0,0.06)' }}>
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: PRIORITY_COLORS[item.priority] }}>
            {TYPE_ICONS[item.type]}
          </span>
          <span className="text-sm font-semibold text-gray-700">{TYPE_LABELS[item.type]}</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: `${PRIORITY_COLORS[item.priority]}15`, color: PRIORITY_COLORS[item.priority] }}>
            {PRIORITY_LABELS[item.priority]}
          </span>
        </div>
        <button onClick={onClose}
          className="w-8 h-8 rounded-lg border border-gray-200 bg-gray-50 text-gray-400 hover:text-red-400 hover:border-red-200 transition flex items-center justify-center text-sm font-bold">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Name */}
        <div className="px-6 py-5 border-b border-gray-50">
          <Field label="الاسم">
            <input value={name} onChange={e => setName(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 outline-none focus:border-indigo-400 focus:bg-white w-full transition"
              placeholder="اسم البند" />
          </Field>
        </div>

        {/* Description */}
        <div className="px-6 py-5 border-b border-gray-50">
          <Field label="الوصف">
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4}
              className="border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 outline-none focus:border-indigo-400 focus:bg-white w-full resize-none transition leading-relaxed"
              placeholder="وصف تفصيلي (اختياري)" />
          </Field>
        </div>

        {/* Dates */}
        <div className="px-6 py-5 border-b border-gray-50">
          <Field label="المدة الزمنية">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">البداية</span>
                <input type="date" value={start} onChange={e => setStart(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-xs bg-gray-50 outline-none focus:border-indigo-400 focus:bg-white transition" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">النهاية</span>
                <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-xs bg-gray-50 outline-none focus:border-indigo-400 focus:bg-white transition" />
              </div>
            </div>
          </Field>
        </div>

        {/* Priority */}
        <div className="px-6 py-5 border-b border-gray-50">
          <Field label="الأولوية">
            <div className="grid grid-cols-2 gap-2">
              {priorities.map(p => (
                <button key={p} onClick={() => setPriority(p)}
                  className="py-2.5 px-3 rounded-xl text-xs font-semibold transition flex items-center gap-2"
                  style={{
                    background: priority === p ? `${PRIORITY_COLORS[p]}15` : '#f9fafb',
                    color: priority === p ? PRIORITY_COLORS[p] : '#9ca3af',
                    border: priority === p ? `1.5px solid ${PRIORITY_COLORS[p]}50` : '1.5px solid transparent',
                    outline: 'none',
                  }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLORS[p] }} />
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Status */}
        <div className="px-6 py-5 border-b border-gray-50">
          <Field label="الحالة">
            <div className="flex flex-col gap-2">
              {statuses.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className="py-2.5 px-4 rounded-xl text-sm font-medium text-right transition"
                  style={{
                    background: status === s ? '#5b6bff' : '#f9fafb',
                    color: status === s ? '#fff' : '#6b7280',
                  }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Add child */}
        {onAddChild && (
          <div className="px-6 py-5">
            <button onClick={onAddChild}
              className="w-full text-sm text-indigo-500 border-2 border-dashed border-indigo-200 rounded-xl py-3 hover:bg-indigo-50 hover:border-indigo-300 transition font-medium">
              + إضافة {TYPE_LABELS[CHILD_TYPE[item.type]!]}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-100 flex gap-3" style={{ background: '#fafafa' }}>
        <button onClick={save}
          className="flex-1 py-3 rounded-xl text-white text-sm font-bold transition hover:opacity-90 active:scale-[0.98]"
          style={{ background: '#5b6bff' }}>
          حفظ التغييرات
        </button>
        <button onClick={onDelete}
          className="w-12 h-12 rounded-xl border border-red-100 bg-red-50 text-red-400 hover:bg-red-100 transition flex items-center justify-center text-base">
          🗑
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <label className="text-xs font-bold text-gray-400">{label}</label>
      {children}
    </div>
  )
}
