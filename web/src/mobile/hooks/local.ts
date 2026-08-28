import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Asset } from '../../api/types'
import { listFavorites, markFavorite } from '../db/favorites'
import { listPackages, removePackage } from '../db/packages'
import { listQueue, retryUpload, dequeue } from '../db/queue'
import { listRecents } from '../db/recents'
import { onSyncChange, requestBackgroundSync, runSync } from '../lib/sync'

/** Estado local (IndexedDB) exposto com as mesmas ferramentas do estado de servidor. */

export const localKeys = {
  recents: ['local', 'recents'] as const,
  favorites: ['local', 'favorites'] as const,
  queue: ['local', 'queue'] as const,
  packages: ['local', 'packages'] as const,
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export function useRecents() {
  return useQuery({ queryKey: localKeys.recents, queryFn: listRecents, staleTime: 0 })
}

export function useFavorites() {
  return useQuery({ queryKey: localKeys.favorites, queryFn: listFavorites, staleTime: 0 })
}

export function useUploadQueue() {
  const qc = useQueryClient()
  // A fila muda por fora do React (sync em background); reagimos ao evento.
  useEffect(
    () =>
      onSyncChange((assetId) => {
        void qc.invalidateQueries({ queryKey: localKeys.queue })
        if (assetId) void qc.invalidateQueries({ queryKey: ['asset', assetId] })
      }),
    [qc],
  )
  return useQuery({ queryKey: localKeys.queue, queryFn: listQueue, staleTime: 0 })
}

export function usePackages() {
  return useQuery({ queryKey: localKeys.packages, queryFn: listPackages, staleTime: 0 })
}

/**
 * Favoritar e local-first: grava no aparelho, atualiza a tela na hora e so
 * entao tenta o servidor. Sem rede, a operacao fica pendente na fila.
 */
export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ asset, favorite }: { asset: Asset; favorite: boolean }) => {
      await markFavorite(asset, favorite)
      void runSync()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: localKeys.favorites }),
  })
}

export function useRetryUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await retryUpload(id)
      await requestBackgroundSync()
      await runSync()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: localKeys.queue }),
  })
}

export function useDiscardUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => dequeue(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: localKeys.queue }),
  })
}

export function useRemovePackage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rootId: string) => removePackage(rootId),
    onSuccess: () => qc.invalidateQueries({ queryKey: localKeys.packages }),
  })
}
