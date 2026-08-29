import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { UsersDialog } from './UsersDialog'
import { Logo } from './Logo'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const initial = user.email.trim().charAt(0).toUpperCase() || '?'

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={26} />
        tiiv <span>sentinel</span>
      </div>
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
        <div className="user-menu" ref={menuRef}>
          <button className="user-menu-trigger" onClick={() => setMenuOpen((v) => !v)}>
            <span className="avatar">{initial}</span>
            <span className={`badge ${user.role === 'admin' ? 'admin' : ''}`}>{user.role}</span>
          </button>
          {menuOpen && (
            <div className="user-menu-panel">
              <div className="user-menu-info">
                <span className="user-menu-email">{user.email}</span>
                <span className={`badge tiny ${user.role === 'admin' ? 'admin' : ''}`}>{user.role}</span>
              </div>
              {user.role === 'admin' && (
                <button className="ghost small" onClick={() => { setMenuOpen(false); setUsers(true) }}>
                  usuários
                </button>
              )}
              <button
                className="ghost small"
                onClick={async () => {
                  await api.logout()
                  window.location.reload()
                }}
              >
                sair
              </button>
            </div>
          )}
        </div>
        {users && <UsersDialog current={user} onClose={() => setUsers(false)} />}
      </div>
    </header>
  )
}
