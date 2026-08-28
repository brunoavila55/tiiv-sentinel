import { useEffect, useMemo, useRef, useState } from 'react'
import { useCreateAsset, useMoveAsset, useUpdateAsset } from '../api/hooks'
import { ApiError } from '../api/client'
import type { Asset, KindConfig, TemplateField } from '../api/types'
import { type AttrRow, attrsToRows, duplicateKeys, rowsToAttrs, stringifyAttrValue } from '../lib/attrs'
import { KindIcon } from './KindIcon'
import { ConfirmDialog } from './ConfirmDialog'

type Mode = 'create' | 'edit'

/**
 * Drawer unico para criar e editar. O 90% do uso e "adicionar filho aqui" a
 * partir de um no da arvore ou do painel de detalhe: por isso o pai vem
 * pre-preenchido e "salvar e criar outro" mantem pai e tipo entre um cadastro
 * e o proximo — cadastrar um POP inteiro nao pode virar escolher o pai a cada
 * ativo.
 */
export function AssetDrawer({
  mode,
  asset,
  duplicateFrom,
  defaultParentId = null,
  defaultKind,
  defaultName,
  descendantCount = 0,
  kinds,
  templates,
  allAssets,
  onClose,
  onSaved,
}: {
  mode: Mode
  asset?: Asset
  duplicateFrom?: Asset
  defaultParentId?: string | null
  defaultKind?: string
  defaultName?: string
  descendantCount?: number
  kinds: KindConfig[]
  templates: Record<string, TemplateField[]>
  allAssets: Asset[]
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const seed = asset ?? duplicateFrom
  const [name, setName] = useState(asset ? asset.name : defaultName ?? '')
  const [kind, setKind] = useState(seed?.kind ?? defaultKind ?? kinds[0]?.id ?? '')
  const [parentId, setParentId] = useState<string | null>(seed?.parent_id ?? defaultParentId)
  const [ip, setIp] = useState(asset?.mgmt_ip ?? '')
  const [description, setDescription] = useState(seed?.description ?? '')
  const [rows, setRows] = useState<AttrRow[]>(attrsToRows(seed?.attrs))
  const [saveAndNew, setSaveAndNew] = useState(false)
  const [parentQuery, setParentQuery] = useState('')
  const [parentOpen, setParentOpen] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const lastAppliedTemplate = useRef<string | null>(null)

  const create = useCreateAsset()
  const update = useUpdateAsset(asset?.id ?? '')
  const move = useMoveAsset()
  const saving = create.isPending || update.isPending || move.isPending

  // Ids do proprio ativo + descendentes: nao pode virar pai de si mesmo.
  const blockedParentIds = useMemo(() => {
    if (!asset) return new Set<string>()
    const blocked = new Set<string>([asset.id])
    let grew = true
    while (grew) {
      grew = false
      for (const a of allAssets) {
        if (a.parent_id && blocked.has(a.parent_id) && !blocked.has(a.id)) {
          blocked.add(a.id)
          grew = true
        }
      }
    }
    return blocked
  }, [asset, allAssets])

  const parentName = (id: string | null) => (id ? allAssets.find((a) => a.id === id)?.name ?? '?' : 'raiz (sem pai)')

  const parentMatches = useMemo(() => {
    const q = parentQuery.trim().toLowerCase()
    const list = allAssets.filter((a) => !blockedParentIds.has(a.id))
    const filtered = q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list
    return filtered.slice(0, 30)
  }, [allAssets, parentQuery, blockedParentIds])

  // Trocar o tipo sugere o template daquele kind, sem apagar valor ja
  // preenchido — so entra chave que ainda nao existe.
  useEffect(() => {
    if (lastAppliedTemplate.current === kind) return
    lastAppliedTemplate.current = kind
    const fields = templates[kind]
    if (!fields || fields.length === 0) return
    setRows((current) => {
      const existing = new Set(current.map(([k]) => k.trim().toLowerCase()))
      const additions: AttrRow[] = fields
        .filter((f) => !existing.has(f.key.toLowerCase()))
        .map((f) => [f.key, stringifyAttrValue(f.default)])
      return additions.length > 0 ? [...current, ...additions] : current
    })
  }, [kind, templates])

  const dupes = duplicateKeys(rows)

  const resetForNext = () => {
    setName('')
    setIp('')
    setDescription('')
    const fields = templates[kind] ?? []
    setRows(fields.map((f) => [f.key, stringifyAttrValue(f.default)] as AttrRow))
    setFieldErrors({})
    setFormError(null)
    window.setTimeout(() => nameRef.current?.focus(), 0)
  }

  const applyError = (err: unknown) => {
    if (err instanceof ApiError) {
      const map: Record<string, string> = {
        invalid_name: 'name', invalid_kind: 'kind', invalid_ip: 'mgmt_ip',
        parent_not_found: 'parent', cycle: 'parent',
      }
      const field = map[err.code]
      if (field) {
        setFieldErrors({ [field]: err.message })
        return
      }
      setFormError(err.message)
      return
    }
    setFormError('falha inesperada ao salvar')
  }

  const doSave = async () => {
    setFieldErrors({})
    setFormError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFieldErrors({ name: 'nome e obrigatorio' })
      return
    }
    if (dupes.length > 0) {
      setFormError('ha chaves de atributo repetidas')
      return
    }
    const attrs = rowsToAttrs(rows)
    try {
      if (mode === 'create') {
        const created = await create.mutateAsync({
          name: trimmedName, kind, parent_id: parentId,
          mgmt_ip: ip.trim() || null, description: description.trim() || null, attrs,
        })
        if (saveAndNew) {
          resetForNext()
        } else {
          onSaved(created.id)
        }
        return
      }
      if (!asset) return
      const updated = await update.mutateAsync({
        name: trimmedName, kind, mgmt_ip: ip.trim() || null, description: description.trim() || null, attrs,
      })
      if (parentId !== (asset.parent_id ?? null)) {
        await move.mutateAsync({ id: updated.id, parentId })
      }
      onSaved(updated.id)
    } catch (err) {
      applyError(err)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parentChanged = mode === 'edit' && asset && parentId !== (asset.parent_id ?? null)
    if (parentChanged && descendantCount > 0) {
      setPendingMove(true)
      return
    }
    void doSave()
  }

  return (
    <>
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal drawer" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{mode === 'create' ? (duplicateFrom ? 'Duplicar ativo' : 'Novo ativo') : 'Editar ativo'}</h2>

        <label>
          Nome
          <input
            ref={nameRef}
            value={name}
            autoFocus
            required
            className={fieldErrors.name ? 'invalid' : ''}
            onChange={(e) => setName(e.target.value)}
          />
          {fieldErrors.name && <span className="error small">{fieldErrors.name}</span>}
        </label>

        <label>
          Tipo
          <select value={kind} className={fieldErrors.kind ? 'invalid' : ''} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </label>

        <label className="parent-picker">
          Pai
          <div className="parent-picker-input">
            <input
              value={parentOpen ? parentQuery : parentName(parentId)}
              placeholder="buscar ativo pelo nome…"
              className={fieldErrors.parent ? 'invalid' : ''}
              onFocus={() => { setParentOpen(true); setParentQuery('') }}
              onChange={(e) => setParentQuery(e.target.value)}
              onBlur={() => window.setTimeout(() => setParentOpen(false), 150)}
            />
            {parentOpen && (
              <ul className="parent-picker-list">
                <li onMouseDown={() => { setParentId(null); setParentOpen(false) }}>raiz (sem pai)</li>
                {parentMatches.map((a) => (
                  <li key={a.id} onMouseDown={() => { setParentId(a.id); setParentOpen(false) }}>
                    <KindIcon kind={a.kind} />
                    <span>{a.name}</span>
                  </li>
                ))}
                {parentMatches.length === 0 && <li className="muted">nenhum ativo encontrado</li>}
              </ul>
            )}
          </div>
          {fieldErrors.parent && <span className="error small">{fieldErrors.parent}</span>}
        </label>

        <label>
          IP de gerência
          <input
            value={ip}
            placeholder="10.0.0.1"
            className={fieldErrors.mgmt_ip ? 'invalid' : ''}
            onChange={(e) => setIp(e.target.value)}
          />
          {fieldErrors.mgmt_ip && <span className="error small">{fieldErrors.mgmt_ip}</span>}
        </label>

        <label>
          Descrição
          <textarea value={description} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="attrs-block">
          <span className="attrs-block-label">Atributos</span>
          <table>
            <tbody>
              {rows.map(([key, value], index) => (
                <tr key={index}>
                  <td>
                    <input
                      value={key}
                      className={dupes.includes(key.trim().toLowerCase()) ? 'invalid' : ''}
                      onChange={(e) =>
                        setRows((c) => c.map((r, i) => (i === index ? [e.target.value, value] : r)))
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={value}
                      onChange={(e) =>
                        setRows((c) => c.map((r, i) => (i === index ? [key, e.target.value] : r)))
                      }
                    />
                  </td>
                  <td className="shrink">
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => setRows((c) => c.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="ghost small" onClick={() => setRows((c) => [...c, ['', '']])}>
            + atributo
          </button>
          {dupes.length > 0 && <p className="error small">chave repetida: {dupes.join(', ')}</p>}
        </div>

        {formError && <div className="error">{formError}</div>}

        <div className="modal-actions">
          {mode === 'create' && (
            <label className="check save-and-new">
              <input type="checkbox" checked={saveAndNew} onChange={(e) => setSaveAndNew(e.target.checked)} />
              salvar e criar outro
            </label>
          )}
          <button type="button" className="ghost" onClick={onClose}>cancelar</button>
          <button type="submit" disabled={saving}>
            {saving ? 'salvando…' : mode === 'create' ? 'criar' : 'salvar'}
          </button>
        </div>
      </form>
    </div>

    {pendingMove && (
      <ConfirmDialog
        title="Mover ativo com descendentes"
        message={`Este ativo tem ${descendantCount} descendente(s), que vao junto com ele. Confirmar a mudanca de pai?`}
        confirmLabel="mover e salvar"
        busy={saving}
        onCancel={() => setPendingMove(false)}
        onConfirm={() => { setPendingMove(false); void doSave() }}
      />
    )}
    </>
  )
}
