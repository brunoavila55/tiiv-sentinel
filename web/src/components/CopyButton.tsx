import { useState } from 'react'

/** Copiar com feedback visual: e a acao mais usada do painel. */
export function CopyButton({
  value,
  label = 'copiar',
  className = 'ghost',
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={`${className} ${copied ? 'copied' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          // Contexto sem clipboard API (http puro): seleciona via textarea.
          const area = document.createElement('textarea')
          area.value = value
          document.body.appendChild(area)
          area.select()
          document.execCommand('copy')
          area.remove()
        }
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? '✓ copiado' : label}
    </button>
  )
}
