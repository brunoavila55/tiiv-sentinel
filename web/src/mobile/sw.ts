/// <reference lib="webworker" />

/**
 * Service worker da PWA de campo. O precache vem do Vite; a logica e escrita a
 * mao porque nenhuma das quatro estrategias e a receita de prateleira:
 *
 *  1. app shell (JS/CSS/HTML) — precache, cache-first
 *  2. GET /api/assets* e /api/favorites — network-first com fallback no cache
 *  3. thumbnail do MinIO — cache-first, 30 dias, ignorando a assinatura na chave
 *  4. foto em resolucao original — sem cache, pesada demais
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[]
}

const MANIFEST = self.__WB_MANIFEST

// A versao sai do proprio manifesto: build novo, cache novo, sem numero magico
// para alguem esquecer de incrementar.
const VERSION = hash(MANIFEST.map((e) => `${e.url}:${e.revision ?? ''}`).join('|'))
const SHELL_CACHE = `sentinel-shell-${VERSION}`
const API_CACHE = 'sentinel-api-v1'
const THUMB_CACHE = 'sentinel-thumbs-v1'

const SHELL_INDEX = '/m/index.html'
const THUMB_MAX_AGE = 30 * 24 * 60 * 60 * 1000
const THUMB_MAX_ENTRIES = 400
const CACHED_AT = 'x-sentinel-cached-at'

self.addEventListener('install', (event) => {
  event.waitUntil(precache())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Os caches de API e thumbnail atravessam deploys de proposito: o
        // tecnico que abriu o app offline logo apos um deploy ainda ve os dados.
        if (name.startsWith('sentinel-shell-') && name !== SHELL_CACHE) await caches.delete(name)
      }
      await trimThumbs()
      await self.clients.claim()
    })(),
  )
})

// O prompt de atualizacao chama isto quando o tecnico aceita recarregar.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

/**
 * Background Sync: o navegador acorda o worker quando a rede volta. O upload em
 * si roda na aba (o blob e a sessao vivem la), entao aqui so avisamos.
 */
self.addEventListener('sync', (event) => {
  // 'sync' nao esta no mapa de eventos tipado do TS: Background Sync ainda nao
  // e padrao, entao o cast e inevitavel.
  const sync = event as ExtendableEvent & { tag?: string }
  if (sync.tag !== 'sentinel-upload-queue') return
  sync.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) client.postMessage({ type: 'sync-queue' })
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  // Navegacao: sempre o app shell precacheado. E o que faz o modo aviao abrir o
  // app em vez da tela de dinossauro.
  if (request.mode === 'navigate') {
    event.respondWith(shellFirst(request))
    return
  }

  const url = new URL(request.url)

  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    if (isCacheableApi(url.pathname)) event.respondWith(networkFirst(request))
    return // o resto da API (login, presign, confirm) e sempre rede
  }

  if (isThumbnail(url)) {
    event.respondWith(thumbFirst(request, url))
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/m/')) {
    event.respondWith(shellFirst(request))
  }
  // Foto em resolucao original e qualquer outra coisa: passa direto, sem cache.
})

async function precache(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE)
  const urls = MANIFEST.map((entry) => entry.url)
  // addAll aborta tudo se um arquivo falhar; um a um degrada melhor.
  await Promise.all(
    urls.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }))
      } catch (err) {
        console.warn('precache falhou', url, err)
      }
    }),
  )
  // Sem skipWaiting aqui de proposito: a nova versao espera o tecnico aceitar o
  // prompt. Recarregar sozinho no meio de um upload em 3G ruim e a pior hora.
}

/** Cache-first do app shell, com a index como resposta de qualquer navegacao. */
async function shellFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request, { ignoreSearch: true })
  if (cached) return cached
  if (request.mode === 'navigate') {
    const index = await cache.match(SHELL_INDEX)
    if (index) return index
  }
  try {
    return await fetch(request)
  } catch {
    const index = await cache.match(SHELL_INDEX)
    if (index) return index
    return new Response('offline', { status: 503, statusText: 'offline' })
  }
}

function isCacheableApi(pathname: string): boolean {
  return pathname.startsWith('/api/assets') || pathname.startsWith('/api/favorites')
}

/**
 * Network-first: online o tecnico ve o estado real; sem rede cai no ultimo
 * payload conhecido, que e melhor que uma tela vazia.
 */
async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE)
  try {
    const response = await fetch(request)
    // 401 nao entra no cache: sessao vencida nao pode virar resposta offline.
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw err
  }
}

/** O thumbnail sai do pos-processamento sempre com este sufixo. */
function isThumbnail(url: URL): boolean {
  return url.pathname.endsWith('_thumb.jpg')
}

/**
 * Cache-first de thumbnail. A chave descarta a query porque a assinatura muda a
 * cada leitura: sem isso o mesmo arquivo entraria no cache a cada abertura da
 * galeria.
 */
async function thumbFirst(request: Request, url: URL): Promise<Response> {
  const cache = await caches.open(THUMB_CACHE)
  const key = new Request(url.origin + url.pathname)
  const cached = await cache.match(key)
  if (cached && !expired(cached)) return cached

  try {
    // mode cors para a resposta ser legivel e cacheavel — Cache.put recusa
    // resposta opaca. O MinIO responde com CORS liberado para presigned URL.
    const response = await fetch(url.toString(), { mode: 'cors', credentials: 'omit' })
    if (!response.ok) return cached ?? response
    await cache.put(key, await stamp(response.clone()))
    void trimThumbs()
    return response
  } catch {
    if (cached) return cached
    // CORS bloqueado ou offline: devolve o que a rede der, sem cachear.
    return fetch(request)
  }
}

/** Marca a hora do cache no proprio corpo guardado, para saber quando expira. */
async function stamp(response: Response): Promise<Response> {
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT, String(Date.now()))
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function expired(response: Response): boolean {
  const at = Number(response.headers.get(CACHED_AT) ?? 0)
  if (!at) return false
  return Date.now() - at > THUMB_MAX_AGE
}

/** Poda por idade e por quantidade: o aparelho do tecnico nao e um datacenter. */
async function trimThumbs(): Promise<void> {
  const cache = await caches.open(THUMB_CACHE)
  const keys = await cache.keys()
  const alive: Request[] = []
  for (const key of keys) {
    const response = await cache.match(key)
    if (!response || expired(response)) await cache.delete(key)
    else alive.push(key)
  }
  const excess = alive.length - THUMB_MAX_ENTRIES
  for (let i = 0; i < excess; i++) await cache.delete(alive[i])
}

/** FNV-1a: so precisa distinguir builds, nao resistir a colisao adversarial. */
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export {}
