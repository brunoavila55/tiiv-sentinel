import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Asset, OfflinePackage } from '../../api/types'
import { formatBytes, formatDate } from '../../lib/format'
import { localKeys, useOnline, usePackages, useRemovePackage } from '../hooks/local'
import { downloadPackage, fetchPackage, type DownloadProgress } from '../lib/offline'
import { useToast } from './Toast'

/**
 * Pacote offline de POP. Mostra o tamanho estimado antes de baixar porque o
 * tecnico costuma estar no plano de dados dele, e deixa remover depois.
 */
export function OfflineDownload({ asset }: { asset: Asset }) {
  const online = useOnline()
  const notify = useToast()
  const qc = useQueryClient()
  const packages = usePackages()
  const removePackage = useRemovePackage()

  const [preview, setPreview] = useState<OfflinePackage | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [loading, setLoading] = useState(false)

  const saved = packages.data?.find((p) => p.rootId === asset.id)

  const ask = async () => {
    setLoading(true)
    try {
      setPreview(await fetchPackage(asset.id))
    } catch {
      notify('nao foi possivel consultar o pacote')
    } finally {
      setLoading(false)
    }
  }

  const download = async () => {
    if (!preview) return
    setProgress({ done: 0, total: 0 })
    try {
      const entry = await downloadPackage(preview, setProgress)
      await qc.invalidateQueries({ queryKey: localKeys.packages })
      notify(`${entry.assetCount} ativos disponiveis offline (${formatBytes(entry.bytes)})`)
      setPreview(null)
    } catch {
      notify('o download do pacote falhou')
    } finally {
      setProgress(null)
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">Uso offline</h2>

      {saved && (
        <p className="offline-saved">
          Baixado em {formatDate(new Date(saved.at).toISOString())} · {saved.assetCount} ativos ·{' '}
          {formatBytes(saved.bytes)}
        </p>
      )}

      {progress && (
        <p className="muted">
          baixando {progress.done}/{progress.total} arquivos…
        </p>
      )}

      {preview && !progress && (
        <div className="offline-confirm">
          <p>
            {preview.assets.length} ativos, {preview.attachments.length} anexos.
            <br />
            Download estimado: <strong>{formatBytes(preview.estimated_bytes)}</strong> (configs e
            miniaturas; foto em resolucao original fica de fora).
          </p>
          <div className="button-row">
            <button type="button" className="btn-primary" onClick={() => void download()}>
              Baixar
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!preview && !progress && (
        <div className="button-row">
          <button type="button" className="btn-ghost" disabled={!online || loading} onClick={() => void ask()}>
            {loading ? 'consultando…' : saved ? 'Atualizar pacote' : 'Baixar para uso offline'}
          </button>
          {saved && (
            <button
              type="button"
              className="btn-ghost btn-danger"
              onClick={() => {
                removePackage.mutate(asset.id)
                notify('pacote removido')
              }}
            >
              Remover
            </button>
          )}
        </div>
      )}

      {!online && !saved && <p className="muted">Sem rede: baixe o pacote quando estiver conectado.</p>}
    </section>
  )
}
