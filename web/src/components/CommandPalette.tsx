import { useEffect, useMemo, useState } from 'react'
import { useSearch } from '../api/hooks'
import { KindIcon } from './KindIcon'
import { StatusDot } from './StatusDot'

/**
 * Busca global do Ctrl+K: teclado do comeco ao fim. Buscar por IP exato traz o
 * ativo em primeiro lugar (ordenacao vem do backend).
 */
export function CommandPalette({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const [term, setTerm] = useState('')
  const [cursor, setCursor] = useState(0)
  const { data, isFetching } = useSearch(term)
  const results = useMemo(() => data ?? [], [data])

  useEffect(() => setCursor(0), [term])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((c) => Math.min(c + 1, Math.max(results.length - 1, 0)))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      }
      if (event.key === 'Enter' && results[cursor]) {
        event.preventDefault()
        onSelect(results[cursor].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [results, cursor, onSelect])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={term}
          placeholder="nome, IP ou descricao…"
          onChange={(e) => setTerm(e.target.value)}
        />
        <ul>
          {results.map((asset, index) => (
            <li
              key={asset.id}
              className={index === cursor ? 'active' : ''}
              onMouseEnter={() => setCursor(index)}
              onClick={() => onSelect(asset.id)}
            >
              <KindIcon kind={asset.kind} />
              <span className="palette-name">{asset.name}</span>
              {asset.mgmt_ip && <code>{asset.mgmt_ip}</code>}
              <StatusDot asset={asset} />
            </li>
          ))}
          {term && !isFetching && results.length === 0 && (
            <li className="muted">nada encontrado para “{term}”</li>
          )}
        </ul>
        <footer className="muted small">
          <kbd>↑</kbd><kbd>↓</kbd> navegar · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar
        </footer>
      </div>
    </div>
  )
}
