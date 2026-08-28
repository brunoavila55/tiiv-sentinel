import { useRef, useState } from 'react'
import type { AttachmentKind } from '../api/types'

/** Area de drag-and-drop com selecao manual como alternativa. */
export function Dropzone({
  kind,
  accept,
  hint,
  disabled,
  onFiles,
}: {
  kind: AttachmentKind
  accept: string
  hint: string
  disabled?: boolean
  onFiles: (files: File[], kind: AttachmentKind) => void
}) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  if (disabled) return null

  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onFiles(files, kind)
      }}
      onClick={() => input.current?.click()}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onFiles(files, kind)
          e.target.value = ''
        }}
      />
      <span>{hint}</span>
    </div>
  )
}
