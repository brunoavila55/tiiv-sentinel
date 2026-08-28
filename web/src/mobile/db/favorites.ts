import type { Asset } from '../../api/types'
import { db, safely, type FavoriteEntry } from './index'

/**
 * Favoritos local-first: a estrela responde na hora, offline inclusive, e a
 * operacao fica marcada como `pending` ate o servidor confirmar.
 */

export async function listFavorites(): Promise<FavoriteEntry[]> {
  return safely(async () => {
    const database = await db()
    const all = await database.getAll('favorites')
    return all
      .filter((f) => f.pending !== 'remove')
      .sort((a, b) => a.asset.name.localeCompare(b.asset.name, 'pt-BR'))
  }, [] as FavoriteEntry[])
}

export async function isFavorite(assetId: string): Promise<boolean> {
  return safely(async () => {
    const entry = await (await db()).get('favorites', assetId)
    return Boolean(entry) && entry!.pending !== 'remove'
  }, false)
}

export async function markFavorite(asset: Asset, favorite: boolean): Promise<void> {
  await safely(async () => {
    const database = await db()
    if (favorite) {
      await database.put('favorites', {
        assetId: asset.id,
        asset,
        at: Date.now(),
        pending: 'add',
      })
      return
    }
    // Desfavoritar offline nao apaga o registro: sem ele nao ha o que enviar
    // quando a rede voltar. A lista ja filtra `pending: 'remove'`.
    const existing = await database.get('favorites', asset.id)
    await database.put('favorites', {
      assetId: asset.id,
      asset: existing?.asset ?? asset,
      at: Date.now(),
      pending: 'remove',
    })
  }, undefined)
}

/** Operacoes que ainda precisam ir ao servidor. */
export async function pendingFavorites(): Promise<FavoriteEntry[]> {
  return safely(async () => {
    const all = await (await db()).getAll('favorites')
    return all.filter((f) => f.pending !== null)
  }, [] as FavoriteEntry[])
}

export async function settleFavorite(entry: FavoriteEntry): Promise<void> {
  await safely(async () => {
    const database = await db()
    if (entry.pending === 'remove') {
      await database.delete('favorites', entry.assetId)
      return
    }
    const current = await database.get('favorites', entry.assetId)
    // Se o tecnico mexeu na estrela de novo durante o envio, a intencao mais
    // recente vence e continua pendente.
    if (!current || current.at !== entry.at) return
    await database.put('favorites', { ...current, pending: null })
  }, undefined)
}

/**
 * Reconcilia com a lista do servidor. O que esta pendente localmente e
 * preservado: a intencao do tecnico e mais nova que a resposta que veio.
 */
export async function reconcileFavorites(serverList: Asset[]): Promise<void> {
  await safely(async () => {
    const database = await db()
    const tx = database.transaction('favorites', 'readwrite')
    const local = await tx.store.getAll()
    const pending = new Map(local.filter((f) => f.pending !== null).map((f) => [f.assetId, f]))

    for (const entry of local) {
      if (!pending.has(entry.assetId)) await tx.store.delete(entry.assetId)
    }
    for (const asset of serverList) {
      if (pending.has(asset.id)) continue
      await tx.store.put({ assetId: asset.id, asset, at: Date.now(), pending: null })
    }
    await tx.done
  }, undefined)
}
