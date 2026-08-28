import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { ImportResult } from '../api/types'
import { keys } from '../api/hooks'

const TEMPLATE = 'name,kind,parent_name,mgmt_ip,description\n'

/**
 * Import em duas etapas: preview mostra linha a linha o que vai acontecer
 * antes de qualquer escrita, commit e transacional — ou entra tudo, ou nada.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const qc = useQueryClient()

  const previewMut = useMutation({
    mutationFn: (text: string) => api.importPreview(text),
    onSuccess: (r) => setPreview(r),
  })
  const commitMut = useMutation({
    mutationFn: (text: string) => api.importCommit(text),
    onSuccess: (r) => {
      setResult(r)
      if (r.committed) qc.invalidateQueries({ queryKey: keys.tree })
    },
  })

  const onFile = async (file: File) => {
    const text = await file.text()
    setCsv(text)
    setPreview(null)
    setResult(null)
  }

  const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'falha inesperada')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Importar CSV</h2>

        {!result && (
          <>
            <p className="muted small">
              Colunas: <code>name, kind, parent_name, mgmt_ip, description</code>. O pai e resolvido
              pelo nome — deixe <code>parent_name</code> vazio para criar na raiz.
            </p>
            <div className="row-actions">
              <button type="button" className="ghost small" onClick={() => fileRef.current?.click()}>
                escolher arquivo .csv
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
              />
              <button
                type="button"
                className="link small"
                onClick={() => setCsv((c) => (c.trim() ? c : TEMPLATE))}
              >
                começar do zero
              </button>
            </div>
            <textarea
              className="import-textarea"
              rows={10}
              value={csv}
              placeholder={TEMPLATE + 'POP Centro,pop,,,\nRouter-01,router,POP Centro,10.0.0.1,'}
              onChange={(e) => { setCsv(e.target.value); setPreview(null) }}
            />

            {previewMut.isError && <p className="error">{errorMessage(previewMut.error)}</p>}

            {!preview && (
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={onClose}>cancelar</button>
                <button
                  type="button"
                  disabled={!csv.trim() || previewMut.isPending}
                  onClick={() => previewMut.mutate(csv)}
                >
                  {previewMut.isPending ? 'validando…' : 'validar'}
                </button>
              </div>
            )}

            {preview && (
              <>
                <ImportSummary result={preview} />
                <div className="import-rows">
                  <table>
                    <thead>
                      <tr><th>linha</th><th>nome</th><th>tipo</th><th>pai</th><th>status</th></tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.line} className={`import-row-${row.status}`}>
                          <td>{row.line}</td>
                          <td>{row.name}</td>
                          <td>{row.kind}</td>
                          <td>{row.parent_name || 'raiz'}</td>
                          <td>{row.status === 'error' ? row.error : row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {commitMut.isError && <p className="error">{errorMessage(commitMut.error)}</p>}
                <div className="modal-actions">
                  <button type="button" className="ghost" onClick={() => setPreview(null)}>voltar</button>
                  <button
                    type="button"
                    disabled={preview.error_count > 0 || commitMut.isPending}
                    onClick={() => commitMut.mutate(csv)}
                  >
                    {commitMut.isPending
                      ? 'importando…'
                      : preview.error_count > 0
                        ? 'corrija os erros antes de importar'
                        : `confirmar importação (${preview.ok_count} novo(s))`}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {result && (
          <>
            <ImportSummary result={result} />
            {!result.committed && (
              <p className="error">
                nada foi importado: corrija as linhas com erro e refaça o preview.
              </p>
            )}
            <div className="modal-actions">
              {!result.committed ? (
                <button type="button" className="ghost" onClick={() => setResult(null)}>voltar ao CSV</button>
              ) : null}
              <button type="button" onClick={onClose}>fechar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ImportSummary({ result }: { result: ImportResult }) {
  return (
    <p className="import-summary">
      <span>{result.total} linha(s)</span>
      <span className="ok">{result.ok_count} nova(s)</span>
      <span className="muted">{result.exists_count} já existente(s)</span>
      {result.error_count > 0 && <span className="error">{result.error_count} com erro</span>}
    </p>
  )
}
