import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../api/types'
import { formatDate } from '../../lib/format'
import { packagedFile } from '../db/packages'

/**
 * Foto em tela cheia com pinch-zoom escrito a mao. Biblioteca de gesto para
 * isto passaria do orcamento de bundle, e sao dois ponteiros e uma matriz de
 * escala e translacao.
 */
export function PhotoViewer({
  photos,
  index,
  onClose,
}: {
  photos: Attachment[]
  index: number
  onClose: () => void
}) {
  const [current, setCurrent] = useState(index)
  const photo = photos[current]

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // Trava a rolagem do fundo enquanto a foto esta aberta.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  if (!photo) return null

  return (
    <div className="viewer" role="dialog" aria-modal="true">
      <header className="viewer-bar">
        <button type="button" className="viewer-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <span className="viewer-title">
          {current + 1}/{photos.length} · {formatDate(photo.captured_at ?? photo.created_at)}
        </span>
      </header>

      <Zoomable key={photo.id} attachment={photo} />

      {photos.length > 1 && (
        <nav className="viewer-nav">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setCurrent((i) => Math.max(0, i - 1))}
          >
            ‹ anterior
          </button>
          <button
            type="button"
            disabled={current === photos.length - 1}
            onClick={() => setCurrent((i) => Math.min(photos.length - 1, i + 1))}
          >
            proxima ›
          </button>
        </nav>
      )}
    </div>
  )
}

interface Transform {
  scale: number
  x: number
  y: number
}

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 }
const MAX_SCALE = 5

function Zoomable({ attachment }: { attachment: Attachment }) {
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [src, setSrc] = useState(attachment.url ?? '')
  const [degraded, setDegraded] = useState(false)
  const gesture = useRef<{ distance: number; scale: number; x: number; y: number } | null>(null)
  const pan = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const lastTap = useRef(0)

  useEffect(() => {
    let objectUrl: string | null = null
    if (!attachment.url) {
      // Sem rede: o pacote offline guarda o thumbnail, nao o original.
      void packagedFile(attachment.id).then((file) => {
        if (!file?.blob) return
        objectUrl = URL.createObjectURL(file.blob)
        setSrc(objectUrl)
        setDegraded(true)
      })
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, attachment.url])

  const distance = (touches: React.TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

  const onTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      gesture.current = {
        distance: distance(event.touches),
        scale: transform.scale,
        x: transform.x,
        y: transform.y,
      }
      pan.current = null
      return
    }
    if (event.touches.length === 1) {
      // Toque duplo alterna entre encaixado e 2,5x — o gesto que todo mundo ja
      // usa na galeria do celular.
      const now = Date.now()
      if (now - lastTap.current < 280) {
        setTransform(transform.scale > 1 ? IDENTITY : { scale: 2.5, x: 0, y: 0 })
        lastTap.current = 0
        return
      }
      lastTap.current = now
      if (transform.scale > 1) {
        pan.current = {
          x: transform.x,
          y: transform.y,
          startX: event.touches[0].clientX,
          startY: event.touches[0].clientY,
        }
      }
    }
  }

  const onTouchMove = (event: React.TouchEvent) => {
    if (event.touches.length === 2 && gesture.current) {
      const ratio = distance(event.touches) / gesture.current.distance
      const scale = clamp(gesture.current.scale * ratio, 1, MAX_SCALE)
      setTransform({ scale, x: gesture.current.x * (scale / gesture.current.scale), y: gesture.current.y * (scale / gesture.current.scale) })
      return
    }
    if (event.touches.length === 1 && pan.current) {
      setTransform((prev) => ({
        ...prev,
        x: pan.current!.x + (event.touches[0].clientX - pan.current!.startX),
        y: pan.current!.y + (event.touches[0].clientY - pan.current!.startY),
      }))
    }
  }

  const onTouchEnd = () => {
    gesture.current = null
    pan.current = null
    // Voltou ao tamanho original: recentraliza para nao ficar torto.
    setTransform((prev) => (prev.scale <= 1.01 ? IDENTITY : prev))
  }

  return (
    <div
      className="viewer-stage"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {src ? (
        <img
          className="viewer-img"
          src={src}
          alt={attachment.filename}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        />
      ) : (
        <p className="viewer-empty">Foto indisponivel offline.</p>
      )}
      {degraded && (
        <p className="viewer-note">
          Sem rede: mostrando a miniatura do pacote offline. O original nao e baixado.
        </p>
      )}
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
