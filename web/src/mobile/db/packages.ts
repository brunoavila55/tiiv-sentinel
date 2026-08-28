import type { Asset, AssetDetail } from '../../api/types'
import { db, safely, type PackageAsset, type PackageEntry, type PackageFile } from './index'

/**
 * Pacote offline de POP: o subtree inteiro, os thumbnails e o texto das configs
 * gravados no aparelho. Foto em resolucao original fica de fora — sao os
 * megabytes que nao cabem e nao e o que se olha dentro de um armario de rede.
 */

export async function savePackage(
  entry: PackageEntry,
  assets: PackageAsset[],
  files: PackageFile[],
): Promise<void> {
  await safely(async () => {
    const database = await db()
    // Substitui o pacote anterior do mesmo POP em vez de acumular versoes.
    await removePackage(entry.rootId)
    const tx = database.transaction(['packages', 'packageAssets', 'packageFiles'], 'readwrite')
    await tx.objectStore('packages').put(entry)
    for (const asset of assets) await tx.objectStore('packageAssets').put(asset)
    for (const file of files) await tx.objectStore('packageFiles').put(file)
    await tx.done
  }, undefined)
}

export async function listPackages(): Promise<PackageEntry[]> {
  return safely(async () => {
    const all = await (await db()).getAll('packages')
    return all.sort((a, b) => b.at - a.at)
  }, [] as PackageEntry[])
}

export async function removePackage(rootId: string): Promise<void> {
  await safely(async () => {
    const database = await db()
    const tx = database.transaction(['packages', 'packageAssets', 'packageFiles'], 'readwrite')
    await tx.objectStore('packages').delete(rootId)
    for (const key of await tx.objectStore('packageAssets').index('rootId').getAllKeys(rootId)) {
      await tx.objectStore('packageAssets').delete(key)
    }
    for (const key of await tx.objectStore('packageFiles').index('rootId').getAllKeys(rootId)) {
      await tx.objectStore('packageFiles').delete(key)
    }
    await tx.done
  }, undefined)
}

/** Ativo do pacote, com seus anexos. E o que a tela de detalhe usa sem rede. */
export async function packagedAsset(assetId: string): Promise<PackageAsset | undefined> {
  return safely(async () => (await db()).get('packageAssets', assetId), undefined)
}

export async function packagedChildren(parentId: string | null): Promise<PackageAsset[]> {
  return safely(async () => {
    const all = await (await db()).getAll('packageAssets')
    return all
      .filter((entry) => entry.asset.parent_id === parentId)
      .sort((a, b) => a.asset.name.localeCompare(b.asset.name, 'pt-BR'))
  }, [] as PackageAsset[])
}

export async function packagedFile(attachmentId: string): Promise<PackageFile | undefined> {
  return safely(async () => (await db()).get('packageFiles', attachmentId), undefined)
}

/**
 * Monta a mesma forma de GET /api/assets/:id a partir do pacote, para a tela de
 * detalhe nao precisar saber se os dados vieram da rede ou do aparelho.
 */
export async function packagedDetail(assetId: string): Promise<AssetDetail | undefined> {
  return safely(async () => {
    const database = await db()
    const entry = await database.get('packageAssets', assetId)
    if (!entry) return undefined
    const all = await database.getAllFromIndex('packageAssets', 'rootId', entry.rootId)
    const byId = new Map(all.map((item) => [item.assetId, item.asset]))

    // Breadcrumb subindo pelo parent_id dentro do proprio pacote.
    const breadcrumb: Asset[] = []
    let cursor = entry.asset.parent_id
    while (cursor && byId.has(cursor) && breadcrumb.length < 32) {
      const parent = byId.get(cursor) as Asset
      breadcrumb.unshift(parent)
      cursor = parent.parent_id
    }

    const children = all
      .filter((item) => item.asset.parent_id === assetId)
      .map((item) => item.asset)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

    return { asset: entry.asset, breadcrumb, children, attachments: entry.attachments, descendant_count: children.length }
  }, undefined)
}

/** Busca dentro dos pacotes baixados: e a busca que funciona sem sinal. */
export async function searchPackaged(term: string, limit = 20): Promise<Asset[]> {
  const needle = term.trim().toLowerCase()
  if (!needle) return []
  return safely(async () => {
    const all = await (await db()).getAll('packageAssets')
    return all
      .map((entry) => entry.asset)
      .filter(
        (asset) =>
          asset.name.toLowerCase().includes(needle) ||
          (asset.mgmt_ip ?? '').includes(needle) ||
          (asset.description ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        // Match exato de IP primeiro, como no servidor.
        const exact = (asset: Asset) => (asset.mgmt_ip === term.trim() ? 0 : 1)
        return exact(a) - exact(b) || a.name.localeCompare(b.name, 'pt-BR')
      })
      .slice(0, limit)
  }, [] as Asset[])
}

/** Data do pacote que cobre este ativo, para a faixa "voce esta vendo dados de {data}". */
export async function packageCovering(assetId: string): Promise<PackageEntry | undefined> {
  return safely(async () => {
    const database = await db()
    const entry = await database.get('packageAssets', assetId)
    if (!entry) return undefined
    return database.get('packages', entry.rootId)
  }, undefined)
}
