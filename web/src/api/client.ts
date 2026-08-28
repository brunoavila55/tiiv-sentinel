import type {
  AppConfig, Asset, AssetDetail, Attachment, AttachmentKind, AuditEntry, BulkInput, BulkResult,
  ImportResult, OfflinePackage, PresignResponse, SessionInfo, User,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? 'error', body?.message ?? `HTTP ${res.status}`)
  }
  return body as T
}

const json = (value: unknown) => JSON.stringify(value)

export const api = {
  me: () => request<{ user: User }>('/auth/me').then((r) => r.user),
  session: () => request<{ user: User; session: SessionInfo }>('/auth/me'),
  // Renovacao silenciosa da sessao longa: mesmo token, validade empurrada.
  refresh: () => request<{ user: User; session: SessionInfo }>('/auth/refresh', { method: 'POST' }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: json({ email, password }) }).then((r) => r.user),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),

  config: () => request<AppConfig>('/config'),

  users: () => request<{ items: User[] }>('/auth/users').then((r) => r.items),
  createUser: (email: string, password: string, role: 'admin' | 'viewer') =>
    request<User>('/auth/users', { method: 'POST', body: json({ email, password, role }) }),
  deleteUser: (id: string) => request<void>(`/auth/users/${id}`, { method: 'DELETE' }),
  setUserActive: (id: string, active: boolean) =>
    request<void>(`/auth/users/${id}/active`, { method: 'PATCH', body: json({ active }) }),
  resetUserPassword: (id: string, password: string) =>
    request<void>(`/auth/users/${id}/reset-password`, { method: 'POST', body: json({ password }) }),

  tree: (root?: string) =>
    request<{ items: Asset[] }>(`/assets/tree${root ? `?root=${root}` : ''}`).then((r) => r.items),
  asset: (id: string) => request<AssetDetail>(`/assets/${id}`),
  /** Raizes da arvore: primeiro nivel do drill-down mobile. */
  roots: () => request<{ items: Asset[] }>('/assets?parent_id=root').then((r) => r.items),
  search: (q: string) =>
    request<{ items: Asset[] }>(`/search?q=${encodeURIComponent(q)}`).then((r) => r.items),

  createAsset: (input: Partial<Asset>) =>
    request<Asset>('/assets', { method: 'POST', body: json(input) }),
  updateAsset: (id: string, patch: Record<string, unknown>) =>
    request<Asset>(`/assets/${id}`, { method: 'PATCH', body: json(patch) }),
  moveAsset: (id: string, parentId: string | null) =>
    request<Asset>(`/assets/${id}/parent`, { method: 'PATCH', body: json({ parent_id: parentId }) }),
  deleteAsset: (id: string, opts?: { reparentChildren?: boolean }) =>
    request<void>(`/assets/${id}${opts?.reparentChildren ? '?reparent_children=1' : ''}`, { method: 'DELETE' }),
  savePositions: (positions: { id: string; pos_x: number; pos_y: number }[]) =>
    request<{ updated: number }>('/assets/positions', { method: 'POST', body: json({ positions }) }),
  duplicateSubtree: (id: string, suffix: string) =>
    request<Asset>(`/assets/${id}/duplicate-subtree`, { method: 'POST', body: json({ suffix }) }),
  bulk: (input: BulkInput) =>
    request<{ results: BulkResult[] }>('/assets/bulk', { method: 'POST', body: json(input) }).then((r) => r.results),
  audit: (assetId: string) =>
    request<{ items: AuditEntry[] }>(`/assets/${assetId}/audit`).then((r) => r.items),
  importPreview: (csv: string) => request<ImportResult>('/assets/import/preview', { method: 'POST', body: json({ csv }) }),
  importCommit: (csv: string) => request<ImportResult>('/assets/import/commit', { method: 'POST', body: json({ csv }) }),

  presign: (assetId: string, input: { filename: string; mime_type: string; kind: AttachmentKind; size_bytes: number }) =>
    request<PresignResponse>(`/assets/${assetId}/attachments/presign`, { method: 'POST', body: json(input) }),
  confirmUpload: (assetId: string, input: Record<string, unknown>) =>
    request<Attachment>(`/assets/${assetId}/attachments`, { method: 'POST', body: json(input) }),
  attachmentUrl: (id: string, download = false) =>
    request<{ url: string; expires_at: string }>(`/attachments/${id}/url${download ? '?download=1' : ''}`),
  deleteAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: 'DELETE' }),
  renameAttachment: (id: string, filename: string) =>
    request<void>(`/attachments/${id}`, { method: 'PATCH', body: json({ filename }) }),
  reorderAttachments: (assetId: string, orderedIds: string[]) =>
    request<{ updated: number }>(`/assets/${assetId}/attachments/reorder`, {
      method: 'POST', body: json({ ordered_ids: orderedIds }),
    }),

  // Abaixo, o que a PWA de campo acrescentou. Nenhum contrato acima mudou.
  favorites: () => request<{ items: Asset[] }>('/favorites').then((r) => r.items),
  addFavorite: (assetId: string) => request<void>(`/favorites/${assetId}`, { method: 'PUT' }),
  removeFavorite: (assetId: string) => request<void>(`/favorites/${assetId}`, { method: 'DELETE' }),
  offlinePackage: (rootId: string) => request<OfflinePackage>(`/assets/${rootId}/package`),
}
