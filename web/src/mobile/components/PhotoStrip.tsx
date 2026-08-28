import { useEffect, useState } from 'react'
import type { Attachment } from '../../api/types'
import type { QueuedUpload } from '../db/index'
import { formatDate } from '../../lib/format'
import { useDiscardUpload, useRetryUpload } from '../hooks/local'
import { Thumb } from './Thumb'

/**
 * Carrossel de fotos. As da fila aparecem primeiro, com marca de pendente: uma
 * foto que o tecnico acabou de tirar nao pode sumir da vista so porque a rede
 * ainda nao aceitou.
 */
export function PhotoStrip({
  photos,
  queued,
  onOpen,
}: {
  photos: Attachment[]
  queued: QueuedUpload[]
  onOpen: (index: number) => void
}) {
  if (photos.length === 0 && queued.length === 0) {
    return <p className="muted">Nenhuma foto ainda.</p>
  }

  return (
    <div className="strip">
      {queued.map((item) => (
        <PendingPhoto key={item.id} item={item} />
      ))}
      {photos.map((photo, index) => (
        <button key={photo.id} type="button" className="strip-item" onClick={() => onOpen(index)}>
          <Thumb attachment={photo} alt={photo.filename} />
          <span className="strip-caption">{formatDate(photo.captured_at ?? photo.created_at)}</span>
        </button>
      ))}
    </div>
  )
}

function PendingPhoto({ item }: { item: QueuedUpload }) {
  const [url, setUrl] = useState<string | null>(null)
  const retry = useRetryUpload()
  const discard = useDiscardUpload()

  useEffect(() => {
    const objectUrl = URL.createObjectURL(item.blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [item.blob])

  const failed = item.status === 'failed'

  return (
    <div className={`strip-item strip-pending ${failed ? 'strip-failed' : ''}`}>
      {url && <img className="thumb" src={url} alt="foto aguardando envio" />}
      <span className="strip-badge">{failed ? 'falhou' : 'pendente'}</span>
      <span className="strip-caption">
        {failed ? (
          <>
            <button type="button" className="link" onClick={() => retry.mutate(item.id)}>
              tentar de novo
            </button>
            {' · '}
            <button type="button" className="link" onClick={() => discard.mutate(item.id)}>
              descartar
            </button>
          </>
        ) : (
          'na fila'
        )}
      </span>
    </div>
  )
}
