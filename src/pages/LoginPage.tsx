import { useState } from 'react'
import { supabase } from '../lib/supabase'
import PasswordInput from '../components/PasswordInput'
import Turnstile from '../components/Turnstile'

type Mode = 'login' | 'signup' | 'forgot'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string

const inputStyle: React.CSSProperties = {
  border: '1.5px solid #e5e7eb', borderRadius: '12px',
  padding: '12px 16px', fontSize: '14px',
  background: '#f9fafb', outline: 'none', transition: 'border-color 0.2s',
  width: '100%', fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function LoginPage() {
  const [mode, setMode]         = useState<Mode>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')
  const [loading, setLoading]   = useState(false)

  const resetMessages = () => { setError(''); setInfo('') }

  // ── Login ──────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages(); setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  // ── Signup ─────────────────────────────────────────────────────────────
  // No email confirmation step — Turnstile blocks bots, account is active immediately.
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages()
    if (password.length < 6) { setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return }
    if (password !== confirm) { setError('كلمتا المرور غير متطابقتين'); return }
    if (!captchaToken) { setError('أكمل التحقق من أنك لست روبوتاً'); return }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { captchaToken },
    })
    setLoading(false)
    if (error) { setError(error.message); return }

    // Supabase never returns an explicit "email already registered" error
    // (to avoid leaking which emails exist) — for an existing, already-confirmed
    // account it silently returns a user with an empty `identities` array and
    // no session instead of creating a duplicate.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError('هذا البريد مسجّل مسبقاً — سجّل الدخول بدلاً من إنشاء حساب جديد.')
      return
    }

    if (!data.session) {
      // Falls back gracefully if "Confirm email" is still enabled on the Supabase project.
      setInfo('تم إنشاء الحساب. تحقق من بريدك لتفعيله ثم سجّل الدخول.')
      setMode('login')
    }
    // Otherwise data.session is set — App.tsx's onAuthStateChange picks it up
    // automatically and routes straight to the dashboard.
  }

  // ── Forgot password ────────────────────────────────────────────────────
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    resetMessages(); setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setInfo('أرسلنا رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني')
  }

  const switchMode = (m: Mode) => { resetMessages(); setMode(m) }

  const titles: Record<Mode, { h: string; sub: string }> = {
    login:  { h: 'أهلًا بعودتك 👋', sub: 'منصة تخطيط المشاريع المرئي' },
    signup: { h: 'إنشاء حساب جديد', sub: 'ابدأ بإدارة مشاريعك خلال دقيقة' },
    forgot: { h: 'استعادة كلمة المرور', sub: 'سنرسل لك رابط إعادة التعيين' },
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
        {/* Logo */}
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
          <h1 style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '-0.5px', margin: 0 }}>Dynamic Roadmap</h1>
          <p style={{ fontSize: '13px', color: '#9ca3af', margin: 0 }}>{titles[mode].sub}</p>
        </div>

        <div style={{ height: '1px', background: '#f0f2f8', marginBottom: '28px' }} />

        <h2 style={{ fontSize: '17px', fontWeight: '700', textAlign: 'center', marginBottom: '28px' }}>{titles[mode].h}</h2>

        {/* ── Login form ── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>البريد الإلكتروني</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="admin@company.com" style={inputStyle}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>كلمة المرور</label>
                <button type="button" onClick={() => switchMode('forgot')}
                  style={{ background: 'none', border: 'none', color: '#5b6bff', fontSize: '12px', cursor: 'pointer', fontWeight: '600', padding: 0 }}>
                  نسيت كلمة المرور؟
                </button>
              </div>
              <PasswordInput
                value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••" style={inputStyle}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            {error && <ErrorBox text={error} />}
            {info && <InfoBox text={info} />}

            <SubmitButton loading={loading} label="تسجيل الدخول" loadingLabel="جارٍ الدخول..." />

            <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', margin: 0 }}>
              ليس لديك حساب؟{' '}
              <button type="button" onClick={() => switchMode('signup')}
                style={{ background: 'none', border: 'none', color: '#5b6bff', fontWeight: '700', cursor: 'pointer', fontSize: '13px', padding: 0 }}>
                إنشاء حساب
              </button>
            </p>
          </form>
        )}

        {/* ── Signup form ── */}
        {mode === 'signup' && (
          <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>البريد الإلكتروني</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@company.com" style={inputStyle}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>كلمة المرور</label>
              <PasswordInput
                value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="6 أحرف على الأقل" style={inputStyle}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>تأكيد كلمة المرور</label>
              <PasswordInput
                value={confirm} onChange={e => setConfirm(e.target.value)} required
                placeholder="••••••••" style={inputStyle}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Turnstile siteKey={TURNSTILE_SITE_KEY} onVerify={setCaptchaToken} />
            </div>

            {error && <ErrorBox text={error} />}
            {info && <InfoBox text={info} />}

            <SubmitButton loading={loading} label="إنشاء الحساب" loadingLabel="جارٍ الإنشاء..." />

            <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', margin: 0 }}>
              لديك حساب بالفعل؟{' '}
              <button type="button" onClick={() => switchMode('login')}
                style={{ background: 'none', border: 'none', color: '#5b6bff', fontWeight: '700', cursor: 'pointer', fontSize: '13px', padding: 0 }}>
                تسجيل الدخول
              </button>
            </p>
          </form>
        )}

        {/* ── Forgot password ── */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: '#374151' }}>البريد الإلكتروني</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="admin@company.com" style={inputStyle}
                onFocus={e => (e.target.style.borderColor = '#5b6bff')}
                onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
              />
            </div>

            {error && <ErrorBox text={error} />}
            {info && <InfoBox text={info} />}

            <SubmitButton loading={loading} label="إرسال رابط الاستعادة" loadingLabel="جارٍ الإرسال..." />

            <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', margin: 0 }}>
              <button type="button" onClick={() => switchMode('login')}
                style={{ background: 'none', border: 'none', color: '#5b6bff', fontWeight: '700', cursor: 'pointer', fontSize: '13px', padding: 0 }}>
                الرجوع لتسجيل الدخول
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div style={{
      background: '#fef2f2', border: '1px solid #fee2e2',
      borderRadius: '10px', padding: '12px 16px',
      fontSize: '13px', color: '#dc2626',
    }}>{text}</div>
  )
}

function InfoBox({ text }: { text: string }) {
  return (
    <div style={{
      background: '#f0fdf4', border: '1px solid #dcfce7',
      borderRadius: '10px', padding: '12px 16px',
      fontSize: '13px', color: '#16a34a',
    }}>{text}</div>
  )
}

function SubmitButton({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button
      type="submit" disabled={loading}
      style={{
        marginTop: '4px',
        padding: '14px',
        borderRadius: '12px',
        background: loading ? '#a5b4fc' : '#5b6bff',
        color: '#fff', fontWeight: '700', fontSize: '14px',
        border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s',
        boxShadow: '0 4px 12px rgba(91,107,255,0.3)',
      }}>
      {loading ? loadingLabel : label}
    </button>
  )
}
