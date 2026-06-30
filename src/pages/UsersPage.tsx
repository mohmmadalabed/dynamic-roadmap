import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

interface Profile {
  id: string
  email: string
  role: 'admin' | 'user'
  created_at: string
}
interface Project {
  id: string
  name: string
  color: string
}
interface Member {
  project_id: string
  user_id: string
}

const inputStyle: React.CSSProperties = {
  border: '1.5px solid #e5e7eb', borderRadius: '10px', padding: '10px 14px',
  fontSize: '14px', background: '#f9fafb', outline: 'none', width: '100%',
  transition: 'border-color 0.15s', fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function UsersPage() {
  const navigate = useNavigate()
  const [users, setUsers]       = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers]   = useState<Member[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const [form, setForm] = useState({ email: '', password: '', projectIds: [] as string[] })

  const load = async () => {
    setLoading(true)
    const [{ data: u }, { data: p }, { data: m }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('projects').select('id,name,color').order('created_at', { ascending: false }),
      supabase.from('project_members').select('project_id,user_id'),
    ])
    setUsers(u ?? [])
    setProjects(p ?? [])
    setMembers(m ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // ── Add user ────────────────────────────────────────────────
  const addUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await supabase.functions.invoke('create-user', {
        body: { email: form.email, password: form.password, projectIds: form.projectIds },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (res.error) throw new Error(res.error.message)
      if (res.data?.error) throw new Error(res.data.error)
      setForm({ email: '', password: '', projectIds: [] })
      setShowForm(false)
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete user ─────────────────────────────────────────────
  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`حذف المستخدم ${email}؟`)) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await supabase.functions.invoke('delete-user', {
        body: { userId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (res.error) throw new Error(res.error.message)
      if (res.data?.error) throw new Error(res.data.error)
      await load()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'حدث خطأ')
    }
  }

  // ── Toggle project access ────────────────────────────────────
  const toggleProject = async (userId: string, projectId: string, hasAccess: boolean) => {
    if (hasAccess) {
      await supabase.from('project_members')
        .delete().eq('user_id', userId).eq('project_id', projectId)
    } else {
      await supabase.from('project_members')
        .insert({ user_id: userId, project_id: projectId, can_edit: true })
    }
    await load()
  }

  // ── Helpers ─────────────────────────────────────────────────
  const userProjects = (userId: string) =>
    members.filter(m => m.user_id === userId).map(m => m.project_id)

  const regularUsers = users.filter(u => u.role === 'user')

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa' }}>
      {/* Topbar */}
      <header style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        height: '64px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 32px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px' }}>
          <button onClick={() => navigate('/')} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: '15px' }}>
            المشاريع
          </button>
          <span style={{ color: '#d1d5db' }}>›</span>
          <span style={{ fontWeight: '700', color: '#374151' }}>إدارة المستخدمين</span>
        </div>
        <button
          onClick={() => { setShowForm(true); setError('') }}
          style={{ background: '#5b6bff', color: '#fff', border: 'none', borderRadius: '10px', padding: '8px 20px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}
        >
          + مستخدم جديد
        </button>
      </header>

      <div style={{ maxWidth: '860px', margin: '32px auto', padding: '0 24px' }}>

        {/* ── Add user form ── */}
        {showForm && (
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e5e7eb', padding: '28px', marginBottom: '28px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700' }}>إضافة مستخدم جديد</h2>
            <form onSubmit={addUser} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', display: 'block', marginBottom: '6px' }}>البريد الإلكتروني</label>
                  <input
                    type="email" required placeholder="user@example.com"
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                    onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', display: 'block', marginBottom: '6px' }}>كلمة المرور</label>
                  <input
                    type="password" required minLength={6} placeholder="6 أحرف على الأقل"
                    value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                    onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', display: 'block', marginBottom: '10px' }}>المشاريع المسموح بها</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {projects.map(p => {
                    const checked = form.projectIds.includes(p.id)
                    return (
                      <button
                        key={p.id} type="button"
                        onClick={() => setForm(f => ({
                          ...f,
                          projectIds: checked ? f.projectIds.filter(x => x !== p.id) : [...f.projectIds, p.id]
                        }))}
                        style={{
                          padding: '6px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                          cursor: 'pointer', transition: 'all 0.15s',
                          background: checked ? `${p.color}15` : '#f3f4f6',
                          color: checked ? p.color : '#6b7280',
                          border: checked ? `1.5px solid ${p.color}50` : '1.5px solid transparent',
                        }}
                      >
                        {checked ? '✓ ' : ''}{p.name}
                      </button>
                    )
                  })}
                  {projects.length === 0 && <span style={{ fontSize: '13px', color: '#9ca3af' }}>لا توجد مشاريع بعد</span>}
                </div>
              </div>

              {error && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', fontSize: '13px', color: '#ef4444' }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowForm(false)}
                  style={{ padding: '9px 20px', borderRadius: '10px', border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: '14px', cursor: 'pointer', fontWeight: '600' }}>
                  إلغاء
                </button>
                <button type="submit" disabled={saving}
                  style={{ padding: '9px 24px', borderRadius: '10px', background: saving ? '#a5b4fc' : '#5b6bff', color: '#fff', border: 'none', fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: '700' }}>
                  {saving ? 'جارٍ الإنشاء...' : 'إنشاء المستخدم'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Users list ── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>جارٍ التحميل...</div>
        ) : regularUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px', background: '#fff', borderRadius: '16px', border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>👥</div>
            <p style={{ color: '#9ca3af', fontSize: '15px', margin: 0 }}>لا يوجد مستخدمون بعد. أضف مستخدماً للبدء.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {regularUsers.map(user => {
              const assigned = userProjects(user.id)
              return (
                <div key={user.id} style={{ background: '#fff', borderRadius: '14px', border: '1px solid #e5e7eb', padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: assigned.length > 0 ? '16px' : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg,#e0e7ff,#c7d2fe)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '700', color: '#5b6bff' }}>
                        {user.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{user.email}</div>
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                          {assigned.length === 0 ? 'لا توجد مشاريع مسندة' : `${assigned.length} مشروع`}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteUser(user.id, user.email)}
                      style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#f87171', cursor: 'pointer', fontSize: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="حذف المستخدم"
                    >🗑</button>
                  </div>

                  {/* Project toggles */}
                  {projects.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {projects.map(p => {
                        const hasAccess = assigned.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => toggleProject(user.id, p.id, hasAccess)}
                            style={{
                              padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: '600',
                              cursor: 'pointer', transition: 'all 0.15s',
                              background: hasAccess ? `${p.color}15` : '#f3f4f6',
                              color: hasAccess ? p.color : '#9ca3af',
                              border: hasAccess ? `1.5px solid ${p.color}40` : '1.5px solid transparent',
                            }}
                            title={hasAccess ? 'إلغاء الوصول' : 'منح الوصول'}
                          >
                            {hasAccess ? '✓ ' : '+ '}{p.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
