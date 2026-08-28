import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

/**
 * Registro do service worker com prompt de atualizacao. Recarregar sozinho e
 * tentador e errado: pode acontecer no meio de um upload em 3G ruim. O tecnico
 * decide quando.
 */

let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null
let needRefresh = false
const listeners = new Set<(ready: boolean) => void>()

function emit(value: boolean) {
  needRefresh = value
  for (const fn of listeners) fn(value)
}

export function setupPWA(): void {
  if (!('serviceWorker' in navigator)) {
    // Service worker exige contexto seguro (https ou localhost). Sem ele o app
    // funciona online; o offline de verdade depende de servir por HTTPS.
    console.warn('service worker indisponivel: sirva a PWA por HTTPS para o modo offline')
    return
  }
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: () => emit(true),
    onRegisterError: (err) => console.warn('falha registrando o service worker', err),
  })
}

export function useUpdateReady(): [boolean, () => void] {
  const [ready, setReady] = useState(needRefresh)
  useEffect(() => {
    listeners.add(setReady)
    return () => {
      listeners.delete(setReady)
    }
  }, [])
  return [ready, () => void applyUpdate?.(true)]
}
