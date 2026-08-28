import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Asset, Attachment } from '../../api/types'

/**
 * Tudo que a PWA guarda localmente vive aqui. A regra: o que o tecnico precisa
 * sem sinal e gravado com o payload completo do ativo, nunca so o id — um id
 * offline nao serve para nada.
 */

export interface RecentEntry {
  assetId: string
  asset: Asset
  at: number
}

export interface FavoriteEntry {
  assetId: string
  asset: Asset
  at: number
  /** Operacao ainda nao confirmada pelo servidor. Local-first: a estrela muda na hora. */
  pending: 'add' | 'remove' | null
}

export interface QueuedUpload {
  id: string
  assetId: string
  assetName: string
  blob: Blob
  filename: string
  mimeType: string
  sizeBytes: number
  gps: { lat: number; lon: number } | null
  capturedAt: string | null
  attempts: number
  status: 'pending' | 'failed'
  error: string | null
  /** Backoff exponencial: nao tenta antes disto. */
  nextAttemptAt: number
  createdAt: number
}

export interface PackageEntry {
  rootId: string
  name: string
  at: number
  assetCount: number
  bytes: number
}

export interface PackageAsset {
  assetId: string
  rootId: string
  asset: Asset
  attachments: Attachment[]
}

/** Thumbnail (blob) ou texto integral de config, por anexo. */
export interface PackageFile {
  attachmentId: string
  rootId: string
  kind: 'thumb' | 'config'
  blob: Blob | null
  text: string | null
}

interface SentinelDB extends DBSchema {
  recents: { key: string; value: RecentEntry; indexes: { at: number } }
  favorites: { key: string; value: FavoriteEntry; indexes: { at: number } }
  queue: { key: string; value: QueuedUpload; indexes: { assetId: string; createdAt: number } }
  packages: { key: string; value: PackageEntry }
  packageAssets: { key: string; value: PackageAsset; indexes: { rootId: string } }
  packageFiles: { key: string; value: PackageFile; indexes: { rootId: string } }
}

const DB_NAME = 'sentinel-mobile'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<SentinelDB>> | null = null

export function db(): Promise<IDBPDatabase<SentinelDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SentinelDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const recents = database.createObjectStore('recents', { keyPath: 'assetId' })
        recents.createIndex('at', 'at')

        const favorites = database.createObjectStore('favorites', { keyPath: 'assetId' })
        favorites.createIndex('at', 'at')

        const queue = database.createObjectStore('queue', { keyPath: 'id' })
        queue.createIndex('assetId', 'assetId')
        queue.createIndex('createdAt', 'createdAt')

        database.createObjectStore('packages', { keyPath: 'rootId' })

        const packageAssets = database.createObjectStore('packageAssets', { keyPath: 'assetId' })
        packageAssets.createIndex('rootId', 'rootId')

        const packageFiles = database.createObjectStore('packageFiles', { keyPath: 'attachmentId' })
        packageFiles.createIndex('rootId', 'rootId')
      },
    })
  }
  return dbPromise
}

/**
 * Modo anonimo, cota estourada ou Safari com storage bloqueado derrubam o
 * IndexedDB inteiro. Nada disso pode quebrar a tela: o app continua online-only.
 */
export async function safely<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.warn('armazenamento local indisponivel', err)
    return fallback
  }
}

/** Limpa tudo — usado no logout, para nao deixar dados de um tecnico no aparelho de outro. */
export async function wipeLocalData(): Promise<void> {
  await safely(async () => {
    const database = await db()
    const stores = ['recents', 'favorites', 'queue', 'packages', 'packageAssets', 'packageFiles'] as const
    const tx = database.transaction(stores, 'readwrite')
    await Promise.all(stores.map((s) => tx.objectStore(s).clear()))
    await tx.done
  }, undefined)
}
