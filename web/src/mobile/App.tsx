import { useEffect } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AssetScreen } from './screens/AssetScreen'
import { BrowseScreen } from './screens/BrowseScreen'
import { LoginScreen } from './screens/LoginScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useOnline, useUploadQueue } from './hooks/local'
import { useSession } from './hooks/useSession'
import { useUpdateReady } from './lib/pwa'
import { startSync } from './lib/sync'

export function App() {
  const session = useSession()

  // A fila drena sozinha: quando a rede volta, quando o app ganha foco e a cada
  // 30s. O tecnico nao deveria precisar saber que existe uma fila.
  useEffect(() => (session.authenticated ? startSync() : undefined), [session.authenticated])

  if (session.loading) return <div className="boot">carregando…</div>
  if (!session.authenticated) return <LoginScreen />

  return (
    <div className="app">
      <TopBar daysLeft={session.expiring ? session.daysLeft : null} />
      <Routes>
        <Route path="/" element={<SearchScreen />} />
        <Route path="/t" element={<BrowseScreen />} />
        <Route path="/t/:id" element={<BrowseScreen />} />
        <Route path="/a/:id" element={<AssetScreen />} />
        <Route path="/ajustes" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

function TopBar({ daysLeft }: { daysLeft: number | null }) {
  const location = useLocation()
  const online = useOnline()
  const queue = useUploadQueue()
  const [updateReady, update] = useUpdateReady()

  const pending = queue.data?.filter((item) => item.status === 'pending').length ?? 0
  const failed = queue.data?.some((item) => item.status === 'failed') ?? false

  return (
    <>
      <header className="topbar">
        <Link to="/" className={`topbar-tab ${location.pathname === '/' ? 'on' : ''}`}>
          buscar
        </Link>
        <Link to="/t" className={`topbar-tab ${location.pathname.startsWith('/t') ? 'on' : ''}`}>
          topologia
        </Link>
        <span className="topbar-spacer" />
        {!online && <span className="chip chip-offline">offline</span>}
        {(pending > 0 || failed) && (
          <Link to="/ajustes" className={`chip ${failed ? 'chip-failed' : 'chip-pending'}`}>
            {failed ? 'envio falhou' : `${pending} pendente${pending > 1 ? 's' : ''}`}
          </Link>
        )}
        <Link to="/ajustes" className="topbar-tab" aria-label="Ajustes">
          ⚙
        </Link>
      </header>

      {updateReady && (
        <button type="button" className="banner banner-update" onClick={update}>
          Nova versao disponivel — toque para atualizar.
        </button>
      )}

      {daysLeft !== null && (
        <p className="banner banner-warn">
          Seu acesso expira em {daysLeft} dia(s). Abra o app com rede para renovar sem precisar da senha.
        </p>
      )}
    </>
  )
}
