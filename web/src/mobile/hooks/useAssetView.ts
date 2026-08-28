import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Asset, AssetDetail } from '../../api/types'
import { packageCovering, packagedChildren, packagedDetail } from '../db/packages'
import type { PackageEntry } from '../db/index'

/**
 * A tela nao deveria saber de onde vieram os dados. Este hook tenta a rede
 * (onde o service worker ja devolve o ultimo payload conhecido) e, se nao ha
 * nada, cai no pacote offline do POP.
 */

export interface AssetView {
  detail: AssetDetail | undefined
  /** 'offline' quando o conteudo saiu do pacote baixado. */
  source: 'live' | 'offline' | 'none'
  offlinePackage: PackageEntry | undefined
  loading: boolean
  error: Error | null
  refetch: () => void
}

export function useAssetView(id: string | undefined): AssetView {
  const live = useQuery({
    queryKey: ['asset', id ?? ''],
    queryFn: () => api.asset(id as string),
    enabled: Boolean(id),
    retry: false,
  })

  const offline = useQuery({
    queryKey: ['local', 'packaged-asset', id ?? ''],
    queryFn: () => packagedDetail(id as string),
    // So vale a leitura local quando a rede nao entregou.
    enabled: Boolean(id) && !live.data && !live.isPending,
    staleTime: 0,
  })

  const covering = useQuery({
    queryKey: ['local', 'package-covering', id ?? ''],
    queryFn: () => packageCovering(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  })

  if (live.data) {
    return {
      detail: live.data,
      source: 'live',
      offlinePackage: covering.data,
      loading: false,
      error: null,
      refetch: () => void live.refetch(),
    }
  }

  return {
    detail: offline.data,
    source: offline.data ? 'offline' : 'none',
    offlinePackage: covering.data,
    loading: live.isPending || offline.isPending,
    error: offline.data ? null : ((live.error as Error) ?? null),
    refetch: () => void live.refetch(),
  }
}

/** Filhos de um no para o drill-down; `null` significa as raizes da arvore. */
export function useChildren(parentId: string | null) {
  const live = useQuery({
    queryKey: parentId ? ['asset', parentId] : ['roots'],
    queryFn: () => (parentId ? api.asset(parentId).then((d) => d.children) : api.roots()),
    retry: false,
  })

  const offline = useQuery({
    queryKey: ['local', 'packaged-children', parentId ?? 'root'],
    queryFn: async () => (await packagedChildren(parentId)).map((entry) => entry.asset),
    enabled: !live.data && !live.isPending,
    staleTime: 0,
  })

  const items: Asset[] | undefined = live.data ?? offline.data
  return {
    items,
    source: live.data ? ('live' as const) : items?.length ? ('offline' as const) : ('none' as const),
    loading: live.isPending || offline.isPending,
  }
}
