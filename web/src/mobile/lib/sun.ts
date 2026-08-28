import { useCallback, useEffect, useState } from 'react'

/**
 * Modo sol. A PWA ja e escura por padrao — economiza bateria e nao cega em
 * armario de rede a noite —, mas ao meio-dia na rua nenhum tema escuro se le.
 * O modo sol inverte para fundo claro com contraste maximo.
 */

const KEY = 'sentinel.sun'

function apply(on: boolean) {
  document.documentElement.dataset.sun = on ? 'on' : 'off'
}

export function initSunMode(): void {
  apply(read())
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function useSunMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read)

  useEffect(() => {
    apply(on)
  }, [on])

  const update = useCallback((next: boolean) => {
    setOn(next)
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // navegador com storage bloqueado: vale so para esta sessao
    }
  }, [])

  return [on, update]
}
