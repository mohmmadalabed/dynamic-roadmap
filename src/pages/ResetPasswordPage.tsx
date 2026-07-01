import { useState } from 'react'
import { supabase } from '../lib/supabase'
import PasswordInput from '../components/PasswordInput'

export default function ResetPasswordPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return }
    if (password !== confirm) { setError('كلمتا المرور غير متطابقتين'); return }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) { setError(error.message); return }
    onDone()
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(145deg, #eef1ff 0%, #fafbff 50%, #f3eeff 100%)',
      padding: '24px',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '24px',
        boxShadow: '0 8px 40px rgba(91,107,255,0.10)',
        border: '1px solid #e8eaf6',
        padding: '48px 40px',
        width: '100%',
        maxWidth: '420px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
          <div style={{
            width: '60px', height: '60px', borderRadius: '18px',
            background: 'linear-gradient(135deg,#5b6bff,#7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: '800', fontSize: '20px', letterSpacing: '0.5px',
            color: '#fff', fontFamily: "'Noto Kufi Arabic', sans-serif",
            boxShadow: '0 4px 16px rgba(91,107,255,0.3)',
            userSelect: 'none',
          }}>DR</div>
          <h1 style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px', margin: 0 }}>تعيين كلمة مرور جديدة</h1>
          <p style={{ fontSize: '13px', color: '#9ca3af', margin: 0, textAlign: 'center' }}>اختر كلمة مرور جديدة لحسابك</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>كلمة المرور الجديدة</label>
            <PasswordInput
              value={password} onChange={e => setPassword(e.target.value)} required
              placeholder="••••••••" autoFocus
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
            <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>تأكيد كلمة المرور</label>
            <PasswordInput
              value={confirm} onChange={e => setConfirm(e.target.value)} required
              placeholder="••••••••"
              style={{
                border: '1.5px solid #e5e7eb', borderRadius: '12px',
                padding: '12px 16px', fontSize: '14px',
                background: '#f9fafb', outline: 'none', width: '100%',
              }}
              onFocus={e => (e.target.style.borderColor = '#5b6bff')}
              onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
            />
          </div>

          {error && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fee2e2',
              borderRadius: '10px', padding: '12px 16px',
              fontSize: '13px', color: '#dc2626',
            }}>{error}</div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              marginTop: '4px',
              padding: '14px',
              borderRadius: '12px',
              background: loading ? '#a5b4fc' : '#5b6bff',
              color: '#fff', fontWeight: '700', fontSize: '14px',
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(91,107,255,0.3)',
            }}>
            {loading ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
          </button>
        </form>
      </div>
    </div>
  )
}
