import { useRef, useState } from 'react'
import type { Attachment } from '../api/types'
import { formatBytes, formatDate } from '../lib/format'

/** Galeria carrega thumbnails; o original so abre no lightbox. */
export function PhotoGallery({
  photos,
  canDelete,
  coverId,
  onDelete,
  onSetCover,
  onRename,
  onReorder,
}: {
  photos: Attachment[]
  canDelete: boolean
  coverId?: string | null
  onDelete: (id: string) => void
  onSetCover?: (id: string) => void
  onRename?: (id: string, filename: string) => void
  onReorder?: (orderedIds: string[]) => void
}) {
  const [open, setOpen] = useState<Attachment | null>(null)
  const dragId = useRef<string | null>(null)

  if (photos.length === 0) return <p className="muted">nenhuma foto</p>

  const canReorder = canDelete && Boolean(onReorder) && photos.length > 1

  const handleDrop = (targetId: string) => {
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId || sourceId === targetId || !onReorder) return
    const order = photos.map((p) => p.id)
    const from = order.indexOf(sourceId)
    const to = order.indexOf(targetId)
    order.splice(from, 1)
    order.splice(to, 0, sourceId)
    onReorder(order)
  }

  return (
    <>
      <div className="gallery">
        {photos.map((photo) => (
          <figure
            key={photo.id}
            draggable={canReorder}
            onDragStart={() => { dragId.current = photo.id }}
            onDragOver={(e) => canReorder && e.preventDefault()}
            onDrop={() => handleDrop(photo.id)}
          >
            <img
              src={photo.thumb_url ?? photo.url}
              alt={photo.filename}
              loading="lazy"
              onClick={() => setOpen(photo)}
            />
            {!photo.thumb_url && <span className="badge tiny">processando…</span>}
            {photo.id === coverId && <span className="badge tiny cover-badge">capa</span>}
            {canDelete && (
              <div className="gallery-actions">
                {onSetCover && photo.id !== coverId && (
                  <button className="ghost small" title="definir como capa" onClick={() => onSetCover(photo.id)}>★</button>
                )}
                {onRename && (
                  <button
                    className="ghost small"
                    title="renomear"
                    onClick={() => {
                      const next = window.prompt('novo nome do arquivo', photo.filename)
                      if (next && next.trim()) onRename(photo.id, next.trim())
                    }}
                  >
                    ✎
                  </button>
                )}
                <button className="ghost small delete" title="remover" onClick={() => onDelete(photo.id)}>×</button>
              </div>
            )}
          </figure>
        ))}
      </div>

      {open && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img src={open.url} alt={open.filename} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-meta" onClick={(e) => e.stopPropagation()}>
            <strong>{open.filename}</strong>
            <span>{formatBytes(open.size_bytes)}</span>
            <span>{formatDate(open.captured_at ?? open.created_at)}</span>
            <a href={open.url} target="_blank" rel="noreferrer">abrir original</a>
          </div>
        </div>
      )}
    </>
  )
}
