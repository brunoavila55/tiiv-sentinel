import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useConfig, useDeleteAsset, useMe, useTree } from './api/hooks'
import { useEventStream } from './lib/sse'
import { LoginPage } from './components/LoginPage'
import { TreePanel } from './components/TreePanel'
import { CanvasPanel } from './components/CanvasPanel'
import { DetailPanel } from './components/DetailPanel'
import { CommandPalette } from './components/CommandPalette'
import { TopBar } from './components/TopBar'
import { Onboarding } from './components/Onboarding'
import { AssetDrawer } from './components/AssetDrawer'
import { ImportDialog } from './components/ImportDialog'
import { BulkToolbar } from './components/BulkToolbar'

const TREE_WIDTH_KEY = 'sentinel.panelWidth.tree'
const DETAIL_WIDTH_KEY = 'sentinel.panelWidth.detail'
const UNDO_WINDOW_MS = 10_000

function storedWidth(key: string, fallback: number): number {
  const raw = Number(window.localStorage.getItem(key))
  return raw > 0 ? raw : fallback
}

interface ToastAction { label: string; onClick: () => void }
interface ToastState { id: number; message: string; action?: ToastAction }

export function App() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const me = useMe()
  const authenticated = Boolean(me.data)
  const config = useConfig(authenticated)
  const tree = useTree(authenticated)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [creating, setCreating] = useState<{ parentId: string | null; parentName?: string; prefillName?: string } | null>(null)
  const [bulkIds, setBulkIds] = useState<string[]>([])
  const [toast, setToast] = useState<ToastState | null>(null)
  const [treeWidth, setTreeWidth] = useState(() => storedWidth(TREE_WIDTH_KEY, 300))
  const [detailWidth, setDetailWidth] = useState(() => storedWidth(DETAIL_WIDTH_KEY, 440))
  // Ids apagados na tela mas cujo DELETE real so dispara depois da janela de
  // desfazer: exclusao apaga anexo do MinIO, entao so e reversivel de verdade
  // se o request ainda nao foi feito.
  const [pendingDeletes, setPendingDeletes] = useState<Record<string, true>>({})
  const deleteTimers = useRef<Record<string, number>>({})
  const toastSeq = useRef(0)
  const deleteAsset = useDeleteAsset()

  useEventStream(authenticated)

  useEffect(() => window.localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth)), [treeWidth])
  useEffect(() => window.localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)), [detailWidth])
  useEffect(() => () => {
    // Sair da tela com um desfazer pendente ainda deve gravar a exclusao.
    for (const timer of Object.values(deleteTimers.current)) window.clearTimeout(timer)
  }, [])

  const select = useCallback(
    (assetId: string) => { setBulkIds([]); navigate(`/assets/${assetId}`) },
    [navigate],
  )

  const notify = useCallback((message: string, action?: ToastAction) => {
    const seq = ++toastSeq.current
    setToast({ id: seq, message, action })
    window.setTimeout(() => {
      setToast((current) => (current?.id === seq ? null : current))
    }, action ? UNDO_WINDOW_MS : 2500)
  }, [])

  // Excluir so dispara o DELETE de verdade apos a janela: dentro dela o ativo
  // some da tela (otimista) mas continua existindo no servidor, entao
  // "desfazer" e so cancelar o timer — nada para recriar, nada perdido.
  const requestDelete = useCallback((asset: { id: string; name: string; parent_id: string | null }, reparentChildren: boolean) => {
    setPendingDeletes((current) => ({ ...current, [asset.id]: true }))
    select(asset.parent_id ?? '')
    const timer = window.setTimeout(() => {
      delete deleteTimers.current[asset.id]
      deleteAsset.mutate(
        { id: asset.id, reparentChildren },
        {
          onSuccess: () => setPendingDeletes((current) => {
            const next = { ...current }
            delete next[asset.id]
            return next
          }),
          onError: (err) => {
            setPendingDeletes((current) => {
              const next = { ...current }
              delete next[asset.id]
              return next
            })
            notify(`falha ao apagar "${asset.name}": ${(err as Error).message}`)
          },
        },
      )
    }, UNDO_WINDOW_MS)
    deleteTimers.current[asset.id] = timer
    notify(`"${asset.name}" apagado`, {
      label: 'desfazer',
      onClick: () => {
        window.clearTimeout(deleteTimers.current[asset.id])
        delete deleteTimers.current[asset.id]
        setPendingDeletes((current) => {
          const next = { ...current }
          delete next[asset.id]
          return next
        })
      },
    })
  }, [select, deleteAsset, notify])

  const isAdmin = me.data?.role === 'admin'
  const items = tree.data ?? []
  const visibleItems = Object.keys(pendingDeletes).length === 0
    ? items
    : items.filter((a) => !pendingDeletes[a.id])
  const selected = items.find((a) => a.id === id)
  const empty = !tree.isLoading && items.length === 0

  // Ctrl/Cmd+K abre a busca, Ctrl/Cmd+C copia o IP do ativo selecionado, N
  // abre o cadastro de um novo ativo na raiz — os tres atalhos que mais
  // economizam tempo no dia a dia.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (meta && event.key.toLowerCase() === 'c' && selected?.mgmt_ip) {
        if (typing || window.getSelection()?.toString()) return
        void navigator.clipboard.writeText(selected.mgmt_ip)
        notify(`IP ${selected.mgmt_ip} copiado`)
      }
      if (!meta && event.key.toLowerCase() === 'n' && isAdmin && !typing) {
        event.preventDefault()
        setCreating({ parentId: null })
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, notify, isAdmin])

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
        onNewAsset={isAdmin ? () => setCreating({ parentId: null }) : undefined}
        pollEnabled={config.data?.poll_enabled ?? false}
      />

      {empty ? (
        <Onboarding
          onCreateFirst={() => setCreating({ parentId: null })}
          onImportCSV={() => setImportOpen(true)}
        />
      ) : (
        <PanelLayout
          treeWidth={treeWidth}
          detailWidth={detailWidth}
          onResizeTree={(w) => setTreeWidth(Math.min(560, Math.max(220, w)))}
          onResizeDetail={(w) => setDetailWidth(Math.min(680, Math.max(320, w)))}
        >
          <TreePanel
            items={visibleItems}
            loading={tree.isLoading}
            error={tree.error as Error | null}
            onRetry={() => void tree.refetch()}
            selectedId={id}
            kinds={config.data?.kinds ?? []}
            onSelect={select}
            onMultiSelect={setBulkIds}
            onAddChild={(parentId, parentName) => setCreating({ parentId, parentName })}
            onNotify={notify}
            isAdmin={isAdmin}
          />
          <CanvasPanel
            items={visibleItems}
            totalAssets={items.length}
            selectedId={id}
            kinds={config.data?.kinds ?? []}
            onSelect={select}
            canPersist={isAdmin}
          />
          <DetailPanel
            assetId={id}
            kinds={config.data?.kinds ?? []}
            templates={config.data?.kind_templates ?? {}}
            allAssets={visibleItems}
            isAdmin={isAdmin}
            onSelect={select}
            onNotify={notify}
            onRequestDelete={requestDelete}
          />
        </PanelLayout>
      )}

      {bulkIds.length > 1 && (
        <BulkToolbar
          ids={bulkIds}
          kinds={config.data?.kinds ?? []}
          allAssets={visibleItems}
          onClear={() => setBulkIds([])}
          onDone={() => setBulkIds([])}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onSelect={(assetId) => {
            setPaletteOpen(false)
            select(assetId)
          }}
          onCreateNew={isAdmin ? (name) => {
            setPaletteOpen(false)
            setCreating({ parentId: null, prefillName: name })
          } : undefined}
        />
      )}

      {creating && (
        <AssetDrawer
          mode="create"
          defaultParentId={creating.parentId}
          defaultKind={creating.parentId ? undefined : 'pop'}
          defaultName={creating.prefillName}
          kinds={config.data?.kinds ?? []}
          templates={config.data?.kind_templates ?? {}}
          allAssets={visibleItems}
          onClose={() => setCreating(null)}
          onSaved={(assetId) => { setCreating(null); select(assetId) }}
        />
      )}

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}

      {toast && (
        <div className="toast">
          <span>{toast.message}</span>
          {toast.action && (
            <button className="link small toast-action" onClick={() => { toast.action!.onClick(); setToast(null) }}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Paineis redimensionaveis por arraste, largura preservada entre sessoes. */
function PanelLayout({
  treeWidth, detailWidth, onResizeTree, onResizeDetail, children,
}: {
  treeWidth: number
  detailWidth: number
  onResizeTree: (w: number) => void
  onResizeDetail: (w: number) => void
  children: [React.ReactNode, React.ReactNode, React.ReactNode]
}) {
  const [tree, canvas, detail] = children
  return (
    <div className="panels" style={{ gridTemplateColumns: `${treeWidth}px 6px minmax(0, 1fr) 6px ${detailWidth}px` }}>
      {tree}
      <ResizeHandle onDrag={(dx) => onResizeTree(treeWidth + dx)} />
      {canvas}
      <ResizeHandle onDrag={(dx) => onResizeDetail(detailWidth - dx)} />
      {detail}
    </div>
  )
}

function ResizeHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const startX = useRef(0)
  const dragging = useRef(false)

  const onMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    dragging.current = true
    startX.current = event.clientX
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - startX.current
      startX.current = e.clientX
      onDrag(dx)
    }
    const onUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return <div className="resize-handle" onMouseDown={onMouseDown} />
}
