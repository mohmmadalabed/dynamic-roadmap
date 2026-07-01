import { useState } from 'react'

/** Password input with a 👁 toggle to show/hide the typed value. */
export default function PasswordInput({
  value, onChange, placeholder, required, autoFocus, minLength, style, onFocus, onBlur,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
  required?: boolean
  autoFocus?: boolean
  minLength?: number
  style?: React.CSSProperties
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
}) {
  const [show, setShow] = useState(false)

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        minLength={minLength}
        onFocus={onFocus}
        onBlur={onBlur}
        style={{ ...style, paddingLeft: '42px' }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        title={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        style={{
          position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '16px', lineHeight: 1, padding: '6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#9ca3af',
        }}>
        {show ? '🙈' : '👁️'}
      </button>
    </div>
  )
}
