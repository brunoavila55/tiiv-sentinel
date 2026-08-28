import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'

/**
 * Clicar no valor vira campo, Enter salva, Esc cancela. Salvamento otimista:
 * o novo valor aparece na hora, e volta ao anterior sozinho se o servidor
 * recusar — sem isso, corrigir um IP errado exige esperar um round-trip so
 * para descobrir se colou.
 */
export function InlineField({
  value,
  placeholder,
  canEdit,
  onSave,
  render,
}: {
  value: string
  placeholder?: string
  canEdit: boolean
  onSave: (next: string) => Promise<void>
  render?: (value: string) => React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [optimistic, setOptimistic] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOptimistic(null)
    setError(null)
  }, [value])

  const shown = optimistic ?? value

  if (!canEdit) return <>{render ? render(shown) : shown || placeholder}</>

  if (!editing) {
    return (
      <span className="inline-field">
        <span
          className="inline-editable"
          tabIndex={0}
          title="clique para editar"
          onClick={() => { setDraft(shown); setEditing(true) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { setDraft(shown); setEditing(true) } }}
        >
          {render ? render(shown) : shown || <span className="muted">{placeholder}</span>}
        </span>
        {error && <span className="error small">{error}</span>}
      </span>
    )
  }

  const commit = () => {
    const next = draft
    setEditing(false)
    setOptimistic(next)
    setError(null)
    onSave(next).catch((err: unknown) => {
      setOptimistic(null)
      setError(err instanceof ApiError ? err.message : 'falha ao salvar')
    })
  }

  return (
    <input
      className="inline-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
      }}
    />
  )
}
