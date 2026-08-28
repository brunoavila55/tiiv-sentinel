import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Asset } from '../../api/types'
import { enqueueUpload } from '../db/queue'
import { uid, vibrate } from '../lib/device'
import { compressPhoto, currentPosition } from '../lib/image'
import { requestBackgroundSync, runSync } from '../lib/sync'
import { localKeys } from '../hooks/local'
import { useToast } from './Toast'

/**
 * Botao de camera, sempre visivel. A foto e comprimida e entra na fila local
 * antes de qualquer rede: com ou sem sinal, o fluxo do tecnico e o mesmo e ele
 * ve a miniatura na hora.
 */
export function CameraFab({ asset }: { asset: Asset }) {
  const input = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const notify = useToast()
  const [busy, setBusy] = useState(false)

  const handle = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const photo = await compressPhoto(file)
      // Sem GPS no EXIF (comum quando a camera esta sem permissao de local),
      // tentamos o aparelho. Nao bloqueia: quatro segundos e desiste.
      const gps = photo.gps ?? (await currentPosition())

      await enqueueUpload({
        id: uid(),
        assetId: asset.id,
        assetName: asset.name,
        blob: photo.blob,
        filename: photo.filename,
        mimeType: 'image/jpeg',
        sizeBytes: photo.blob.size,
        gps,
        capturedAt: photo.capturedAt,
      })
      vibrate(15)
      await qc.invalidateQueries({ queryKey: localKeys.queue })
      notify(navigator.onLine ? 'foto na fila, enviando…' : 'foto guardada; sobe quando houver rede')
      void requestBackgroundSync()
      void runSync()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'nao foi possivel preparar a foto')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden-input"
        onChange={(event) => void handle(event.target.files?.[0])}
      />
      <button
        type="button"
        className="fab"
        disabled={busy}
        aria-label="Tirar foto"
        onClick={() => input.current?.click()}
      >
        {busy ? <span className="fab-spin" /> : <CameraIcon />}
      </button>
    </>
  )
}

function CameraIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </svg>
  )
}
