import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'

/** Descricao em markdown, editavel inline e salva sem recarregar a pagina. */
export function MarkdownField({
  value,
  canEdit,
  saving,
  onSave,
}: {
  value: string | null
  canEdit: boolean
  saving: boolean
  onSave: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  useEffect(() => setDraft(value ?? ''), [value])

  if (editing) {
    return (
      <div className="markdown-edit">
        <textarea value={draft} rows={8} autoFocus onChange={(e) => setDraft(e.target.value)} />
        <div className="row-actions">
          <button className="ghost" onClick={() => { setDraft(value ?? ''); setEditing(false) }}>
            cancelar
          </button>
          <button
            disabled={saving}
            onClick={() => {
              onSave(draft.trim() === '' ? null : draft)
              setEditing(false)
            }}
          >
            {saving ? 'salvando…' : 'salvar'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="markdown-view">
      {value ? <Markdown>{value}</Markdown> : <p className="muted">sem descrição</p>}
      {canEdit && (
        <button className="ghost small" onClick={() => setEditing(true)}>editar</button>
      )}
    </div>
  )
}
