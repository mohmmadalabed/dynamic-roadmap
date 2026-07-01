import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'
import LoginPage           from './pages/LoginPage'
import Dashboard           from './pages/Dashboard'
import TimelinePage        from './pages/TimelinePage'
import UsersPage           from './pages/UsersPage'
import BusinessRoadmapPage from './pages/BusinessRoadmapPage'

export default function App() {
  const [session, setSession]   = useState<Session | null | undefined>(undefined)
  const [isAdmin, setIsAdmin]   = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
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

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"          element={session ? <Navigate to="/" /> : <LoginPage />} />
        <Route path="/"               element={session ? <Dashboard isAdmin={isAdmin} userId={session.user.id} /> : <Navigate to="/login" />} />
        <Route path="/project/:id"    element={session ? <TimelinePage /> : <Navigate to="/login" />} />
        <Route path="/business/:id"   element={session ? <BusinessRoadmapPage /> : <Navigate to="/login" />} />
        <Route path="/users"          element={session && isAdmin ? <UsersPage /> : <Navigate to="/" />} />
        <Route path="*"               element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  )
}
