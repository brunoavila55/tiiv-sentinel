import { useState } from 'react'
import type { Asset, KindConfig } from '../api/types'

/** Edicao dos campos estruturais do ativo (admin). */
export function AssetFields({
  asset,
  kinds,
  saving,
  onSave,
  onDelete,
}: {
  asset: Asset
  kinds: KindConfig[]
  saving: boolean
  onSave: (patch: Record<string, unknown>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(asset.name)
  const [kind, setKind] = useState(asset.kind)
  const [ip, setIp] = useState(asset.mgmt_ip ?? '')
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="asset-fields">
      <label>
        Nome
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Tipo
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>{k.label}</option>
          ))}
        </select>
      </label>
      <label>
        IP de gerencia
        <input value={ip} placeholder="10.0.0.1" onChange={(e) => setIp(e.target.value)} />
      </label>
      <div className="row-actions">
        {confirming ? (
          <>
            <span className="muted small">apagar este ativo?</span>
            <button className="ghost small" onClick={() => setConfirming(false)}>nao</button>
            <button className="danger small" onClick={onDelete}>sim, apagar</button>
          </>
        ) : (
          <button className="ghost small danger-text" onClick={() => setConfirming(true)}>
            apagar ativo
          </button>
        )}
        <button
          className="small"
          disabled={saving}
          onClick={() => onSave({ name, kind, mgmt_ip: ip.trim() === '' ? null : ip.trim() })}
        >
          {saving ? 'salvando…' : 'salvar'}
        </button>
      </div>
    </div>
  )
}
