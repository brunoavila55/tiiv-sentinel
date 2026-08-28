import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { keys } from '../api/hooks'

interface AssetEvent {
  id?: string
  asset_id?: string
  parent_id?: string | null
}

/**
 * Assina o stream SSE e invalida as queries correspondentes. O EventSource ja
 * reconecta sozinho; o timer abaixo cobre o caso de erro fatal (sessao caiu).
 */
export function useEventStream(enabled: boolean) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    let source: EventSource | null = null
    let retry = 0
    let timer: number | undefined
    let closed = false

    const handle = (raw: MessageEvent, type: string) => {
      retry = 0
      let data: AssetEvent = {}
      try {
        data = JSON.parse(raw.data)
      } catch {
        return
      }
      const assetId = data.asset_id ?? data.id
      if (assetId) qc.invalidateQueries({ queryKey: keys.asset(assetId) })
      if (type !== 'attachment.added' && type !== 'attachment.removed') {
        qc.invalidateQueries({ queryKey: keys.tree })
      }
      if (data.parent_id) qc.invalidateQueries({ queryKey: keys.asset(data.parent_id) })
    }

    const connect = () => {
      if (closed) return
      source = new EventSource('/api/events', { withCredentials: true })
      const types = [
        'asset.status_changed',
        'asset.updated',
        'asset.created',
        'asset.deleted',
        'attachment.added',
        'attachment.removed',
      ]
      types.forEach((type) => source?.addEventListener(type, (e) => handle(e as MessageEvent, type)))
      source.onerror = () => {
        source?.close()
        source = null
        retry = Math.min(retry + 1, 6)
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry, 30_000))
      }
    }

    connect()
    return () => {
      closed = true
      if (timer) window.clearTimeout(timer)
      source?.close()
    }
  }, [enabled, qc])
}
