/** Utilidades do aparelho: area de transferencia, vibracao e estado de rede. */

/**
 * navigator.clipboard so existe em contexto seguro. A VM do ISP costuma servir
 * em http puro, entao o caminho do textarea nao e legado: e o que roda.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // cai para o textarea
    }
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    field.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(field)
    return ok
  } catch {
    return false
  }
}

/** Confirmacao tatil: o tecnico nao precisa tirar o dedo da tela para conferir. */
export function vibrate(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate(pattern)
  } catch {
    // aparelho sem motor de vibracao ou permissao negada
  }
}

/**
 * crypto.randomUUID tambem exige contexto seguro, e a PWA pode estar em http
 * puro na VM. O id so precisa ser unico dentro do IndexedDB do aparelho.
 */
export function uid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS nao implementa display-mode; expoe esta flag proprietaria.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
