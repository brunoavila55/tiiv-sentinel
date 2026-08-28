import { useState } from 'react'
import { api } from '../api/client'
import { UsersDialog } from './UsersDialog'
import type { User } from '../api/types'

export function TopBar({
  user,
  onSearch,
  onNewAsset,
  pollEnabled,
}: {
  user: User
  onSearch: () => void
  onNewAsset?: () => void
  pollEnabled: boolean
}) {
  const [users, setUsers] = useState(false)

  return (
    <header className="topbar">
      <div className="brand">tiiv <span>sentinel</span></div>
      {onNewAsset && (
        <button className="primary-action" onClick={onNewAsset} title="novo ativo (atalho: N)">
          + Novo ativo
        </button>
      )}
      <button className="search-trigger" onClick={onSearch}>
        <span>buscar ativo, IP, descrição…</span>
        <kbd>Ctrl</kbd><kbd>K</kbd>
      </button>
      <div className="topbar-right">
        {!pollEnabled && <span className="badge warn">poller off</span>}
        <span className="muted">{user.email}</span>
        <span className={`badge ${user.role === 'admin' ? 'admin' : ''}`}>{user.role}</span>
        {user.role === 'admin' && (
          <button className="ghost small" onClick={() => setUsers(true)}>usuários</button>
        )}
        {users && <UsersDialog current={user} onClose={() => setUsers(false)} />}
        <button
          className="ghost"
          onClick={async () => {
            await api.logout()
            window.location.reload()
          }}
        >
          sair
        </button>
      </div>
    </header>
  )
}
