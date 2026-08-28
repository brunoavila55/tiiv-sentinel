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

export interface AppConfig {
  kinds: KindConfig[]
  max_upload: number
  poll_interval: number
  poll_enabled: boolean
}

export interface User {
  id: string
  email: string
  role: 'admin' | 'viewer'
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
