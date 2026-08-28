import { ApiError, api } from '../../api/client'
import { pendingFavorites, reconcileFavorites, settleFavorite } from '../db/favorites'
import type { QueuedUpload } from '../db/index'
import { dequeue, failUpload, nextReady, recordFailure } from '../db/queue'

/**
 * Drena a fila de upload e as estrelas pendentes. Roda quando a rede volta,
 * quando o app ganha foco e de tempos em tempos — o tecnico nao deveria
 * precisar saber que existe uma fila.
 */

type Listener = (assetId?: string) => void

const listeners = new Set<Listener>()
let running = false
let timer: number | undefined

export function onSyncChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(assetId?: string) {
  for (const fn of listeners) fn(assetId)
}

export async function runSync(): Promise<void> {
  if (running || !navigator.onLine) return
  running = true
  try {
    await drainFavorites()
    await drainUploads()
  } finally {
    running = false
    emit()
  }
}

/**
 * startSync liga os gatilhos e devolve o desligamento. O intervalo cobre o
 * backoff: um item que falhou ha 30s so fica elegivel depois, e nenhum evento
 * de rede vai acontecer nesse meio tempo.
 */
export function startSync(): () => void {
  const kick = () => void runSync()
  window.addEventListener('online', kick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick()
  })
  // Background Sync acorda o service worker, que avisa as abas abertas.
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'sync-queue') kick()
  })
  timer = window.setInterval(kick, 30_000)
  kick()
  return () => {
    window.removeEventListener('online', kick)
    if (timer) window.clearInterval(timer)
  }
}

/**
 * Pede ao navegador para acordar o service worker quando a conexao voltar.
 * Onde nao existe (iOS), os gatilhos de `startSync` cobrem — a fila sobe quando
 * o tecnico abre o app de novo.
 */
export async function requestBackgroundSync(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.ready
    const sync = (registration as unknown as { sync?: { register(tag: string): Promise<void> } })?.sync
    await sync?.register('sentinel-upload-queue')
  } catch {
    // sem Background Sync: nada a fazer, os outros gatilhos seguem valendo
  }
}

async function drainUploads(): Promise<void> {
  // Um por vez: em 3G ruim, upload paralelo so faz os dois falharem.
  for (let guard = 0; guard < 50; guard++) {
    if (!navigator.onLine) return
    const item = await nextReady()
    if (!item) return
    try {
      await uploadQueued(item)
      await dequeue(item.id)
      emit(item.assetId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'falha no upload'
      if (isPermanent(err)) {
        await failUpload(item.id, message)
      } else {
        await recordFailure(item.id, message)
      }
      emit(item.assetId)
      return // deixa o backoff correr antes da proxima tentativa
    }
  }
}

/** Erro de regra (mime recusado, sem permissao, ativo apagado) nao melhora com retry. */
function isPermanent(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.status === 408 || err.status === 429) return false
  return err.status >= 400 && err.status < 500
}

async function uploadQueued(item: QueuedUpload): Promise<void> {
  const presign = await api.presign(item.assetId, {
    filename: item.filename,
    mime_type: item.mimeType,
    kind: 'photo',
    size_bytes: item.sizeBytes,
  })
  await putObject(presign.upload_url, item.blob, item.mimeType)
  await api.confirmUpload(item.assetId, {
    object_key: presign.object_key,
    filename: item.filename,
    mime_type: item.mimeType,
    kind: 'photo',
    size_bytes: item.sizeBytes,
    sha256: await sha256Hex(item.blob),
    captured_at: item.capturedAt,
    // A imagem subiu recomprimida e sem EXIF; a coordenada vem por aqui.
    gps: item.gps,
  })
}

function putObject(url: string, blob: Blob, mime: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', mime)
    // Rede de poste trava sem fechar a conexao; sem timeout o item ficaria preso.
    xhr.timeout = 120_000
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`storage recusou o upload (HTTP ${xhr.status})`))
    xhr.onerror = () => reject(new Error('sem conexao com o storage'))
    xhr.ontimeout = () => reject(new Error('upload expirou'))
    xhr.send(blob)
  })
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  // crypto.subtle exige contexto seguro; em http puro a API calcula depois.
  if (!globalThis.crypto?.subtle) return null
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

async function drainFavorites(): Promise<void> {
  const pending = await pendingFavorites()
  for (const entry of pending) {
    try {
      if (entry.pending === 'add') await api.addFavorite(entry.assetId)
      else await api.removeFavorite(entry.assetId)
      await settleFavorite(entry)
    } catch {
      return // sem rede ou servidor fora: tenta de novo no proximo ciclo
    }
  }
  try {
    await reconcileFavorites(await api.favorites())
  } catch {
    // offline: a lista local continua valendo
  }
}
