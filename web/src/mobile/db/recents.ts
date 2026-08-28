import type { Asset } from '../../api/types'
import { db, safely, type RecentEntry } from './index'

const MAX_RECENTS = 10

/**
 * Historico local dos ultimos ativos abertos. Guarda o ativo inteiro porque e
 * exatamente sem sinal que o tecnico volta no que acabou de ver.
 */
export async function rememberAsset(asset: Asset): Promise<void> {
  await safely(async () => {
    const database = await db()
    await database.put('recents', { assetId: asset.id, asset, at: Date.now() })

    // Poda pelo indice de data: dez linhas e o que cabe na tela inicial.
    const tx = database.transaction('recents', 'readwrite')
    const byDate = await tx.store.index('at').getAllKeys()
    const excess = byDate.length - MAX_RECENTS
    for (let i = 0; i < excess; i++) await tx.store.delete(byDate[i])
    await tx.done
  }, undefined)
}

export async function listRecents(): Promise<RecentEntry[]> {
  return safely(async () => {
    const database = await db()
    const all = await database.getAllFromIndex('recents', 'at')
    return all.reverse()
  }, [] as RecentEntry[])
}

export async function forgetAsset(assetId: string): Promise<void> {
  await safely(async () => (await db()).delete('recents', assetId), undefined)
}
