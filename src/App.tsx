import { useEffect, useState, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'

// Route-level code splitting: each page ships as its own chunk and only
// downloads when the user actually navigates there, instead of every
// page's code (Gantt chart, business roadmap grid, user admin, etc.)
// loading upfront on first visit.
const LoginPage           = lazy(() => import('./pages/LoginPage'))
const Dashboard           = lazy(() => import('./pages/Dashboard'))
const TimelinePage        = lazy(() => import('./pages/TimelinePage'))
const UsersPage           = lazy(() => import('./pages/UsersPage'))
const BusinessRoadmapPage = lazy(() => import('./pages/BusinessRoadmapPage'))
const ResetPasswordPage   = lazy(() => import('./pages/ResetPasswordPage'))

function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ width: '32px', height: '32px', border: '4px solid #e5e7eb', borderTopColor: '#5b6bff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

export default function App() {
  const [session, setSession]   = useState<Session | null | undefined>(undefined)
  const [isAdmin, setIsAdmin]   = useState(false)
  const [isRecovery, setIsRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Fetch role whenever session changes
  useEffect(() => {
    if (!session?.user) { setIsAdmin(false); return }
    supabase.from('profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => setIsAdmin(data?.role === 'admin'))
  }, [session?.user?.id])

  if (session === undefined) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ width: '32px', height: '32px', border: '4px solid #e5e7eb', borderTopColor: '#5b6bff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  // A password-recovery link takes over the whole screen until the user
  // sets a new password, regardless of which route they landed on.
  if (isRecovery) return (
    <Suspense fallback={<RouteFallback />}>
      <ResetPasswordPage onDone={() => setIsRecovery(false)} />
    </Suspense>
  )

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login"          element={session ? <Navigate to="/" /> : <LoginPage />} />
          <Route path="/"               element={session ? <Dashboard isAdmin={isAdmin} userId={session.user.id} userEmail={session.user.email ?? ''} /> : <Navigate to="/login" />} />
          <Route path="/project/:id"    element={session ? <TimelinePage /> : <Navigate to="/login" />} />
          <Route path="/business/:id"   element={session ? <BusinessRoadmapPage /> : <Navigate to="/login" />} />
          <Route path="/users"          element={session && isAdmin ? <UsersPage /> : <Navigate to="/" />} />
          <Route path="*"               element={<Navigate to="/" />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
