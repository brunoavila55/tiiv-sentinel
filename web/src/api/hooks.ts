import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { Asset, BulkInput } from './types'

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  tree: ['tree'] as const,
  asset: (id: string) => ['asset', id] as const,
  search: (q: string) => ['search', q] as const,
  audit: (id: string) => ['audit', id] as const,
  users: ['users'] as const,
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
    mutationFn: ({ id, reparentChildren }: { id: string; reparentChildren?: boolean }) =>
      api.deleteAsset(id, { reparentChildren }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tree }),
  })
}

export function useDuplicateSubtree() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, suffix }: { id: string; suffix: string }) => api.duplicateSubtree(id, suffix),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tree }),
  })
}

export function useBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BulkInput) => api.bulk(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tree }),
  })
}

export function useAudit(assetId: string | undefined) {
  return useQuery({
    queryKey: keys.audit(assetId ?? ''),
    queryFn: () => api.audit(assetId as string),
    enabled: Boolean(assetId),
  })
}

export function useRenameAttachment(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) => api.renameAttachment(id, filename),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.asset(assetId) }),
  })
}

export function useReorderAttachments(assetId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderedIds: string[]) => api.reorderAttachments(assetId, orderedIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.asset(assetId) }),
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
