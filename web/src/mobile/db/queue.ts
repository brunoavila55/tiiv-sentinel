import { db, safely, type QueuedUpload } from './index'

/**
 * Fila de upload. Foto tirada sem sinal fica aqui, com o blob ja comprimido, e
 * sobe sozinha quando a rede volta. Sobrevive a fechar e reabrir o app porque
 * mora no IndexedDB, nao em memoria.
 */

export const MAX_ATTEMPTS = 5

export async function enqueueUpload(
  item: Omit<QueuedUpload, 'attempts' | 'status' | 'error' | 'nextAttemptAt' | 'createdAt'>,
): Promise<QueuedUpload> {
  const entry: QueuedUpload = {
    ...item,
    attempts: 0,
    status: 'pending',
    error: null,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  }
  await safely(async () => (await db()).put('queue', entry), undefined)
  return entry
}

export async function listQueue(): Promise<QueuedUpload[]> {
  return safely(async () => {
    const all = await (await db()).getAllFromIndex('queue', 'createdAt')
    return all
  }, [] as QueuedUpload[])
}

export async function queueForAsset(assetId: string): Promise<QueuedUpload[]> {
  return safely(async () => (await db()).getAllFromIndex('queue', 'assetId', assetId), [] as QueuedUpload[])
}

/** Proximo item elegivel: pendente e fora da janela de backoff. */
export async function nextReady(now = Date.now()): Promise<QueuedUpload | undefined> {
  const all = await listQueue()
  return all.find((item) => item.status === 'pending' && item.nextAttemptAt <= now)
}

export async function countPending(): Promise<number> {
  const all = await listQueue()
  return all.filter((item) => item.status === 'pending').length
}

export async function dequeue(id: string): Promise<void> {
  await safely(async () => (await db()).delete('queue', id), undefined)
}

/**
 * Backoff exponencial a partir de 5s, teto de 5 minutos. Passando de
 * MAX_ATTEMPTS o item vira `failed` e some da rotina automatica — fica visivel
 * na tela para o tecnico decidir.
 */
export async function recordFailure(id: string, message: string): Promise<void> {
  await safely(async () => {
    const database = await db()
    const item = await database.get('queue', id)
    if (!item) return
    const attempts = item.attempts + 1
    const backoff = Math.min(5_000 * 2 ** (attempts - 1), 5 * 60_000)
    await database.put('queue', {
      ...item,
      attempts,
      error: message,
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      nextAttemptAt: Date.now() + backoff,
    })
  }, undefined)
}

/**
 * Falha definitiva: 403, mime recusado, ativo apagado. Insistir nao resolve,
 * entao vai direto para `failed` em vez de queimar cinco tentativas.
 */
export async function failUpload(id: string, message: string): Promise<void> {
  await safely(async () => {
    const database = await db()
    const item = await database.get('queue', id)
    if (!item) return
    await database.put('queue', {
      ...item,
      attempts: MAX_ATTEMPTS,
      status: 'failed',
      error: message,
      nextAttemptAt: 0,
    })
  }, undefined)
}

/** Retry manual de um item que esgotou as tentativas. */
export async function retryUpload(id: string): Promise<void> {
  await safely(async () => {
    const database = await db()
    const item = await database.get('queue', id)
    if (!item) return
    await database.put('queue', { ...item, attempts: 0, status: 'pending', error: null, nextAttemptAt: 0 })
  }, undefined)
}
