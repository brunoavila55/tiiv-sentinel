export type Status = 'up' | 'down' | 'unknown'
export type AttachmentKind = 'photo' | 'config' | 'document'

export interface Asset {
  id: string
  parent_id: string | null
  name: string
  kind: string
  description: string | null
  mgmt_ip: string | null
  attrs: Record<string, unknown>
  status: Status
  status_at: string | null
  /** Ancestral down: o ativo e sintoma, nao causa. UI atenua em vez de alarmar. */
  suppressed: boolean
  pos_x: number | null
  pos_y: number | null
  cover_attachment_id: string | null
  child_count: number
  depth: number
  created_at: string
  updated_at: string
}

export interface Attachment {
  id: string
  asset_id: string
  kind: AttachmentKind
  object_key: string
  thumb_key: string | null
  filename: string
  mime_type: string
  size_bytes: number
  sha256: string | null
  sort_order: number
  captured_at: string | null
  created_at: string
  url?: string
  thumb_url?: string
}

export interface AssetDetail {
  asset: Asset
  breadcrumb: Asset[]
  children: Asset[]
  attachments: Attachment[]
  descendant_count: number
}

export interface AuditEntry {
  id: string
  asset_id: string
  asset_name: string
  user_id: string | null
  user_email: string
  action: 'create' | 'update' | 'move' | 'delete'
  changes: Record<string, { from: unknown; to: unknown } | unknown>
  created_at: string
}

export type BulkOp = 'set_kind' | 'set_parent' | 'add_attr' | 'delete'

export interface BulkInput {
  ids: string[]
  op: BulkOp
  kind?: string
  parent_id?: string | null
  attr_key?: string
  attr_value?: unknown
}

export interface BulkResult {
  id: string
  ok: boolean
  error?: string
}

export type ImportRowStatus = 'ok' | 'exists' | 'error'

export interface ImportRow {
  line: number
  name: string
  kind: string
  parent_name: string
  mgmt_ip: string
  description: string
  status: ImportRowStatus
  error?: string
  existing_id?: string
}

export interface ImportResult {
  rows: ImportRow[]
  total: number
  ok_count: number
  exists_count: number
  error_count: number
  committed: boolean
}

export interface KindAction {
  id: string
  label: string
  template: string
  when_attr?: { key: string; value: string }
}

export interface KindConfig {
  id: string
  label: string
  icon: string
  color: string
  actions: KindAction[]
}

export interface TemplateField {
  key: string
  type: 'string' | 'number' | 'boolean'
  default: unknown
}

export interface AppConfig {
  kinds: KindConfig[]
  kind_templates: Record<string, TemplateField[]>
  max_upload: number
  poll_interval: number
  poll_enabled: boolean
}

export interface User {
  id: string
  email: string
  role: 'admin' | 'viewer'
  active: boolean
  created_at: string
}

export interface PresignResponse {
  upload_url: string
  object_key: string
  expires_at: string
  max_bytes: number
}

/** Validade da sessao. A PWA renova em background e avisa antes de vencer. */
export interface SessionInfo {
  expires_at: string
}

/**
 * Pacote offline de POP: o subtree inteiro numa ida so. O cliente baixa os
 * thumbnails e o texto das configs; foto em resolucao original fica de fora.
 */
export interface OfflinePackage {
  root: Asset
  generated_at: string
  assets: Asset[]
  attachments: Attachment[]
  estimated_bytes: number
}
