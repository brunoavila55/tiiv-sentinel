import { useEffect, useState } from 'react'
import type { Attachment } from '../../api/types'
import { formatDate } from '../../lib/format'
import { packagedFile } from '../db/packages'
import { copyText, vibrate } from '../lib/device'
import { useToast } from './Toast'

/**
 * Visualizador de config. O texto e mostrado sem quebra de linha e com rolagem
 * horizontal: config de equipamento tem linha longa e quebrar embaralha a
 * leitura. E nunca dispara download — abrir um .txt no gerenciador de arquivos
 * do Android e um beco sem saida.
 */
export function ConfigViewer({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const notify = useToast()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      // O pacote offline vem primeiro: e instantaneo e funciona sem sinal.
      const local = await packagedFile(attachment.id)
      if (alive && local?.text != null) {
        setText(local.text)
        return
      }
      if (!attachment.url) {
        if (alive) setError('config nao esta disponivel offline')
        return
      }
      try {
        const res = await fetch(attachment.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.text()
        if (alive) setText(body)
      } catch {
        if (alive) setError('nao foi possivel abrir a config sem rede')
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [attachment.id, attachment.url])

  const copyAll = async () => {
    if (!text) return
    const ok = await copyText(text)
    vibrate(15)
    notify(ok ? 'config copiada' : 'nao foi possivel copiar')
  }

  return (
    <div className="viewer viewer-text" role="dialog" aria-modal="true">
      <header className="viewer-bar">
        <button type="button" className="viewer-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <span className="viewer-title">
          {attachment.filename} · {formatDate(attachment.created_at)}
        </span>
        <button type="button" className="viewer-copy" onClick={copyAll} disabled={!text}>
          copiar tudo
        </button>
      </header>
      <div className="config-body">
        {error && <p className="viewer-empty">{error}</p>}
        {!error && text === null && <p className="viewer-empty">carregando…</p>}
        {text !== null && <pre className="config-text">{text}</pre>}
      </div>
    </div>
  )
}
