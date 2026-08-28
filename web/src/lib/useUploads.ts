import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { uploadAttachment } from './upload'
import { keys } from '../api/hooks'
import type { AttachmentKind } from '../api/types'

export interface UploadState {
  key: string
  name: string
  percent: number
  error?: string
}

/** Fila de uploads com progresso por arquivo. */
export function useUploads(assetId: string) {
  const [uploads, setUploads] = useState<UploadState[]>([])
  const qc = useQueryClient()

  const start = useCallback(
    (files: File[], kind: AttachmentKind) => {
      files.forEach((file) => {
        const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        setUploads((current) => [...current, { key, name: file.name, percent: 0 }])

        const patch = (changes: Partial<UploadState>) =>
          setUploads((current) => current.map((u) => (u.key === key ? { ...u, ...changes } : u)))

        uploadAttachment(assetId, file, kind, (percent) => patch({ percent }))
          .then(() => {
            qc.invalidateQueries({ queryKey: keys.asset(assetId) })
            window.setTimeout(
              () => setUploads((current) => current.filter((u) => u.key !== key)),
              1200,
            )
          })
          .catch((err: Error) => patch({ error: err.message }))
      })
    },
    [assetId, qc],
  )

  const dismiss = useCallback(
    (key: string) => setUploads((current) => current.filter((u) => u.key !== key)),
    [],
  )

  return { uploads, start, dismiss }
}
