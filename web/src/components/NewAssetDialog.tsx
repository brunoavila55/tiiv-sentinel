import { useState } from 'react'
import { useCreateAsset } from '../api/hooks'
import type { KindConfig } from '../api/types'
import { ApiError } from '../api/client'

export function NewAssetDialog({
  kinds,
  parentId,
  parentName,
  onClose,
  onCreated,
}: {
  kinds: KindConfig[]
  parentId: string | null
  parentName?: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState(kinds[0]?.id ?? 'pop')
  const [ip, setIp] = useState('')
  const [asRoot, setAsRoot] = useState(!parentId)
  const create = useCreateAsset()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const created = await create.mutateAsync({
        name,
        kind,
        mgmt_ip: ip.trim() ? ip.trim() : null,
        parent_id: asRoot ? null : parentId,
      })
      onCreated(created.id)
    } catch {
      /* erro exibido abaixo */
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Novo ativo</h2>
        <label>
          Nome
          <input value={name} autoFocus required onChange={(e) => setName(e.target.value)} />
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
        {parentId && (
          <label className="check">
            <input type="checkbox" checked={asRoot} onChange={(e) => setAsRoot(e.target.checked)} />
            criar na raiz (em vez de dentro de {parentName ?? 'ativo selecionado'})
          </label>
        )}
        {create.isError && (
          <div className="error">
            {create.error instanceof ApiError ? create.error.message : 'falha ao criar'}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>cancelar</button>
          <button type="submit" disabled={create.isPending}>criar</button>
        </div>
      </form>
    </div>
  )
}
