import { useEffect, useState } from 'react'

type Attrs = Record<string, unknown>

/**
 * attrs em tabela chave/valor. E aqui que cabem porta PON, SSID, vendor — sem
 * criar coluna nova para cada tipo de equipamento.
 */
export function AttrsEditor({
  attrs,
  canEdit,
  saving,
  onSave,
}: {
  attrs: Attrs
  canEdit: boolean
  saving: boolean
  onSave: (next: Attrs) => void
}) {
  const [rows, setRows] = useState<[string, string][]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setRows(Object.entries(attrs ?? {}).map(([k, v]) => [k, stringify(v)]))
    setDirty(false)
  }, [attrs])

  const update = (index: number, key: string, value: string) => {
    setRows((current) => current.map((row, i) => (i === index ? [key, value] : row)))
    setDirty(true)
  }

  const commit = () => {
    const next: Attrs = {}
    for (const [key, value] of rows) {
      const name = key.trim()
      if (!name) continue
      next[name] = parse(value)
    }
    onSave(next)
    setDirty(false)
  }

  return (
    <div className="attrs">
      <table>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={3} className="muted">nenhum atributo</td></tr>
          )}
          {rows.map(([key, value], index) => (
            <tr key={`${index}-${key}`}>
              <td>
                {canEdit ? (
                  <input value={key} onChange={(e) => update(index, e.target.value, value)} />
                ) : (
                  <span className="attr-key">{key}</span>
                )}
              </td>
              <td>
                {canEdit ? (
                  <input value={value} onChange={(e) => update(index, key, e.target.value)} />
                ) : (
                  <span>{value}</span>
                )}
              </td>
              {canEdit && (
                <td className="shrink">
                  <button
                    className="ghost small"
                    title="remover"
                    onClick={() => {
                      setRows((current) => current.filter((_, i) => i !== index))
                      setDirty(true)
                    }}
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <div className="row-actions">
          <button
            className="ghost small"
            onClick={() => {
              setRows((current) => [...current, ['', '']])
              setDirty(true)
            }}
          >
            + atributo
          </button>
          <button className="small" disabled={!dirty || saving} onClick={commit}>
            {saving ? 'salvando…' : 'salvar atributos'}
          </button>
        </div>
      )}
    </div>
  )
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Preserva numero e booleano; o resto fica string. */
function parse(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}
