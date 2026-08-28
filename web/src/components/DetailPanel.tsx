import { useMemo, useState } from 'react'
import { useAsset, useDeleteAsset, useDeleteAttachment, useUpdateAsset } from '../api/hooks'
import type { Asset, KindConfig } from '../api/types'
import { actionsFor, kindConfig } from '../lib/actions'
import { relativeTime } from '../lib/format'
import { useUploads } from '../lib/useUploads'
import { Breadcrumb } from './Breadcrumb'
import { CopyButton } from './CopyButton'
import { KindIcon } from './KindIcon'
import { StatusDot } from './StatusDot'
import { MarkdownField } from './MarkdownField'
import { AttrsEditor } from './AttrsEditor'
import { Dropzone } from './Dropzone'
import { UploadList } from './UploadList'
import { PhotoGallery } from './PhotoGallery'
import { ConfigViewer } from './ConfigViewer'
import { AssetFields } from './AssetFields'

export function DetailPanel({
  assetId,
  kinds,
  isAdmin,
  onSelect,
  onNotify,
}: {
  assetId?: string
  kinds: KindConfig[]
  isAdmin: boolean
  onSelect: (id: string) => void
  onNotify: (message: string) => void
}) {
  const { data, isLoading, error } = useAsset(assetId)
  const update = useUpdateAsset(assetId ?? '')
  const removeAsset = useDeleteAsset()
  const removeAttachment = useDeleteAttachment(assetId ?? '')
  const { uploads, start, dismiss } = useUploads(assetId ?? '')
  const [editing, setEditing] = useState(false)

  const asset = data?.asset
  const actions = useMemo(() => (asset ? actionsFor(asset, kinds) : []), [asset, kinds])
  const photos = data?.attachments.filter((a) => a.kind === 'photo') ?? []
  const configs = data?.attachments.filter((a) => a.kind === 'config') ?? []
  const documents = data?.attachments.filter((a) => a.kind === 'document') ?? []

  if (!assetId) {
    return (
      <aside className="panel detail-panel empty">
        <p className="muted">
          Selecione um ativo na arvore ou pressione <kbd>Ctrl</kbd>+<kbd>K</kbd> para buscar.
        </p>
      </aside>
    )
  }
  if (isLoading) return <aside className="panel detail-panel"><p className="muted pad">carregando…</p></aside>
  if (error || !asset || !data) {
    return <aside className="panel detail-panel"><p className="error pad">ativo nao encontrado</p></aside>
  }

  const kind = kindConfig(asset.kind, kinds)
  const gps = asset.attrs?.gps as { lat: number; lon: number } | undefined

  return (
    <aside className="panel detail-panel">
      <Breadcrumb trail={data.breadcrumb} onSelect={onSelect} />

      <header className="detail-head">
        <KindIcon kind={asset.kind} color={kind?.color} size={22} />
        <div>
          <h2>{asset.name}</h2>
          <div className="detail-sub">
            <span className="badge" style={{ borderColor: kind?.color, color: kind?.color }}>
              {kind?.label ?? asset.kind}
            </span>
            <StatusDot asset={asset} />
            <span className="muted small">
              {asset.suppressed && asset.status === 'down'
                ? 'down por consequencia (ancestral caiu)'
                : asset.status}{' '}
              · {relativeTime(asset.status_at)}
            </span>
          </div>
        </div>
        {isAdmin && (
          <button className="ghost small" onClick={() => setEditing((v) => !v)}>
            {editing ? 'fechar' : 'editar'}
          </button>
        )}
      </header>

      {editing && isAdmin && (
        <AssetFields
          asset={asset}
          kinds={kinds}
          saving={update.isPending}
          onSave={(patch) => update.mutate(patch, { onSuccess: () => setEditing(false) })}
          onDelete={() =>
            removeAsset.mutate(asset.id, {
              onSuccess: () => onSelect(asset.parent_id ?? ''),
              onError: (err) => onNotify((err as Error).message),
            })
          }
        />
      )}

      <section className="detail-ip">
        {asset.mgmt_ip ? (
          <>
            <code className="ip">{asset.mgmt_ip}</code>
            <CopyButton value={asset.mgmt_ip} />
            {actions.map(({ action, href }) => (
              <a key={action.id} className="button" href={href} target="_blank" rel="noreferrer">
                {action.label}
              </a>
            ))}
          </>
        ) : (
          <span className="muted">sem IP de gerencia</span>
        )}
      </section>

      {gps && (
        <p className="muted small gps">
          GPS da foto: {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}{' '}
          <a
            href={`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=18/${gps.lat}/${gps.lon}`}
            target="_blank"
            rel="noreferrer"
          >
            abrir mapa
          </a>
        </p>
      )}

      <details open className="section">
        <summary>Descricao</summary>
        <MarkdownField
          value={asset.description}
          canEdit={isAdmin}
          saving={update.isPending}
          onSave={(description) => update.mutate({ description })}
        />
      </details>

      <details open className="section">
        <summary>Atributos</summary>
        <AttrsEditor
          attrs={asset.attrs ?? {}}
          canEdit={isAdmin}
          saving={update.isPending}
          onSave={(attrs) => update.mutate({ attrs })}
        />
      </details>

      <details open className="section">
        <summary>Fotos ({photos.length})</summary>
        <Dropzone
          kind="photo"
          accept="image/jpeg,image/png,image/webp"
          hint="arraste fotos aqui ou clique para escolher"
          onFiles={start}
        />
        <UploadList uploads={uploads} onDismiss={dismiss} />
        <PhotoGallery
          photos={photos}
          canDelete={isAdmin}
          onDelete={(id) => removeAttachment.mutate(id)}
        />
      </details>

      <details open className="section">
        <summary>Configuracoes ({configs.length})</summary>
        <Dropzone
          kind="config"
          accept="text/plain,.txt,.cfg,.conf,.rsc"
          hint="arraste o .txt da config aqui"
          disabled={!isAdmin}
          onFiles={start}
        />
        <ConfigViewer
          configs={configs}
          canDelete={isAdmin}
          onDelete={(id) => removeAttachment.mutate(id)}
        />
      </details>

      <details className="section">
        <summary>Documentos ({documents.length})</summary>
        <Dropzone
          kind="document"
          accept="application/pdf,text/plain"
          hint="arraste PDFs ou textos aqui"
          disabled={!isAdmin}
          onFiles={start}
        />
        <ul className="doc-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <a href={doc.url} target="_blank" rel="noreferrer">{doc.filename}</a>
              {isAdmin && (
                <button className="ghost small" onClick={() => removeAttachment.mutate(doc.id)}>×</button>
              )}
            </li>
          ))}
          {documents.length === 0 && <li className="muted">nenhum documento</li>}
        </ul>
      </details>

      <details open className="section">
        <summary>Filhos diretos ({data.children.length})</summary>
        <ul className="children">
          {data.children.map((child: Asset) => (
            <li key={child.id}>
              <button className="child" onClick={() => onSelect(child.id)}>
                <KindIcon kind={child.kind} color={kindConfig(child.kind, kinds)?.color} />
                <span>{child.name}</span>
                {child.mgmt_ip && <code className="muted small">{child.mgmt_ip}</code>}
                <StatusDot asset={child} />
              </button>
            </li>
          ))}
          {data.children.length === 0 && <li className="muted">nenhum filho</li>}
        </ul>
      </details>

      {update.isError && <p className="error pad">{(update.error as Error).message}</p>}
      {removeAsset.isError && <p className="error pad">{(removeAsset.error as Error).message}</p>}
    </aside>
  )
}
