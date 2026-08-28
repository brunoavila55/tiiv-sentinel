import { useState } from 'react'
import type { Attachment } from '../api/types'
import { formatBytes, formatDate } from '../lib/format'

/** Galeria carrega thumbnails; o original so abre no lightbox. */
export function PhotoGallery({
  photos,
  canDelete,
  onDelete,
}: {
  photos: Attachment[]
  canDelete: boolean
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState<Attachment | null>(null)

  if (photos.length === 0) return <p className="muted">nenhuma foto</p>

  return (
    <>
      <div className="gallery">
        {photos.map((photo) => (
          <figure key={photo.id}>
            <img
              src={photo.thumb_url ?? photo.url}
              alt={photo.filename}
              loading="lazy"
              onClick={() => setOpen(photo)}
            />
            {!photo.thumb_url && <span className="badge tiny">processando…</span>}
            {canDelete && (
              <button className="ghost small delete" title="remover" onClick={() => onDelete(photo.id)}>
                ×
              </button>
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
