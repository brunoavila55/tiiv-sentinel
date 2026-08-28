import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useConfig } from '../../api/hooks'
import type { Attachment } from '../../api/types'
import { formatBytes, formatDate, relativeTime } from '../../lib/format'
import { StatusDot } from '../../components/StatusDot'
import { ActionBlock } from '../components/ActionBlock'
import { CameraFab } from '../components/CameraFab'
import { ConfigViewer } from '../components/ConfigViewer'
import { OfflineDownload } from '../components/OfflineDownload'
import { PhotoStrip } from '../components/PhotoStrip'
import { PhotoViewer } from '../components/PhotoViewer'
import { Trail } from '../components/Trail'
import { rememberAsset } from '../db/recents'
import { localKeys, useFavorites, useToggleFavorite, useUploadQueue } from '../hooks/local'
import { useAssetView } from '../hooks/useAssetView'
import { usePullToRefresh } from '../hooks/useGestures'

/**
 * A tela que importa. A ordem vertical segue a frequencia de uso: identificar o
 * ativo, copiar o IP ou entrar no equipamento, ver a ultima foto e a ultima
 * config. O resto vem depois.
 */
export function AssetScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const view = useAssetView(id)
  const config = useConfig(true)
  const queue = useUploadQueue()
  const favorites = useFavorites()
  const toggleFavorite = useToggleFavorite()

  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const [openConfig, setOpenConfig] = useState<Attachment | null>(null)
  const { pull, handlers } = usePullToRefresh(view.refetch)

  const asset = view.detail?.asset
  const kinds = config.data?.kinds ?? []

  // Historico local: guarda o ativo inteiro, nao o id. E o que faz a tela
  // inicial abrir com dados de verdade quando nao ha sinal.
  useEffect(() => {
    if (!asset) return
    void rememberAsset(asset).then(() => qc.invalidateQueries({ queryKey: localKeys.recents }))
  }, [asset, qc])

  const photos = useMemo(
    () => view.detail?.attachments.filter((a) => a.kind === 'photo') ?? [],
    [view.detail],
  )
  const configs = useMemo(
    () => view.detail?.attachments.filter((a) => a.kind === 'config') ?? [],
    [view.detail],
  )
  const documents = useMemo(
    () => view.detail?.attachments.filter((a) => a.kind === 'document') ?? [],
    [view.detail],
  )
  const queued = useMemo(
    () => (queue.data ?? []).filter((item) => item.assetId === id),
    [queue.data, id],
  )
  const isFavorite = Boolean(favorites.data?.some((f) => f.assetId === id))

  if (!asset) {
    return (
      <main className="screen">
        <p className="muted center">
          {view.loading ? 'carregando…' : 'Ativo indisponivel. Sem rede e fora dos pacotes baixados.'}
        </p>
      </main>
    )
  }

  const attrs = Object.entries(asset.attrs ?? {})

  return (
    <main className="screen" {...handlers}>
      {pull > 0 && <div className="pull" style={{ height: pull }} aria-hidden="true" />}

      <header className="asset-head">
        <button type="button" className="head-back" onClick={() => navigate(-1)} aria-label="Voltar">
          ‹
        </button>
        <div className="head-title">
          <StatusDot asset={asset} />
          <h1>{asset.name}</h1>
        </div>
        <button
          type="button"
          className={`head-star ${isFavorite ? 'on' : ''}`}
          aria-label={isFavorite ? 'Remover dos favoritos' : 'Favoritar'}
          aria-pressed={isFavorite}
          onClick={() => toggleFavorite.mutate({ asset, favorite: !isFavorite })}
        >
          ★
        </button>
      </header>

      <Trail
        path={view.detail?.breadcrumb ?? []}
        current={asset.name}
        onNavigate={(node) => navigate(`/t/${node.id}`)}
        onRoot={() => navigate('/t')}
      />

      {view.source === 'offline' && view.offlinePackage && (
        <p className="banner banner-offline">
          Dados offline do pacote “{view.offlinePackage.name}”, de{' '}
          {formatDate(new Date(view.offlinePackage.at).toISOString())}.
        </p>
      )}

      <ActionBlock asset={asset} kinds={kinds} />

      <section className="card">
        <h2 className="card-title">Fotos</h2>
        <PhotoStrip photos={photos} queued={queued} onOpen={setPhotoIndex} />
      </section>

      <section className="card">
        <h2 className="card-title">Configuracoes</h2>
        {configs.length === 0 && <p className="muted">Nenhuma config salva.</p>}
        {configs.map((item) => (
          <button key={item.id} type="button" className="file-row" onClick={() => setOpenConfig(item)}>
            <span className="file-name">{item.filename}</span>
            <span className="file-meta">
              {formatDate(item.created_at)} · {formatBytes(item.size_bytes)}
            </span>
          </button>
        ))}
      </section>

      {asset.description && (
        <section className="card">
          <h2 className="card-title">Descricao</h2>
          <p className="description">{asset.description}</p>
        </section>
      )}

      {attrs.length > 0 && (
        <section className="card">
          <h2 className="card-title">Campos</h2>
          <dl className="attrs">
            {attrs.map(([key, value]) => (
              <div key={key} className="attr">
                <dt>{key}</dt>
                <dd>{renderValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {documents.length > 0 && (
        <section className="card">
          <h2 className="card-title">Documentos</h2>
          {documents.map((item) => (
            <a key={item.id} className="file-row" href={item.url} rel="noreferrer">
              <span className="file-name">{item.filename}</span>
              <span className="file-meta">{formatBytes(item.size_bytes)}</span>
            </a>
          ))}
        </section>
      )}

      {asset.child_count > 0 && (
        <section className="card">
          <h2 className="card-title">Abaixo deste ativo</h2>
          <button type="button" className="btn-ghost wide" onClick={() => navigate(`/t/${asset.id}`)}>
            Ver {asset.child_count} {asset.child_count === 1 ? 'ativo' : 'ativos'}
          </button>
        </section>
      )}

      {asset.child_count > 0 && <OfflineDownload asset={asset} />}

      <p className="footnote">
        Status {asset.status} · atualizado {relativeTime(asset.status_at)}. Historico e alerta ficam no
        Zabbix.
      </p>

      <CameraFab asset={asset} />

      {photoIndex !== null && (
        <PhotoViewer photos={photos} index={photoIndex} onClose={() => setPhotoIndex(null)} />
      )}
      {openConfig && <ConfigViewer attachment={openConfig} onClose={() => setOpenConfig(null)} />}
    </main>
  )
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
