import { useEffect, useState } from 'react'
import { subscribe } from '../lib/loadingBar'

/** Slim indeterminate progress bar fixed to the top of the viewport.
 *  Shows whenever loadingBar's counter is > 0 — used for route/chunk
 *  navigation and slow data fetches, so the app never looks frozen. */
export default function LoadingBar() {
  const [active, setActive] = useState(false)

  useEffect(() => subscribe(setActive), [])

  if (!active) return null

  return (
    <div style={{ position: 'fixed', top: 0, insetInlineStart: 0, insetInlineEnd: 0, height: '3px', zIndex: 9999, overflow: 'hidden', background: 'transparent' }}>
      <div style={{
        position: 'absolute', top: 0, bottom: 0, width: '40%',
        background: 'linear-gradient(90deg, transparent, #5b6bff, transparent)',
        animation: 'loading-bar-sweep 1.1s ease-in-out infinite',
      }} />
      <style>{`
        @keyframes loading-bar-sweep {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}
