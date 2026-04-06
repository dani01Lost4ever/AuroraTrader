import { useEffect, useState } from 'react'
import { Nav } from './components/Nav'
import { Overview } from './pages/Overview'
import { Assets } from './pages/Assets'
import { Charts } from './pages/Charts'
import { Settings } from './pages/Settings'
import { Tokens } from './pages/Tokens'
import { Backtest } from './pages/Backtest'
import { Strategies } from './pages/Strategies'
import { ReasoningHistory } from './pages/ReasoningHistory'
import { AuditLog } from './pages/AuditLog'
import { Login } from './pages/Login'
import { Wiki } from './pages/Wiki'
import { Landing } from './pages/Landing'
import { auth, api } from './api'
import type { AuthUser } from './api'
import { AdminEngines } from './pages/AdminEngines'

export type Page = 'overview' | 'charts' | 'assets' | 'tokens' | 'settings' | 'strategies' | 'backtest' | 'reasoning' | 'auditlog' | 'wiki' | 'admin'
type PublicPage = 'landing' | 'login'

export function App() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn)
  const [page, setPage]         = useState<Page>('overview')
  const [publicPage, setPublicPage] = useState<PublicPage>('landing')
  const [me, setMe] = useState<AuthUser | null>(null)

  const loadMe = async () => {
    try {
      const res = await api.me()
      setMe(res.user)
    } catch {
      setMe(null)
    }
  }

  useEffect(() => {
    if (loggedIn && !me) loadMe().catch(() => {})
  }, [loggedIn, me])

  if (!loggedIn) {
    if (publicPage === 'landing') {
      return <Landing onEnter={() => setPublicPage('login')} />
    }
    return (
      <Login
        onLogin={() => { setLoggedIn(true); loadMe().catch(() => {}) }}
        onBack={() => setPublicPage('landing')}
      />
    )
  }

  const handleLogout = () => {
    auth.clearToken()
    setLoggedIn(false)
    setMe(null)
    setPublicPage('landing')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Nav current={page} onNavigate={setPage} onLogout={handleLogout} me={me} />
      <main style={{ flex: 1 }}>
        {page === 'overview'  && <Overview />}
        {page === 'charts'    && <Charts />}
        {page === 'assets'    && <Assets />}
        {page === 'tokens'    && <Tokens />}
        {page === 'settings'    && <Settings />}
        {page === 'strategies'  && <Strategies />}
        {page === 'backtest'    && <Backtest />}
        {page === 'reasoning' && <ReasoningHistory />}
        {page === 'auditlog'  && <AuditLog />}
        {page === 'wiki'      && <Wiki />}
        {page === 'admin'     && me?.role === 'admin' && <AdminEngines />}
      </main>
    </div>
  )
}
