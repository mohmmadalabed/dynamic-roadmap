import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import DatePicker from '../components/DatePicker'
import { track as trackLoading } from '../lib/loadingBar'
import type { Project, BusinessPhase, BusinessOKRItem, DepartmentType, SectionType } from '../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPTS: { k: DepartmentType; label: string; hbg: string; htc: string; ic: string }[] = [
  { k: 'product',   label: 'المنتج والتطوير',   hbg: '#E6F1FB', htc: '#0C447C', ic: '#185FA5' },
  { k: 'marketing', label: 'التسويق والعلاقات', hbg: '#EEEDFE', htc: '#3C3489', ic: '#534AB7' },
  { k: 'sales',     label: 'المبيعات والدعم',   hbg: '#E1F5EE', htc: '#085041', ic: '#0F6E56' },
]

const SECS: { k: SectionType; label: string; addLabel: string; placeholder: string }[] = [
  { k: 'obj',  label: 'الأهداف',              addLabel: 'إضافة هدف',   placeholder: 'اكتب الهدف هنا...' },
  { k: 'kr',   label: 'النتائج المفتاحية',    addLabel: 'إضافة نتيجة', placeholder: 'اكتب النتيجة هنا...' },
  { k: 'act',  label: 'الأنشطة',              addLabel: 'إضافة نشاط',  placeholder: 'اكتب النشاط هنا...' },
  { k: 'del',  label: 'المخرجات / KPI',       addLabel: 'إضافة مخرج',  placeholder: 'اكتب المخرج هنا...' },
  { k: 'res',  label: 'الموارد',               addLabel: 'إضافة مورد',  placeholder: 'اكتب المورد هنا...' },
  { k: 'cost', label: 'التكلفة',               addLabel: 'إضافة تكلفة', placeholder: 'اكتب بند التكلفة هنا...' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return ''
  const d = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
  if (d <= 0) return '—'
  if (d < 30) return `${d} يوم`
  const m = Math.floor(d / 30)
  const r = d % 30
  const ml = m === 1 ? 'شهر' : m === 2 ? 'شهران' : `${m} أشهر`
  return r > 0 ? `${ml} و${r} يوم` : ml
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BusinessRoadmapPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project,       setProject]       = useState<Project | null>(null)
  const [phases,        setPhases]        = useState<BusinessPhase[]>([])
  const [items,         setItems]         = useState<BusinessOKRItem[]>([])
  const [activePhaseId, setActivePhaseId] = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [collapsed,     setCollapsed]     = useState<Set<string>>(new Set())

  // Inline item adding
  const [adding,   setAdding]   = useState<{ dept: DepartmentType; sec: SectionType } | null>(null)
  const [addText,  setAddText]  = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  // Add phase modal
  const [showPhaseModal, setShowPhaseModal] = useState(false)
  const [phaseForm,      setPhaseForm]      = useState({ name: '', start: '', end: '' })
  const [savingPhase,    setSavingPhase]    = useState(false)

  // PDF export
  const [exporting, setExporting] = useState(false)

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return

    const loadAll = async () => {
      const [{ data: proj }, { data: phasesData }] = await trackLoading(Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('business_phases').select('*').eq('project_id', id).order('order_index'),
      ]))

      if (proj)       setProject(proj)
      if (phasesData) {
        setPhases(phasesData)
        if (phasesData.length > 0) {
          setActivePhaseId(phasesData[0].id)
          // Load OKR items for all phases in this project
          const phaseIds = phasesData.map((p: BusinessPhase) => p.id)
          const { data: itemsData } = await supabase
            .from('business_okr_items')
            .select('*')
            .in('phase_id', phaseIds)
            .order('order_index')
          if (itemsData) setItems(itemsData)
        }
      }
      setLoading(false)
    }

    loadAll()
  }, [id])

  // Focus the add input when it appears
  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  // ── Derived ─────────────────────────────────────────────────────────────────

  const activePhase = phases.find(p => p.id === activePhaseId) ?? null

  const sectionItems = (dept: DepartmentType, sec: SectionType): BusinessOKRItem[] =>
    items
      .filter(i => i.phase_id === activePhaseId && i.department === dept && i.section_type === sec)
      .sort((a, b) => a.order_index - b.order_index)

  const itemsForPhase = (phaseId: string, dept: DepartmentType, sec: SectionType): BusinessOKRItem[] =>
    items
      .filter(i => i.phase_id === phaseId && i.department === dept && i.section_type === sec)
      .sort((a, b) => a.order_index - b.order_index)

  // ── Handlers ────────────────────────────────────────────────────────────────

  const switchPhase = (phaseId: string) => {
    setActivePhaseId(phaseId)
    setAdding(null)
    setAddText('')
  }

  const toggleSection = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const startAdd = (dept: DepartmentType, sec: SectionType) => {
    setAdding({ dept, sec })
    setAddText('')
  }

  const cancelAdd = () => { setAdding(null); setAddText('') }

  const confirmAdd = async () => {
    if (!addText.trim() || !activePhaseId || !adding) return
    const existing = sectionItems(adding.dept, adding.sec)
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(i => i.order_index)) : -1
    const { data } = await supabase
      .from('business_okr_items')
      .insert({
        phase_id:     activePhaseId,
        department:   adding.dept,
        section_type: adding.sec,
        content:      addText.trim(),
        order_index:  maxOrder + 1,
      })
      .select()
      .single()
    if (data) setItems(prev => [...prev, data])
    setAdding(null)
    setAddText('')
  }

  const deleteItem = async (itemId: string) => {
    await supabase.from('business_okr_items').delete().eq('id', itemId)
    setItems(prev => prev.filter(i => i.id !== itemId))
  }

  const updatePhaseDate = async (field: 'start_date' | 'end_date', value: string) => {
    if (!activePhaseId) return
    const val = value || null
    await supabase.from('business_phases').update({ [field]: val }).eq('id', activePhaseId)
    setPhases(prev => prev.map(p => p.id === activePhaseId ? { ...p, [field]: val } : p))
  }

  const updatePhaseName = async (value: string) => {
    if (!activePhaseId || !value.trim()) return
    await supabase.from('business_phases').update({ name: value.trim() }).eq('id', activePhaseId)
    setPhases(prev => prev.map(p => p.id === activePhaseId ? { ...p, name: value.trim() } : p))
  }

  const updateProjectName = async (value: string) => {
    if (!id || !value.trim() || !project) return
    const name = value.trim()
    if (name === project.name) return
    await supabase.from('projects').update({ name }).eq('id', id)
    setProject(prev => prev ? { ...prev, name } : prev)
  }

  const addPhase = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !phaseForm.name.trim()) return
    setSavingPhase(true)
    const { data } = await supabase
      .from('business_phases')
      .insert({
        project_id:  id,
        name:        phaseForm.name.trim(),
        start_date:  phaseForm.start || null,
        end_date:    phaseForm.end   || null,
        order_index: phases.length,
      })
      .select()
      .single()
    if (data) {
      setPhases(prev => [...prev, data])
      setActivePhaseId(data.id)
    }
    setShowPhaseModal(false)
    setPhaseForm({ name: '', start: '', end: '' })
    setSavingPhase(false)
  }

  // ── PDF Export (all phases, multi-page) ────────────────────────────────────
  const exportPDF = async () => {
    if (exporting || phases.length === 0) return
    setExporting(true)
    try {
      const { default: jsPDF } = await import('jspdf')

      const PAGE_W    = 1000
      const pW = 297, pH = 210, mg = 6                 // A4 landscape, mm
      const printW    = pW - mg * 2
      const printH    = pH - mg * 2
      const ratio     = printW / PAGE_W                // mm per design-px
      const availH    = Math.floor(printH / ratio)
      const SCALE     = 2

      const COL_W       = PAGE_W / 3
      const TITLE_H     = 64
      const DEPT_H      = 32
      const SEC_LABEL_H = 22
      const LINE_H      = 15
      const ITEM_GAP    = 4
      const CELL_PAD    = 10
      const MIN_ROW_H   = 40
      const FOOTER_H    = 20

      const measureCv = document.createElement('canvas')
      const mctx = measureCv.getContext('2d')!
      mctx.font = '11px sans-serif'

      const wrapText = (text: string, maxWidth: number): string[] => {
        const words = text.split(' ')
        const lines: string[] = []
        let cur = ''
        for (const w of words) {
          const test = cur ? `${cur} ${w}` : w
          if (mctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w }
          else cur = test
        }
        if (cur) lines.push(cur)
        return lines.length ? lines : ['']
      }

      const cellInnerW = COL_W - CELL_PAD * 2 - 14

      type PreparedItem = { lines: string[] }
      type PreparedSection = { sec: typeof SECS[number]; cells: PreparedItem[][]; rowH: number }
      type PreparedPhase = { phase: BusinessPhase; sections: PreparedSection[] }

      const preparedPhases: PreparedPhase[] = phases.map(phase => {
        const sections: PreparedSection[] = SECS.map(sec => {
          const cells = DEPTS.map(dept =>
            itemsForPhase(phase.id, dept.k, sec.k).map(it => ({ lines: wrapText(it.content, cellInnerW) }))
          )
          const cellHeights = cells.map(cellItems =>
            cellItems.reduce((sum, it) => sum + it.lines.length * LINE_H + ITEM_GAP, 0)
          )
          const rowH = Math.max(MIN_ROW_H, SEC_LABEL_H + Math.max(0, ...cellHeights) + CELL_PAD)
          return { sec, cells, rowH }
        })
        return { phase, sections }
      })

      // Paginate: chunk each phase's section rows across pages that fit availH
      type PageSpec = { phase: BusinessPhase; sections: PreparedSection[]; isFirstOfPhase: boolean }
      const pages: PageSpec[] = []
      preparedPhases.forEach(pp => {
        let current: PreparedSection[] = []
        let usedH = 0
        let isFirst = true
        const flush = () => {
          if (current.length === 0) return
          pages.push({ phase: pp.phase, sections: current, isFirstOfPhase: isFirst })
          current = []; usedH = 0; isFirst = false
        }
        pp.sections.forEach(s => {
          const overhead = (isFirst ? TITLE_H : 0) + DEPT_H + FOOTER_H
          const avail = availH - overhead
          if (current.length > 0 && usedH + s.rowH > avail) flush()
          current.push(s); usedH += s.rowH
        })
        flush()
      })

      const hexToRgb = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) })
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

      pages.forEach((page, pageIdx) => {
        const topH     = page.isFirstOfPhase ? TITLE_H : 0
        const contentH = page.sections.reduce((s, sec) => s + sec.rowH, 0)
        const pageH    = topH + DEPT_H + contentH + FOOTER_H

        const cv = document.createElement('canvas')
        cv.width = PAGE_W * SCALE; cv.height = pageH * SCALE
        const ctx = cv.getContext('2d')!; ctx.scale(SCALE, SCALE)
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE_W, pageH)

        let y = 0
        if (page.isFirstOfPhase) {
          const grad = ctx.createLinearGradient(0, 0, PAGE_W, 0)
          grad.addColorStop(0, '#534AB7'); grad.addColorStop(1, '#7c3aed')
          ctx.fillStyle = grad; ctx.fillRect(0, 0, PAGE_W, TITLE_H)
          ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText(page.phase.name, PAGE_W - 16, 28)
          ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '12px sans-serif'
          ctx.fillText(project?.name ?? 'خارطة البزنز', PAGE_W - 16, 46)
          const dur = calcDuration(page.phase.start_date, page.phase.end_date)
          const dateStr = [page.phase.start_date, page.phase.end_date].filter(Boolean).join('  →  ')
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'left'; ctx.font = '12px sans-serif'
          ctx.fillText(dateStr || 'بدون تواريخ محددة', 16, 26)
          if (dur) { ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '11px sans-serif'; ctx.fillText(`المدة: ${dur}`, 16, 44) }
          y = TITLE_H
        }

        // Department headers
        DEPTS.forEach((dept, di) => {
          ctx.fillStyle = dept.hbg; ctx.fillRect(di * COL_W, y, COL_W, DEPT_H)
          ctx.fillStyle = dept.htc; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'
          ctx.fillText(dept.label, di * COL_W + COL_W / 2, y + DEPT_H / 2 + 4)
        })
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1
        for (let ci = 1; ci < 3; ci++) { ctx.beginPath(); ctx.moveTo(ci * COL_W, y); ctx.lineTo(ci * COL_W, y + DEPT_H); ctx.stroke() }
        y += DEPT_H

        page.sections.forEach(section => {
          const rowTop = y
          ctx.fillStyle = '#fafafa'; ctx.fillRect(0, rowTop, PAGE_W, section.rowH)
          ctx.fillStyle = '#f0f0f5'; ctx.fillRect(0, rowTop, PAGE_W, SEC_LABEL_H)
          ctx.fillStyle = '#374151'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'right'
          ctx.fillText(section.sec.label, PAGE_W - 10, rowTop + 15)

          DEPTS.forEach((dept, di) => {
            const cellX = di * COL_W
            let cy = rowTop + SEC_LABEL_H + 12
            const cellItems = section.cells[di]
            if (cellItems.length === 0) {
              ctx.fillStyle = '#c4c9d4'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
              ctx.fillText('—', cellX + COL_W / 2, cy)
            } else {
              cellItems.forEach(it => {
                const rc = hexToRgb(dept.ic)
                ctx.fillStyle = `rgb(${rc.r},${rc.g},${rc.b})`
                ctx.beginPath(); ctx.arc(cellX + COL_W - CELL_PAD - 4, cy - 4, 2.5, 0, Math.PI * 2); ctx.fill()
                ctx.fillStyle = '#374151'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right'
                it.lines.forEach((line, li) => ctx.fillText(line, cellX + COL_W - CELL_PAD - 12, cy + li * LINE_H))
                cy += it.lines.length * LINE_H + ITEM_GAP
              })
            }
          })

          ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1
          for (let ci = 1; ci < 3; ci++) { ctx.beginPath(); ctx.moveTo(ci * COL_W, rowTop); ctx.lineTo(ci * COL_W, rowTop + section.rowH); ctx.stroke() }
          ctx.beginPath(); ctx.moveTo(0, rowTop + section.rowH); ctx.lineTo(PAGE_W, rowTop + section.rowH); ctx.stroke()

          y += section.rowH
        })

        ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1
        ctx.strokeRect(0.5, topH + 0.5, PAGE_W - 1, DEPT_H + contentH - 1)

        // Footer: page number + credit line. Drawn as two separate fillText calls
        // (Arabic prefix, then the Latin domain) so we know the exact pixel box of
        // "malabed.com" to attach a real clickable link over it — no guessing at
        // bidi-reordered glyph positions from a single mixed-direction string.
        const footerY = pageH - FOOTER_H / 2
        ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText(`${pageIdx + 1} / ${pages.length}`, 8, footerY + 3)

        ctx.font = '9px sans-serif'; ctx.textAlign = 'right'
        const creditLink = 'malabed.com'
        ctx.fillStyle = '#8b8fa3'
        ctx.fillText(creditLink, PAGE_W - 8, footerY + 3)
        const linkTextW = ctx.measureText(creditLink).width
        const linkLeftPx = PAGE_W - 8 - linkTextW

        ctx.fillStyle = '#c4c9d4'
        ctx.fillText('تم التطوير بواسطة محمد العابد  |  ', linkLeftPx, footerY + 3)

        if (pageIdx > 0) pdf.addPage()
        pdf.addImage(cv.toDataURL('image/png', 1.0), 'PNG', mg, mg, printW, pageH * ratio)

        // Clickable overlay for "malabed.com"
        pdf.link(
          mg + linkLeftPx * ratio,
          mg + (footerY - 6) * ratio,
          linkTextW * ratio,
          12 * ratio,
          { url: 'https://malabed.com' }
        )
      })

      pdf.save(`business-roadmap-${project?.name ?? 'export'}.pdf`)
    } finally {
      setExporting(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ width: '32px', height: '32px', border: '3px solid #e5e7eb', borderTopColor: '#534AB7', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" style={{ minHeight: '100vh', background: '#f5f6fa', fontFamily: "'Noto Kufi Arabic', 'Cairo', sans-serif" }}>

      {/* ── Topbar ── */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
          <button
            onClick={() => navigate('/')}
            style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px' }}>
            المشاريع
          </button>
          <span style={{ color: '#d1d5db' }}>/</span>
          {project && (
            <input
              value={project.name}
              onChange={e => setProject(prev => prev ? { ...prev, name: e.target.value } : prev)}
              onBlur={e => { updateProjectName(e.target.value); e.target.style.borderBottomColor = 'transparent' }}
              onFocus={e => (e.target.style.borderBottomColor = '#534AB7')}
              style={{
                fontWeight: '700', fontSize: '15px', color: '#111827',
                border: 'none', borderBottom: '1.5px solid transparent',
                background: 'transparent', outline: 'none',
                padding: '2px 0', fontFamily: 'inherit',
                width: `${Math.max(project.name.length, 4)}ch`,
              }}
            />
          )}
          <span style={{
            background: '#EEEDFE', color: '#534AB7',
            fontSize: '11px', fontWeight: '600',
            padding: '2px 9px', borderRadius: '20px',
          }}>
            خارطة البزنز
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={exportPDF}
            disabled={exporting || phases.length === 0}
            style={{
              background: exporting ? '#f3f4f6' : '#fff',
              color: exporting || phases.length === 0 ? '#9ca3af' : '#374151',
              border: '1px solid #e5e7eb', borderRadius: '8px', padding: '7px 14px',
              fontSize: '13px', fontWeight: '600',
              cursor: exporting || phases.length === 0 ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
            {exporting ? '⏳ جارٍ التصدير...' : '⬇ تصدير PDF'}
          </button>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: project?.color ?? '#5b6bff' }} />
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>{phases.length} مراحل</span>
        </div>
      </header>

      {/* ── Phase Tabs ── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'stretch',
        padding: '0 16px',
        overflowX: 'auto',
        position: 'sticky',
        top: '56px',
        zIndex: 19,
      }}>
        {phases.map(ph => {
          const dur = calcDuration(ph.start_date, ph.end_date)
          return (
            <button
              key={ph.id}
              onClick={() => switchPhase(ph.id)}
              style={{
                padding: '10px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                borderBottom: `2px solid ${ph.id === activePhaseId ? '#534AB7' : 'transparent'}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '1px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'border-color 0.15s',
              }}>
              <span style={{
                fontSize: '13px',
                fontWeight: ph.id === activePhaseId ? 700 : 400,
                color: ph.id === activePhaseId ? '#534AB7' : '#374151',
              }}>
                {ph.name}
              </span>
              {dur && (
                <span style={{ fontSize: '10px', color: '#9ca3af' }}>{dur}</span>
              )}
            </button>
          )
        })}
        {phases.length < 10 && (
          <button
            onClick={() => setShowPhaseModal(true)}
            style={{
              padding: '10px 14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#9ca3af',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginRight: 'auto',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}>
            <span style={{ fontSize: '18px', lineHeight: 1 }}>+</span> مرحلة جديدة
          </button>
        )}
      </div>

      {/* ── Phase Info Bar ── */}
      {activePhase && (
        <div style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '8px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexWrap: 'wrap',
        }}>
          {/* Phase name editable */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#9ca3af', whiteSpace: 'nowrap' }}>اسم المرحلة:</span>
            <input
              value={activePhase.name}
              onChange={e => setPhases(prev => prev.map(p => p.id === activePhaseId ? { ...p, name: e.target.value } : p))}
              onBlur={e => { updatePhaseName(e.target.value); e.target.style.borderBottomColor = 'transparent' }}
              style={{
                fontSize: '13px', fontWeight: '600', color: '#111827',
                border: 'none', borderBottom: '1.5px solid transparent',
                background: 'transparent', outline: 'none', width: '140px',
                fontFamily: 'inherit',
              }}
              onFocus={e => (e.target.style.borderBottomColor = '#534AB7')}
            />
          </div>

          <div style={{ width: '1px', height: '18px', background: '#e5e7eb' }} />

          {/* Start date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '150px' }}>
            <span style={{ fontSize: '11px', color: '#9ca3af', whiteSpace: 'nowrap' }}>البداية</span>
            <DatePicker
              value={activePhase.start_date}
              onChange={v => updatePhaseDate('start_date', v)}
              style={{
                fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '7px',
                padding: '3px 8px', background: '#f9fafb', color: '#374151',
              }}
            />
          </div>

          {/* End date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '150px' }}>
            <span style={{ fontSize: '11px', color: '#9ca3af', whiteSpace: 'nowrap' }}>النهاية</span>
            <DatePicker
              value={activePhase.end_date}
              onChange={v => updatePhaseDate('end_date', v)}
              style={{
                fontSize: '12px', border: '1px solid #e5e7eb', borderRadius: '7px',
                padding: '3px 8px', background: '#f9fafb', color: '#374151',
              }}
            />
          </div>

          {/* Duration badge */}
          {calcDuration(activePhase.start_date, activePhase.end_date) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>المدة:</span>
              <span style={{
                fontSize: '12px', fontWeight: '700', color: '#534AB7',
                background: '#EEEDFE', padding: '2px 8px', borderRadius: '10px',
              }}>
                {calcDuration(activePhase.start_date, activePhase.end_date)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Empty phases state ── */}
      {phases.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '100px 32px', gap: '16px',
        }}>
          <span style={{ fontSize: '48px' }}>🗂</span>
          <p style={{ fontSize: '16px', fontWeight: '700', color: '#374151', margin: 0 }}>لا توجد مراحل بعد</p>
          <p style={{ fontSize: '13px', color: '#9ca3af', margin: 0 }}>ابدأ بإضافة أولى مراحل المشروع</p>
          <button
            onClick={() => setShowPhaseModal(true)}
            style={{
              padding: '11px 28px', borderRadius: '10px',
              background: '#534AB7', color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: '700',
              marginTop: '8px',
            }}>
            + إضافة مرحلة
          </button>
        </div>
      )}

      {/* ── Grid: flat layout so each section row is equal-height across all depts ── */}
      {activePhaseId && (
        <main style={{ padding: '14px 16px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            overflow: 'hidden',
            background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
          }}>

            {/* ── Row 0: department headers ── */}
            {DEPTS.map((dept, dIdx) => (
              <div key={dept.k} style={{
                padding: '11px 14px',
                background: dept.hbg,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderBottom: `2px solid ${dept.ic}22`,
                ...(dIdx < DEPTS.length - 1 ? { borderLeft: '1px solid #e5e7eb' } : {}),
              }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: dept.ic, flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: '700', color: dept.htc }}>{dept.label}</span>
              </div>
            ))}

            {/* ── Rows 1…n: one row per section, 3 cells each ──
                CSS Grid auto-places these left-to-right so product/marketing/sales
                for the SAME section land in the same grid row → equal height automatically */}
            {SECS.flatMap(sec =>
              DEPTS.map((dept, dIdx) => {
                const secKey   = `${activePhaseId}-${dept.k}-${sec.k}`
                const isOpen   = !collapsed.has(secKey)
                const secItems = sectionItems(dept.k, sec.k)
                const isAdding = adding?.dept === dept.k && adding?.sec === sec.k

                return (
                  <div key={`${dept.k}-${sec.k}`} style={{
                    borderTop: '1px solid #f3f4f6',
                    display: 'flex',
                    flexDirection: 'column',
                    ...(dIdx < DEPTS.length - 1 ? { borderLeft: '1px solid #e5e7eb' } : {}),
                  }}>
                    {/* Section toggle */}
                    <button
                      onClick={() => toggleSection(secKey)}
                      style={{
                        width: '100%', padding: '7px 14px',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '600', color: '#374151' }}>{sec.label}</span>
                        {secItems.length > 0 && (
                          <span style={{
                            background: dept.hbg, color: dept.ic,
                            fontSize: '10px', padding: '1px 6px',
                            borderRadius: '10px', fontWeight: '600',
                          }}>
                            {secItems.length}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '9px', color: '#c4c9d4' }}>{isOpen ? '▲' : '▼'}</span>
                    </button>

                    {/* Section content */}
                    {isOpen && (
                      <div style={{ padding: '0 14px 10px', flex: 1 }}>
                        {secItems.length > 0 && (
                          <ul style={{ margin: '0 0 7px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            {secItems.map(item => (
                              <li key={item.id} style={{
                                display: 'flex', alignItems: 'flex-start', gap: '7px',
                                padding: '4px 8px', borderRadius: '7px',
                                background: '#fafafa', fontSize: '12px',
                                color: '#374151', lineHeight: '1.55',
                                border: '1px solid #f0f0f0',
                              }}>
                                <span style={{
                                  width: '5px', height: '5px', borderRadius: '50%',
                                  background: dept.ic, flexShrink: 0, marginTop: '5px',
                                }} />
                                <span style={{ flex: 1, wordBreak: 'break-word' }}>{item.content}</span>
                                <button
                                  onClick={() => deleteItem(item.id)}
                                  style={{
                                    border: 'none', background: 'none', cursor: 'pointer',
                                    color: '#d1d5db', fontSize: '13px', padding: '0 1px',
                                    flexShrink: 0, lineHeight: 1, transition: 'color 0.15s',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                                  onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}
                                  title="حذف">
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {isAdding ? (
                          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginTop: '4px' }}>
                            <input
                              ref={addInputRef}
                              value={addText}
                              onChange={e => setAddText(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  { e.preventDefault(); confirmAdd() }
                                if (e.key === 'Escape') { cancelAdd() }
                              }}
                              placeholder={sec.placeholder}
                              style={{
                                flex: 1, fontSize: '12px',
                                border: `1.5px solid ${dept.ic}`,
                                borderRadius: '7px', padding: '5px 9px',
                                background: '#fff', color: '#374151',
                                outline: 'none', fontFamily: 'inherit',
                              }}
                            />
                            <button onClick={confirmAdd} style={{
                              border: 'none', background: dept.ic, color: '#fff',
                              borderRadius: '7px', padding: '5px 9px',
                              cursor: 'pointer', fontSize: '13px', flexShrink: 0,
                            }}>✓</button>
                            <button onClick={cancelAdd} style={{
                              border: '1px solid #e5e7eb', background: '#fff', color: '#9ca3af',
                              borderRadius: '7px', padding: '5px 8px',
                              cursor: 'pointer', fontSize: '12px', flexShrink: 0,
                            }}>✕</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startAdd(dept.k, sec.k)}
                            style={{
                              width: '100%', padding: '5px 0',
                              fontSize: '11px', borderRadius: '7px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              gap: '4px', color: dept.ic,
                              background: `${dept.hbg}90`,
                              border: `1px dashed ${dept.ic}60`,
                              cursor: 'pointer', transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                            + {sec.addLabel}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </main>
      )}

      {/* ── Add Phase Modal ── */}
      {showPhaseModal && (
        <div
          onClick={() => setShowPhaseModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: '24px',
          }}>
          <form
            onSubmit={addPhase}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '16px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              width: '100%', maxWidth: '380px',
              padding: '28px 24px',
              display: 'flex', flexDirection: 'column', gap: '18px',
            }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0, color: '#111827' }}>إضافة مرحلة جديدة</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>اسم المرحلة *</label>
              <input
                autoFocus required
                value={phaseForm.name}
                onChange={e => setPhaseForm(f => ({ ...f, name: e.target.value }))}
                placeholder="مثال: بناء البنية التحتية"
                style={{
                  border: '1.5px solid #e5e7eb', borderRadius: '10px',
                  padding: '10px 12px', fontSize: '13px',
                  background: '#f9fafb', outline: 'none', fontFamily: 'inherit',
                }}
                onFocus={e => (e.target.style.borderColor = '#534AB7')}
                onBlur={e  => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>تاريخ البداية</label>
                <DatePicker
                  value={phaseForm.start}
                  onChange={v => setPhaseForm(f => ({ ...f, start: v }))}
                  style={{
                    border: '1.5px solid #e5e7eb', borderRadius: '10px',
                    padding: '9px 10px', fontSize: '12px',
                    background: '#f9fafb', outline: 'none',
                  }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>تاريخ النهاية</label>
                <DatePicker
                  value={phaseForm.end}
                  onChange={v => setPhaseForm(f => ({ ...f, end: v }))}
                  style={{
                    border: '1.5px solid #e5e7eb', borderRadius: '10px',
                    padding: '9px 10px', fontSize: '12px',
                    background: '#f9fafb', outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Duration preview */}
            {phaseForm.start && phaseForm.end && calcDuration(phaseForm.start, phaseForm.end) && (
              <p style={{ margin: 0, fontSize: '12px', color: '#534AB7', textAlign: 'center', fontWeight: '600' }}>
                المدة: {calcDuration(phaseForm.start, phaseForm.end)}
              </p>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button
                type="submit"
                disabled={savingPhase}
                style={{
                  flex: 1, padding: '11px', borderRadius: '10px',
                  background: '#534AB7', color: '#fff',
                  fontWeight: '700', fontSize: '13px',
                  border: 'none', cursor: savingPhase ? 'not-allowed' : 'pointer',
                  opacity: savingPhase ? 0.7 : 1,
                }}>
                {savingPhase ? 'جارٍ الحفظ...' : 'إضافة المرحلة'}
              </button>
              <button
                type="button"
                onClick={() => setShowPhaseModal(false)}
                style={{
                  padding: '11px 16px', borderRadius: '10px',
                  border: '1.5px solid #e5e7eb', background: '#fff',
                  fontSize: '13px', color: '#6b7280', cursor: 'pointer',
                }}>
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
