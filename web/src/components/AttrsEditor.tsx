import { useEffect, useState } from 'react'
import { attrsToRows, duplicateKeys, rowsToAttrs } from '../lib/attrs'

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
    setRows(attrsToRows(attrs))
    setDirty(false)
  }, [attrs])

  const dupes = duplicateKeys(rows)

  const update = (index: number, key: string, value: string) => {
    setRows((current) => current.map((row, i) => (i === index ? [key, value] : row)))
    setDirty(true)
  }

  const commit = () => {
    if (dupes.length > 0) return
    onSave(rowsToAttrs(rows))
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
                  <input
                    value={key}
                    className={dupes.includes(key.trim().toLowerCase()) ? 'invalid' : ''}
                    onChange={(e) => update(index, e.target.value, value)}
                  />
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
      {canEdit && dupes.length > 0 && (
        <p className="error small">chave repetida: {dupes.join(', ')}</p>
      )}
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
          <button className="small" disabled={!dirty || saving || dupes.length > 0} onClick={commit}>
            {saving ? 'salvando…' : 'salvar atributos'}
          </button>
        </div>
      )}
    </div>
  )
}
