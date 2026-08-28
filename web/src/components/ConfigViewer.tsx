import { useEffect, useState } from 'react'
import type { Attachment } from '../api/types'
import { api } from '../api/client'
import { formatBytes, formatDate } from '../lib/format'
import { CopyButton } from './CopyButton'

/**
 * Config em .txt abre na tela, nao baixa: o tecnico quer ler a linha da
 * interface, nao gerenciar arquivo.
 */
export function ConfigViewer({
  configs,
  canDelete,
  onDelete,
}: {
  configs: Attachment[]
  canDelete: boolean
  onDelete: (id: string) => void
}) {
  const [selected, setSelected] = useState<Attachment | null>(configs[0] ?? null)
  const [text, setText] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!configs.some((c) => c.id === selected?.id)) setSelected(configs[0] ?? null)
  }, [configs, selected])

  useEffect(() => {
    if (!selected?.url) {
      setText('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(selected.url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => !cancelled && setText(body))
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [selected])

  if (configs.length === 0) return <p className="muted">nenhuma configuracao salva</p>

  return (
    <div className="configs">
      <ul className="config-list">
        {configs.map((config) => (
          <li key={config.id} className={config.id === selected?.id ? 'active' : ''}>
            <button className="link" onClick={() => setSelected(config)}>{config.filename}</button>
            <span className="muted small">
              {formatDate(config.created_at)} · {formatBytes(config.size_bytes)}
            </span>
            {config.sha256 && (
              <code className="sha" title={`sha256 ${config.sha256}`}>{config.sha256.slice(0, 8)}</code>
            )}
            {canDelete && (
              <button className="ghost small" title="remover" onClick={() => onDelete(config.id)}>×</button>
            )}
          </li>
        ))}
      </ul>

      {selected && (
        <div className="config-view">
          <div className="row-actions">
            <CopyButton value={text} label="copiar tudo" className="ghost small" />
            <button
              className="ghost small"
              onClick={async () => {
                const { url } = await api.attachmentUrl(selected.id, true)
                window.location.href = url
              }}
            >
              baixar
            </button>
          </div>
          {loading && <p className="muted">carregando…</p>}
          {error && <p className="error">falha ao ler o arquivo: {error}</p>}
          {!loading && !error && <pre className="config-text">{text}</pre>}
        </div>
      )}
    </div>
  )
}
