import { api } from '../../api/client'
import type { Attachment, OfflinePackage } from '../../api/types'
import { savePackage } from '../db/packages'
import type { PackageAsset, PackageEntry, PackageFile } from '../db/index'

/**
 * Baixa o pacote offline de um POP: o subtree, os thumbnails e o texto integral
 * das configs. Config e .txt e pesa quase nada — e o que o tecnico mais precisa
 * dentro de um armario de rede sem sinal. Foto em resolucao original fica de
 * fora por padrao.
 */

// Poucas conexoes em paralelo: em 4G de rua, muitas so aumentam o timeout.
const CONCURRENCY = 4

export interface DownloadProgress {
  done: number
  total: number
}

export async function fetchPackage(rootId: string): Promise<OfflinePackage> {
  return api.offlinePackage(rootId)
}

export async function downloadPackage(
  pkg: OfflinePackage,
  onProgress?: (p: DownloadProgress) => void,
): Promise<PackageEntry> {
  const wanted = pkg.attachments.filter(downloadable)
  const files: PackageFile[] = []
  let bytes = 0
  let done = 0

  await inParallel(wanted, CONCURRENCY, async (attachment) => {
    const file = await fetchFile(pkg.root.id, attachment)
    if (file) {
      files.push(file)
      bytes += file.blob?.size ?? file.text?.length ?? 0
    }
    done += 1
    onProgress?.({ done, total: wanted.length })
  })

  const byAsset = new Map<string, Attachment[]>()
  for (const attachment of pkg.attachments) {
    const list = byAsset.get(attachment.asset_id) ?? []
    list.push(attachment)
    byAsset.set(attachment.asset_id, list)
  }

  const assets: PackageAsset[] = pkg.assets.map((asset) => ({
    assetId: asset.id,
    rootId: pkg.root.id,
    asset,
    attachments: byAsset.get(asset.id) ?? [],
  }))

  const entry: PackageEntry = {
    rootId: pkg.root.id,
    name: pkg.root.name,
    at: Date.parse(pkg.generated_at) || Date.now(),
    assetCount: pkg.assets.length,
    bytes,
  }
  await savePackage(entry, assets, files)
  return entry
}

function downloadable(attachment: Attachment): boolean {
  if (attachment.kind === 'config') return Boolean(attachment.url)
  if (attachment.kind === 'photo') return Boolean(attachment.thumb_url)
  return false
}

async function fetchFile(rootId: string, attachment: Attachment): Promise<PackageFile | null> {
  try {
    if (attachment.kind === 'config') {
      const res = await fetch(attachment.url as string)
      if (!res.ok) return null
      return {
        attachmentId: attachment.id,
        rootId,
        kind: 'config',
        blob: null,
        text: await res.text(),
      }
    }
    const res = await fetch(attachment.thumb_url as string)
    if (!res.ok) return null
    return { attachmentId: attachment.id, rootId, kind: 'thumb', blob: await res.blob(), text: null }
  } catch {
    // Um arquivo que nao veio nao invalida o pacote: o resto continua util.
    return null
  }
}

async function inParallel<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}
