import { useMemo, useState } from 'react'
import { useBulk } from '../api/hooks'
import type { Asset, BulkOp, BulkResult, KindConfig } from '../api/types'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Selecionar 30 ativos na arvore (Ctrl/Shift) e mudar todos de uma vez. Cada
 * item e independente: uma falha nao aborta o lote, e o operador ve
 * exatamente qual id falhou e por que.
 */
export function BulkToolbar({
  ids,
  kinds,
  allAssets,
  onClear,
  onDone,
}: {
  ids: string[]
  kinds: KindConfig[]
  allAssets: Asset[]
  onClear: () => void
  onDone: () => void
}) {
  const bulk = useBulk()
  const [results, setResults] = useState<BulkResult[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [attrKey, setAttrKey] = useState('')
  const [attrValue, setAttrValue] = useState('')
  const [parentOpen, setParentOpen] = useState(false)
  const [parentQuery, setParentQuery] = useState('')

  const parentMatches = useMemo(() => {
    const q = parentQuery.trim().toLowerCase()
    const list = allAssets.filter((a) => !ids.includes(a.id))
    return (q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list).slice(0, 30)
  }, [allAssets, parentQuery, ids])

  const run = (op: BulkOp, extra: Record<string, unknown> = {}) => {
    setResults(null)
    bulk.mutate({ ids, op, ...extra }, { onSuccess: (r) => { setResults(r); onDone() } })
  }

  const failures = results?.filter((r) => !r.ok) ?? []

  return (
    <div className="bulk-toolbar">
      <span>{ids.length} selecionado(s)</span>

      <select
        defaultValue=""
        onChange={(e) => { if (e.target.value) { run('set_kind', { kind: e.target.value }); e.target.value = '' } }}
      >
        <option value="" disabled>mudar tipo…</option>
        {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>

      <span className="bulk-parent">
        <button type="button" className="ghost small" onClick={() => setParentOpen((v) => !v)}>mudar pai…</button>
        {parentOpen && (
          <div className="parent-picker-list bulk-parent-list">
            <input
              autoFocus
              placeholder="buscar ativo…"
              value={parentQuery}
              onChange={(e) => setParentQuery(e.target.value)}
            />
            <ul>
              <li onMouseDown={() => { setParentOpen(false); run('set_parent', { parent_id: null }) }}>raiz (sem pai)</li>
              {parentMatches.map((a) => (
                <li key={a.id} onMouseDown={() => { setParentOpen(false); run('set_parent', { parent_id: a.id }) }}>
                  {a.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </span>

      <span className="bulk-attr">
        <input placeholder="chave" value={attrKey} onChange={(e) => setAttrKey(e.target.value)} />
        <input placeholder="valor" value={attrValue} onChange={(e) => setAttrValue(e.target.value)} />
        <button
          type="button"
          className="ghost small"
          disabled={!attrKey.trim()}
          onClick={() => run('add_attr', { attr_key: attrKey.trim(), attr_value: attrValue })}
        >
          adicionar atributo
        </button>
      </span>

      <button type="button" className="ghost small danger-text" onClick={() => setConfirmDelete(true)}>
        excluir
      </button>
      <button type="button" className="ghost small" onClick={onClear}>cancelar seleção</button>

      {bulk.isPending && <span className="muted small">aplicando…</span>}
      {failures.length > 0 && (
        <div className="bulk-errors">
          <strong>{failures.length} falharam:</strong>
          <ul>
            {failures.map((f) => <li key={f.id} className="error small">{f.id.slice(0, 8)}: {f.error}</li>)}
          </ul>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Excluir em lote"
          message={`Excluir ${ids.length} ativo(s)? Itens com filhos vão falhar individualmente (sem exclusão em cascata) — o resultado mostra quais.`}
          confirmLabel="excluir selecionados"
          danger
          busy={bulk.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); run('delete') }}
        />
      )}
    </div>
  )
}
