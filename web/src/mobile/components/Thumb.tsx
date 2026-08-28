import { useEffect, useState } from 'react'
import type { Attachment } from '../../api/types'
import { packagedFile } from '../db/packages'

/**
 * Miniatura que sobrevive ao offline. Tenta a URL assinada (o service worker
 * guarda o arquivo por 30 dias) e, se falhar, cai no thumbnail gravado no
 * pacote do POP.
 */
export function Thumb({ attachment, alt }: { attachment: Attachment; alt: string }) {
  const [src, setSrc] = useState(attachment.thumb_url ?? '')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let alive = true

    const fromPackage = async () => {
      const file = await packagedFile(attachment.id)
      if (!alive || !file?.blob) {
        if (alive) setFailed(true)
        return
      }
      objectUrl = URL.createObjectURL(file.blob)
      setSrc(objectUrl)
    }

    if (!attachment.thumb_url) void fromPackage()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, attachment.thumb_url])

  if (failed || !src) return <span className="thumb thumb-empty" aria-label={alt} />

  return (
    <img
      className="thumb"
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        void packagedFile(attachment.id).then((file) => {
          if (file?.blob) setSrc(URL.createObjectURL(file.blob))
          else setFailed(true)
        })
      }}
    />
  )
}
