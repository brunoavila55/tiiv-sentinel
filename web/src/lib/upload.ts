import { api } from '../api/client'
import type { AttachmentKind } from '../api/types'

/**
 * Upload em duas fases: presign na API, PUT direto no MinIO, confirmacao na
 * API. O arquivo nunca passa pelo backend.
 */
export async function uploadAttachment(
  assetId: string,
  file: File,
  kind: AttachmentKind,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const mime = normalizeMime(file, kind)
  const presign = await api.presign(assetId, {
    filename: file.name,
    mime_type: mime,
    kind,
    size_bytes: file.size,
  })

  await putWithProgress(presign.upload_url, file, mime, onProgress, signal)

  await api.confirmUpload(assetId, {
    object_key: presign.object_key,
    filename: file.name,
    mime_type: mime,
    kind,
    size_bytes: file.size,
    sha256: await sha256Hex(file),
    captured_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
  })
}

/** Alguns navegadores mandam .txt sem mime; a allowlist do backend exige um. */
function normalizeMime(file: File, kind: AttachmentKind): string {
  if (file.type) return file.type
  if (kind === 'config') return 'text/plain'
  if (file.name.toLowerCase().endsWith('.pdf')) return 'application/pdf'
  return 'text/plain'
}

function putWithProgress(
  url: string,
  file: File,
  mime: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
      } else {
        reject(new Error(`falha no upload para o storage (HTTP ${xhr.status})`))
      }
    }
    xhr.onerror = () =>
      reject(new Error('falha de rede no upload; confira MINIO_PUBLIC_ENDPOINT'))
    xhr.onabort = () => reject(new DOMException('upload cancelado', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

/**
 * sha256 no cliente quando o navegador permite (crypto.subtle exige contexto
 * seguro). Sem ele a API calcula em background — o hash existe para detectar
 * mudanca de config, nao para autenticar o upload.
 */
async function sha256Hex(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  try {
    const buffer = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}
