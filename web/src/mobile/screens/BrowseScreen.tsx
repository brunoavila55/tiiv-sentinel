import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useConfig } from '../../api/hooks'
import type { Asset } from '../../api/types'
import { AssetRow } from '../components/AssetRow'
import { Trail } from '../components/Trail'
import { useAssetView, useChildren } from '../hooks/useAssetView'
import { useEdgeSwipe } from '../hooks/useGestures'

/**
 * Drill-down com breadcrumb — a topologia no mobile. Nao ha canvas aqui de
 * proposito: grafo com pan e zoom em tela de 390px e hostil na rua, o tecnico
 * erra o toque e perde o contexto.
 */
export function BrowseScreen() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const config = useConfig(true)

  const view = useAssetView(id)
  const roots = useChildren(null)

  const breadcrumb = view.detail?.breadcrumb ?? []
  const current = view.detail?.asset
  const children = id ? (view.detail?.children ?? []) : (roots.items ?? [])
  const loading = id ? view.loading : roots.loading

  const goUp = useCallback(() => {
    if (!id) return
    const parent = breadcrumb[breadcrumb.length - 1]
    navigate(parent ? `/t/${parent.id}` : '/t', { state: { drill: true } })
  }, [id, breadcrumb, navigate])

  useEdgeSwipe(goUp)

  /**
   * Entrar direto num no fundo — link do WhatsApp, resultado de busca — deixaria
   * o "voltar" do navegador saindo do app em vez de subir um nivel. Semeamos a
   * pilha com a cadeia de ancestrais para que voltar respeite a hierarquia.
   */
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !id || !view.detail) return
    seeded.current = true
    if ((location.state as { drill?: boolean } | null)?.drill) return
    if (breadcrumb.length === 0) return
    navigate('/t', { replace: true, state: { drill: true } })
    for (const node of breadcrumb) navigate(`/t/${node.id}`, { state: { drill: true } })
    navigate(`/t/${id}`, { state: { drill: true } })
  }, [id, view.detail, breadcrumb, location.state, navigate])

  const open = (asset: Asset) => {
    // Item com filhos desce um nivel; folha abre a ficha direto.
    if (asset.child_count > 0) navigate(`/t/${asset.id}`, { state: { drill: true } })
    else navigate(`/a/${asset.id}`)
  }

  return (
    <main className="screen">
      <header className="browse-head">
        <button type="button" className="head-back" onClick={goUp} aria-label="Subir um nivel">
          ‹
        </button>
        <h1>{current?.name ?? 'Rede'}</h1>
        {current && (
          <button type="button" className="head-open" onClick={() => navigate(`/a/${current.id}`)}>
            ficha
          </button>
        )}
      </header>

      <Trail
        path={breadcrumb}
        current={current?.name}
        onNavigate={(node) => navigate(`/t/${node.id}`, { state: { drill: true } })}
        onRoot={() => navigate('/t', { state: { drill: true } })}
      />

      {loading && children.length === 0 && <p className="muted center">carregando…</p>}
      {!loading && children.length === 0 && (
        <p className="muted center">
          {current ? 'Nenhum ativo abaixo deste.' : 'Nenhum ativo cadastrado.'}
        </p>
      )}

      <div className="list">
        {children.map((asset) => (
          <AssetRow key={asset.id} asset={asset} kinds={config.data?.kinds ?? []} onOpen={open} />
        ))}
      </div>
    </main>
  )
}
