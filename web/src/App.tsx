import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useConfig, useMe, useTree } from './api/hooks'
import { useEventStream } from './lib/sse'
import { LoginPage } from './components/LoginPage'
import { TreePanel } from './components/TreePanel'
import { CanvasPanel } from './components/CanvasPanel'
import { DetailPanel } from './components/DetailPanel'
import { CommandPalette } from './components/CommandPalette'
import { TopBar } from './components/TopBar'

export function App() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMe()
  const authenticated = Boolean(me.data)
  const config = useConfig(authenticated)
  const tree = useTree(authenticated)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEventStream(authenticated)

  const select = useCallback(
    (assetId: string) => navigate(`/assets/${assetId}`),
    [navigate],
  )

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2000)
  }, [])

  const selected = tree.data?.find((a) => a.id === id)

  // Ctrl/Cmd+K abre a busca; Ctrl/Cmd+C copia o IP do ativo selecionado.
  // Sao os dois atalhos que economizam mais tempo no dia a dia.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (meta && event.key.toLowerCase() === 'c' && selected?.mgmt_ip) {
        const editing = document.activeElement
        const isField =
          editing instanceof HTMLInputElement ||
          editing instanceof HTMLTextAreaElement ||
          (editing as HTMLElement | null)?.isContentEditable
        if (isField || window.getSelection()?.toString()) return
        void navigator.clipboard.writeText(selected.mgmt_ip)
        notify(`IP ${selected.mgmt_ip} copiado`)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, notify])

  if (me.isLoading) return <div className="boot">carregando…</div>
  if (!authenticated) {
    return (
      <LoginPage
        onSuccess={() => {
          qc.clear()
          void me.refetch()
        }}
      />
    )
  }

  return (
    <div className="app">
      <TopBar
        user={me.data!}
        onSearch={() => setPaletteOpen(true)}
        pollEnabled={config.data?.poll_enabled ?? false}
      />
      <div className="panels">
        <TreePanel
          items={tree.data ?? []}
          loading={tree.isLoading}
          selectedId={id}
          kinds={config.data?.kinds ?? []}
          onSelect={select}
          isAdmin={me.data?.role === 'admin'}
        />
        <CanvasPanel
          items={tree.data ?? []}
          selectedId={id}
          kinds={config.data?.kinds ?? []}
          onSelect={select}
          canPersist={me.data?.role === 'admin'}
        />
        <DetailPanel
          assetId={id}
          kinds={config.data?.kinds ?? []}
          isAdmin={me.data?.role === 'admin'}
          onSelect={select}
          onNotify={notify}
        />
      </div>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onSelect={(assetId) => {
            setPaletteOpen(false)
            select(assetId)
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
