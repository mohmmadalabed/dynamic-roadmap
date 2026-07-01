import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback'?: () => void
        'error-callback'?: () => void
      }) => string
      reset: (widgetId?: string) => void
    }
  }
}

/**
 * Cloudflare Turnstile bot-check widget (used on signup only).
 * Renders once the global `turnstile` script (loaded in index.html) is ready,
 * and reports the verification token back via onVerify — pass that token as
 * `options.captchaToken` to supabase.auth.signUp().
 */
export default function Turnstile({ siteKey, onVerify }: { siteKey: string; onVerify: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: token => onVerify(token),
        'expired-callback': () => onVerify(''),
        'error-callback': () => onVerify(''),
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      // Script tag uses async/defer — poll briefly until it's ready.
      const interval = setInterval(() => {
        if (window.turnstile) { clearInterval(interval); renderWidget() }
      }, 200)
      return () => { cancelled = true; clearInterval(interval) }
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey])

  if (!siteKey) {
    return (
      <div style={{ fontSize: '12px', color: '#dc2626', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '10px', padding: '10px 14px' }}>
        VITE_TURNSTILE_SITE_KEY غير معرّف — أضِفه في ملف .env
      </div>
    )
  }

  return <div ref={containerRef} />
}
