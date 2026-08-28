import type { Asset } from '../../api/types'
import { listFavorites } from '../db/favorites'
import { searchPackaged } from '../db/packages'
import { listRecents } from '../db/recents'

/**
 * Busca local, usada quando nao ha rede. Varre o que ja esta no aparelho:
 * pacotes de POP baixados, favoritos e historico — nessa ordem de confianca,
 * porque o pacote e o mais completo.
 */
export async function searchLocal(term: string, limit = 20): Promise<Asset[]> {
  const needle = term.trim().toLowerCase()
  if (!needle) return []

  const [packaged, favorites, recents] = await Promise.all([
    searchPackaged(term, limit),
    listFavorites(),
    listRecents(),
  ])

  const matches = (asset: Asset) =>
    asset.name.toLowerCase().includes(needle) ||
    (asset.mgmt_ip ?? '').includes(needle) ||
    (asset.description ?? '').toLowerCase().includes(needle)

  const seen = new Set<string>()
  const out: Asset[] = []
  for (const asset of [
    ...packaged,
    ...favorites.map((f) => f.asset).filter(matches),
    ...recents.map((r) => r.asset).filter(matches),
  ]) {
    if (seen.has(asset.id)) continue
    seen.add(asset.id)
    out.push(asset)
    if (out.length >= limit) break
  }

  // Match exato de IP na frente, como faz o servidor: e o caso mais comum na rua.
  const exact = term.trim()
  return out.sort((a, b) => Number(b.mgmt_ip === exact) - Number(a.mgmt_ip === exact))
}
