import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Project, ProjectType } from '../types'

const PROJECT_COLORS = ['#5b6bff','#16a34a','#f97316','#7c3aed','#ef4444','#0891b2']

export default function Dashboard({ isAdmin = false }: { isAdmin?: boolean }) {
  const navigate = useNavigate()
  const [projects, setProjects]   = useState<Project[]>([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm]           = useState({ name: '', description: '', color: PROJECT_COLORS[0], type: 'product' as ProjectType })

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [deleteInput, setDeleteInput]   = useState('')
  const [deleting, setDeleting]         = useState(false)

  // Edit project state
  const [editTarget, setEditTarget] = useState<Project | null>(null)
  const [editForm, setEditForm]     = useState({ name: '', color: PROJECT_COLORS[0], description: '' })

  const load = async () => {
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    setProjects(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data } = await supabase.from('projects').insert(form).select().single()
    if (data) {
      setProjects(p => [data, ...p])
      setShowModal(false)
      setForm({ name: '', description: '', color: PROJECT_COLORS[0], type: 'product' })
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleteInput !== 'delete') return
    setDeleting(true)
    await supabase.from('roadmap_items').delete().eq('project_id', deleteTarget.id)
    await supabase.from('project_members').delete().eq('project_id', deleteTarget.id)
    await supabase.from('projects').delete().eq('id', deleteTarget.id)
    setProjects(p => p.filter(x => x.id !== deleteTarget.id))
    setDeleteTarget(null)
    setDeleteInput('')
    setDeleting(false)
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editTarget) return
    const { data } = await supabase.from('projects').update(editForm).eq('id', editTarget.id).select().single()
    if (data) setProjects(p => p.map(x => x.id === data.id ? data : x))
    setEditTarget(null)
  }

  const logout = () => supabase.auth.signOut()

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa' }}>
      {/* Topbar */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg,#5b6bff,#7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: '800', fontSize: '13px', letterSpacing: '0.5px',
            color: '#fff', fontFamily: "'Noto Kufi Arabic', sans-serif",
            userSelect: 'none',
          }}>DR</div>
          <span style={{ fontWeight: '800', fontSize: '16px', letterSpacing: '-0.3px' }}>Dynamic Roadmap</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isAdmin && (
            <button
              onClick={() => navigate('/users')}
              style={{
                background: 'transparent', color: '#6b7280',
                border: '1px solid #e5e7eb', borderRadius: '10px',
                padding: '8px 16px', fontSize: '13px', fontWeight: '600',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
              }}>
              👥 المستخدمون
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowModal(true)}
              style={{
                background: '#5b6bff', color: '#fff',
                border: 'none', borderRadius: '10px',
                padding: '8px 20px', fontWeight: '700', fontSize: '14px',
                cursor: 'pointer',
              }}>
              + مشروع جديد
            </button>
          )}
          <button
            onClick={logout}
            style={{
              background: 'transparent', color: '#6b7280',
              border: '1px solid #e5e7eb', borderRadius: '10px',
              padding: '8px 16px', fontSize: '13px',
              cursor: 'pointer',
            }}>
            خروج
          </button>
        </div>
      </header>

      {/* Main */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 32px' }}>
        <div style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '26px', fontWeight: '800', letterSpacing: '-0.5px', margin: '0 0 6px' }}>مشاريعك</h2>
          <p style={{ fontSize: '14px', color: '#9ca3af', margin: 0 }}>{projects.length} مشروع</p>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%',
              border: '3px solid #5b6bff', borderTopColor: 'transparent',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                isAdmin={isAdmin}
                onClick={() => navigate(p.type === 'business' ? `/business/${p.id}` : `/project/${p.id}`)}
                onEdit={e => { e.stopPropagation(); setEditTarget(p); setEditForm({ name: p.name, color: p.color, description: p.description ?? '' }) }}
                onDelete={e => { e.stopPropagation(); setDeleteTarget(p); setDeleteInput('') }}
              />
            ))}
            {isAdmin && (
              <div
                onClick={() => setShowModal(true)}
                style={{
                  border: '2px dashed #d1d5db', borderRadius: '16px',
                  padding: '32px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: '12px', minHeight: '160px',
                  color: '#9ca3af', transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#5b6bff'
                  ;(e.currentTarget as HTMLDivElement).style.background = '#f5f3ff'
                  ;(e.currentTarget as HTMLDivElement).style.color = '#5b6bff'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = '#d1d5db'
                  ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLDivElement).style.color = '#9ca3af'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: '#f3f4f6', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '24px', fontWeight: '300',
                }}>+</div>
                <span style={{ fontSize: '14px', fontWeight: '600' }}>إضافة مشروع</span>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── New Project Modal ── */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: '24px',
          }}>
          <form
            onSubmit={createProject}
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
              width: '100%', maxWidth: '440px',
              padding: '36px 32px',
              display: 'flex', flexDirection: 'column', gap: '24px',
            }}>
            <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>مشروع جديد</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>اسم المشروع *</label>
              <input
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
                placeholder="اسم المشروع"
                style={{
                  border: '1.5px solid #e5e7eb', borderRadius: '12px',
                  padding: '12px 16px', fontSize: '14px',
                  background: '#f9fafb', outline: 'none', width: '100%',
                }}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>الوصف (اختياري)</label>
              <textarea
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="وصف قصير للمشروع"
                style={{
                  border: '1.5px solid #e5e7eb', borderRadius: '12px',
                  padding: '12px 16px', fontSize: '14px',
                  background: '#f9fafb', outline: 'none',
                  resize: 'none', width: '100%', lineHeight: '1.6',
                }}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            {/* Project type selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>نوع المشروع</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {([
                  { value: 'product',  label: 'خارطة المنتج',  desc: 'Gantt + بنود هرمية', color: '#5b6bff' },
                  { value: 'business', label: 'خارطة البزنز', desc: 'مراحل × أقسام × OKR', color: '#534AB7' },
                ] as { value: ProjectType; label: string; desc: string; color: string }[]).map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, type: t.value }))}
                    style={{
                      padding: '12px', borderRadius: '12px', cursor: 'pointer', textAlign: 'right',
                      border: `2px solid ${form.type === t.value ? t.color : '#e5e7eb'}`,
                      background: form.type === t.value ? `${t.color}08` : '#f9fafb',
                      transition: 'all 0.15s',
                    }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: form.type === t.value ? t.color : '#374151', marginBottom: '2px' }}>{t.label}</div>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>لون المشروع</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {PROJECT_COLORS.map(c => (
                  <button
                    key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))}
                    style={{
                      width: '32px', height: '32px', borderRadius: '50%',
                      background: c, border: 'none', cursor: 'pointer',
                      outline: form.color === c ? `3px solid ${c}` : '3px solid transparent',
                      outlineOffset: '2px', transition: 'outline 0.15s',
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <button
                type="submit"
                style={{
                  flex: 1, padding: '13px',
                  borderRadius: '12px', background: '#5b6bff',
                  color: '#fff', fontWeight: '700', fontSize: '14px',
                  border: 'none', cursor: 'pointer',
                }}>
                إنشاء المشروع
              </button>
              <button
                type="button" onClick={() => setShowModal(false)}
                style={{
                  padding: '13px 20px', borderRadius: '12px',
                  border: '1.5px solid #e5e7eb', background: '#fff',
                  fontSize: '14px', color: '#6b7280', cursor: 'pointer',
                }}>
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Edit Project Modal ── */}
      {editTarget && (
        <div onClick={() => setEditTarget(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '24px' }}>
          <form onSubmit={saveEdit} onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', width: '100%', maxWidth: '400px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>تعديل المشروع</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>اسم المشروع *</label>
              <input
                autoFocus value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required
                style={{ border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '12px 16px', fontSize: '14px', background: '#f9fafb', outline: 'none', width: '100%' }}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>الوصف (اختياري)</label>
              <textarea
                value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                rows={3} placeholder="وصف قصير للمشروع"
                style={{ border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '12px 16px', fontSize: '14px', background: '#f9fafb', outline: 'none', resize: 'none', width: '100%', lineHeight: '1.6' }}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>اللون</label>
              <div style={{ display: 'flex', gap: '10px' }}>
                {PROJECT_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setEditForm(f => ({ ...f, color: c }))}
                    style={{ width: '32px', height: '32px', borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: editForm.color === c ? `3px solid ${c}` : '3px solid transparent', outlineOffset: '2px', transition: 'outline 0.15s' }} />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="submit" style={{ flex: 1, padding: '12px', borderRadius: '12px', background: '#5b6bff', color: '#fff', fontWeight: '700', fontSize: '14px', border: 'none', cursor: 'pointer' }}>حفظ التغييرات</button>
              <button type="button" onClick={() => setEditTarget(null)} style={{ padding: '12px 20px', borderRadius: '12px', border: '1.5px solid #e5e7eb', background: '#fff', fontSize: '14px', color: '#6b7280', cursor: 'pointer' }}>إلغاء</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div
          onClick={() => { setDeleteTarget(null); setDeleteInput('') }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50, padding: '24px',
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '20px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              width: '100%', maxWidth: '420px',
              padding: '32px',
              display: 'flex', flexDirection: 'column', gap: '20px',
            }}>
            {/* Icon + title */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
              <div style={{
                width: '52px', height: '52px', borderRadius: '50%',
                background: '#fef2f2', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '22px',
              }}>🗑</div>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0, color: '#111827' }}>
                حذف المشروع نهائياً
              </h3>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: 0, lineHeight: '1.6' }}>
                سيتم حذف مشروع <strong style={{ color: '#111827' }}>{deleteTarget.name}</strong> وجميع بنوده بشكل نهائي ولا يمكن التراجع عن هذا الإجراء.
              </p>
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: '#f3f4f6' }} />

            {/* Confirmation input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: '#374151', fontWeight: '600' }}>
                اكتب <code style={{ background: '#f3f4f6', padding: '2px 7px', borderRadius: '5px', fontFamily: 'monospace', color: '#ef4444' }}>delete</code> للتأكيد
              </label>
              <input
                autoFocus
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmDelete() }}
                placeholder="delete"
                style={{
                  border: `1.5px solid ${deleteInput === 'delete' ? '#ef4444' : '#e5e7eb'}`,
                  borderRadius: '10px', padding: '11px 14px', fontSize: '14px',
                  background: '#f9fafb', outline: 'none', width: '100%',
                  fontFamily: 'monospace', letterSpacing: '0.5px',
                  transition: 'border-color 0.15s',
                }}
              />
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => { setDeleteTarget(null); setDeleteInput('') }}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  border: '1.5px solid #e5e7eb', background: '#fff',
                  fontSize: '14px', color: '#6b7280', cursor: 'pointer', fontWeight: '600',
                }}>
                إلغاء
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteInput !== 'delete' || deleting}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  border: 'none', fontSize: '14px', fontWeight: '700',
                  cursor: deleteInput === 'delete' && !deleting ? 'pointer' : 'not-allowed',
                  background: deleteInput === 'delete' ? '#ef4444' : '#fca5a5',
                  color: '#fff', transition: 'background 0.15s',
                }}>
                {deleting ? 'جارٍ الحذف...' : 'حذف نهائياً'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function ProjectCard({
  project, isAdmin, onClick, onEdit, onDelete,
}: {
  project: Project
  isAdmin: boolean
  onClick: () => void
  onEdit: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#fff', borderRadius: '16px',
        border: '1px solid #e5e7eb',
        padding: '24px', cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
        display: 'flex', flexDirection: 'column', gap: '16px',
        transition: 'all 0.2s',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.10)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
        ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'
      }}
    >
      {/* Top color accent */}
      <div style={{
        position: 'absolute', top: 0, right: 0, left: 0,
        height: '4px', background: project.color, borderRadius: '16px 16px 0 0',
      }} />

      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginTop: '4px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h3 style={{ fontWeight: '700', fontSize: '16px', margin: 0, lineHeight: '1.4' }}>{project.name}</h3>
          {project.type === 'business' && (
            <span style={{ fontSize: '10px', fontWeight: '600', color: '#534AB7', background: '#EEEDFE', padding: '1px 7px', borderRadius: '10px', alignSelf: 'flex-start' }}>
              خارطة البزنز
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {isAdmin && (
            <button
              onClick={onEdit}
              title="تعديل المشروع"
              style={{
                width: '28px', height: '28px', borderRadius: '7px',
                border: '1px solid #e5e7eb', background: '#f9fafb',
                color: '#6b7280', cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
              ✏️
            </button>
          )}
          {isAdmin && (
            <button
              onClick={onDelete}
              title="حذف المشروع"
              style={{
                width: '28px', height: '28px', borderRadius: '7px',
                border: '1px solid #fee2e2', background: '#fef2f2',
                color: '#f87171', cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
              🗑
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0, lineHeight: '1.6' }}>
          {project.description}
        </p>
      )}

      {/* Decorative color line */}
      <div style={{ marginTop: 'auto', height: '3px', borderRadius: '99px', background: `linear-gradient(to left, ${project.color}, ${project.color}22)` }} />
    </div>
  )
}
