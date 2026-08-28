import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Asset } from './types'

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  tree: ['tree'] as const,
  asset: (id: string) => ['asset', id] as const,
  search: (q: string) => ['search', q] as const,
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.me, retry: false, staleTime: 5 * 60_000 })
}

// As duas queries abaixo so disparam com sessao ativa: sem o gate elas batem
// 401 na tela de login e ficam em estado de erro depois que o usuario entra.
export function useConfig(enabled = true) {
  return useQuery({ queryKey: keys.config, queryFn: api.config, staleTime: Infinity, enabled })
}

export function useTree(enabled = true) {
  return useQuery({ queryKey: keys.tree, queryFn: () => api.tree(), staleTime: 30_000, enabled })
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: keys.asset(id ?? ''),
    queryFn: () => api.asset(id as string),
    enabled: Boolean(id),
  })
}

export function useSearch(term: string) {
  return useQuery({
    queryKey: keys.search(term),
    queryFn: () => api.search(term),
    enabled: term.trim().length > 0,
    staleTime: 10_000,
  })
}

export function useUpdateAsset(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.updateAsset(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.asset(id) })
      qc.invalidateQueries({ queryKey: keys.tree })
    },
  })
}

export function useCreateAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<Asset>) => api.createAsset(input),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: keys.tree })
      if (created.parent_id) qc.invalidateQueries({ queryKey: keys.asset(created.parent_id) })
    },
  })
}

export function useDeleteAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tree }),
  })
}

export function useMoveAsset() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) => api.moveAsset(id, parentId),
    onSuccess: (moved) => {
      qc.invalidateQueries({ queryKey: keys.tree })
      qc.invalidateQueries({ queryKey: keys.asset(moved.id) })
    },
  })
}

export function useDeleteAttachment(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.asset(assetId) }),
  })
}
