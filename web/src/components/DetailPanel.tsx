import { useMemo, useState } from 'react'
import {
  useAsset, useAudit, useDeleteAttachment, useDuplicateSubtree,
  useRenameAttachment, useReorderAttachments, useUpdateAsset,
} from '../api/hooks'
import type { Asset, KindConfig, TemplateField } from '../api/types'
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
import { AssetDrawer } from './AssetDrawer'
import { InlineField } from './InlineField'
import { ConfirmDialog } from './ConfirmDialog'

const STATUS_LABEL: Record<string, string> = { up: 'up', down: 'down', unknown: 'sem ping' }
const ACTION_LABEL: Record<string, string> = { create: 'criado', update: 'atualizado', move: 'movido', delete: 'apagado' }

export function DetailPanel({
  assetId,
  kinds,
  templates,
  allAssets,
  isAdmin,
  onSelect,
  onNotify,
  onRequestDelete,
}: {
  assetId?: string
  kinds: KindConfig[]
  templates: Record<string, TemplateField[]>
  allAssets: Asset[]
  isAdmin: boolean
  onSelect: (id: string) => void
  onNotify: (message: string) => void
  onRequestDelete: (asset: { id: string; name: string; parent_id: string | null }, reparentChildren: boolean) => void
}) {
  const { data, isLoading, error, refetch } = useAsset(assetId)
  const update = useUpdateAsset(assetId ?? '')
  const removeAttachment = useDeleteAttachment(assetId ?? '')
  const renameAttachment = useRenameAttachment(assetId ?? '')
  const reorderAttachments = useReorderAttachments(assetId ?? '')
  const duplicateSubtree = useDuplicateSubtree()
  const { uploads, start, dismiss } = useUploads(assetId ?? '')
  const [editing, setEditing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const asset = data?.asset
  const actions = useMemo(() => (asset ? actionsFor(asset, kinds) : []), [asset, kinds])
  const photos = data?.attachments.filter((a) => a.kind === 'photo') ?? []
  const configs = data?.attachments.filter((a) => a.kind === 'config') ?? []
  const documents = data?.attachments.filter((a) => a.kind === 'document') ?? []

  if (!assetId) {
    return (
      <aside className="panel detail-panel empty">
        <p className="muted">
          Selecione um ativo na árvore ou pressione <kbd>Ctrl</kbd>+<kbd>K</kbd> para buscar.
        </p>
      </aside>
    )
  }
  if (isLoading) {
    return (
      <aside className="panel detail-panel">
        <div className="skeleton-list">
          <div className="skeleton-row" style={{ width: '60%', height: 20 }} />
          <div className="skeleton-row" style={{ width: '40%' }} />
          <div className="skeleton-row" style={{ width: '90%', height: 60 }} />
        </div>
      </aside>
    )
  }
  if (error || !asset || !data) {
    return (
      <aside className="panel detail-panel">
        <p className="error pad">ativo não encontrado ou falha ao carregar</p>
        <button className="ghost small" onClick={() => void refetch()}>tentar de novo</button>
      </aside>
    )
  }

  const kind = kindConfig(asset.kind, kinds)
  const gps = asset.attrs?.gps as { lat: number; lon: number } | undefined
  const hasChildren = data.children.length > 0

  const doDelete = (reparentChildren: boolean) => {
    setDeleting(false)
    onRequestDelete({ id: asset.id, name: asset.name, parent_id: asset.parent_id }, reparentChildren)
  }

  return (
    <aside className="panel detail-panel">
      <Breadcrumb trail={data.breadcrumb} onSelect={onSelect} />

      <header className="detail-head">
        <KindIcon kind={asset.kind} color={kind?.color} size={22} />
        <div>
          <h2>
            <InlineField
              value={asset.name}
              canEdit={isAdmin}
              onSave={(next) => update.mutateAsync({ name: next }).then(() => undefined)}
            />
          </h2>
          <div className="detail-sub">
            <span className="badge" style={{ borderColor: kind?.color, color: kind?.color }}>
              {kind?.label ?? asset.kind}
            </span>
            <StatusToggle asset={asset} canEdit={isAdmin} onSave={(s) => update.mutateAsync({ status: s })} />
            <span className="muted small">· {relativeTime(asset.status_at)}</span>
          </div>
        </div>
        {isAdmin && (
          <div className="detail-head-actions">
            <button className="ghost small" onClick={() => setEditing(true)}>editar</button>
            <button className="ghost small" onClick={() => setDuplicating(true)}>duplicar</button>
          </div>
        )}
      </header>

      <section className="detail-ip">
        {isAdmin ? (
          <InlineField
            value={asset.mgmt_ip ?? ''}
            placeholder="sem IP de gerência"
            canEdit={isAdmin}
            onSave={(next) => update.mutateAsync({ mgmt_ip: next.trim() || null }).then(() => undefined)}
            render={(v) => (v ? <code className="ip">{v}</code> : <span className="muted">sem IP de gerência</span>)}
          />
        ) : asset.mgmt_ip ? (
          <code className="ip">{asset.mgmt_ip}</code>
        ) : (
          <span className="muted">sem IP de gerência</span>
        )}
        {asset.mgmt_ip && <CopyButton value={asset.mgmt_ip} />}
        {actions.map(({ action, href }) => (
          <a key={action.id} className="button" href={href} target="_blank" rel="noreferrer">
            {action.label}
          </a>
        ))}
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
        <summary>Descrição</summary>
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
          coverId={asset.cover_attachment_id}
          onDelete={(id) => removeAttachment.mutate(id)}
          onSetCover={(id) => update.mutate({ cover_attachment_id: id })}
          onRename={(id, filename) => renameAttachment.mutate({ id, filename })}
          onReorder={(ids) => reorderAttachments.mutate(ids)}
        />
      </details>

      <details open className="section">
        <summary>Configurações ({configs.length})</summary>
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
          onRename={(id, filename) => renameAttachment.mutate({ id, filename })}
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

      <details className="section">
        <summary>Histórico</summary>
        <AuditLog assetId={asset.id} />
      </details>

      {isAdmin && (
        <div className="detail-danger">
          <button
            className="ghost small danger-text"
            onClick={() => duplicateSubtree.mutate(
              { id: asset.id, suffix: ' (cópia)' },
              { onSuccess: (created) => { onNotify('subtree duplicado'); onSelect(created.id) } },
            )}
            disabled={duplicateSubtree.isPending}
          >
            {duplicateSubtree.isPending ? 'duplicando…' : 'duplicar com subtree'}
          </button>
          <button className="ghost small danger-text" onClick={() => setDeleting(true)}>
            apagar ativo
          </button>
        </div>
      )}

      {update.isError && <p className="error pad">{(update.error as Error).message}</p>}

      {editing && (
        <AssetDrawer
          mode="edit"
          asset={asset}
          descendantCount={data.descendant_count}
          kinds={kinds}
          templates={templates}
          allAssets={allAssets}
          onClose={() => setEditing(false)}
          onSaved={(id) => { setEditing(false); onSelect(id) }}
        />
      )}

      {duplicating && (
        <AssetDrawer
          mode="create"
          duplicateFrom={asset}
          kinds={kinds}
          templates={templates}
          allAssets={allAssets}
          onClose={() => setDuplicating(false)}
          onSaved={(id) => { setDuplicating(false); onSelect(id) }}
        />
      )}

      {deleting && !hasChildren && (
        <ConfirmDialog
          title="Apagar ativo"
          message={`Apagar "${asset.name}"? Você pode desfazer logo em seguida; depois de alguns segundos os anexos também são removidos e não tem mais volta.`}
          confirmLabel="apagar"
          danger
          onCancel={() => setDeleting(false)}
          onConfirm={() => doDelete(false)}
        />
      )}
      {deleting && hasChildren && (
        <ConfirmDialog
          title="Apagar ativo com filhos"
          message={`"${asset.name}" tem ${data.descendant_count} descendente(s). Os ${data.children.length} filho(s) diretos serão movidos para o nível acima antes de apagar — nenhum descendente é excluído em cascata. Dá para desfazer logo em seguida.`}
          confirmLabel="mover filhos e apagar"
          danger
          onCancel={() => setDeleting(false)}
          onConfirm={() => doDelete(true)}
        />
      )}
    </aside>
  )
}

function StatusToggle({
  asset, canEdit, onSave,
}: { asset: Asset; canEdit: boolean; onSave: (status: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const label = asset.suppressed && asset.status === 'down'
    ? 'down por consequência (ancestral caiu)'
    : (STATUS_LABEL[asset.status] ?? asset.status)

  if (!canEdit) return <><StatusDot asset={asset} /><span className="muted small">{label}</span></>

  return (
    <span className="status-toggle">
      <button className="ghost small status-toggle-trigger" onClick={() => setOpen((v) => !v)}>
        <StatusDot asset={asset} /> {label}
      </button>
      {open && (
        <div className="status-toggle-menu">
          {['up', 'down', 'unknown'].map((s) => (
            <button
              key={s}
              className="ghost small"
              onClick={() => { setOpen(false); void onSave(s) }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function AuditLog({ assetId }: { assetId: string }) {
  const { data, isLoading } = useAudit(assetId)
  if (isLoading) return <p className="muted small">carregando…</p>
  if (!data || data.length === 0) return <p className="muted small">sem histórico ainda</p>
  return (
    <ul className="audit-list">
      {data.map((entry) => (
        <li key={entry.id}>
          <div className="audit-line">
            <strong>{ACTION_LABEL[entry.action] ?? entry.action}</strong>
            <span className="muted small">por {entry.user_email} · {relativeTime(entry.created_at)}</span>
          </div>
          {Object.keys(entry.changes ?? {}).length > 0 && (
            <ul className="audit-diff">
              {Object.entries(entry.changes).map(([field, change]) => {
                const c = change as { from?: unknown; to?: unknown }
                return (
                  <li key={field} className="muted small">
                    {field}: {String(c?.from ?? '—')} → {String(c?.to ?? '—')}
                  </li>
                )
              })}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}
