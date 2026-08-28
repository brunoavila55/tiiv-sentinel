import { useEffect, useRef, useState } from 'react'

/**
 * Gestos de navegacao. Sao dois e ambos existem porque o polegar do tecnico
 * alcanca a borda da tela, mas nao o topo de um aparelho de 6".
 */

const EDGE_ZONE = 28
const EDGE_TRIGGER = 70

/**
 * Arrastar da borda esquerda sobe um nivel. O botao continua existindo — o
 * gesto e um atalho, nao a unica saida.
 */
export function useEdgeSwipe(onBack: () => void): void {
  useEffect(() => {
    let startX = 0
    let startY = 0
    let tracking = false

    const start = (event: TouchEvent) => {
      const touch = event.touches[0]
      tracking = touch.clientX <= EDGE_ZONE
      startX = touch.clientX
      startY = touch.clientY
    }
    const end = (event: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const touch = event.changedTouches[0]
      const dx = touch.clientX - startX
      // Movimento predominantemente horizontal: rolagem vertical nao volta tela.
      if (dx > EDGE_TRIGGER && Math.abs(touch.clientY - startY) < dx) onBack()
    }

    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchend', end, { passive: true })
    return () => {
      window.removeEventListener('touchstart', start)
      window.removeEventListener('touchend', end)
    }
  }, [onBack])
}

const PULL_TRIGGER = 80

/** Puxar para baixo no topo da tela recarrega. */
export function usePullToRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0)
  const start = useRef<number | null>(null)

  const onTouchStart = (event: React.TouchEvent) => {
    start.current = window.scrollY <= 0 ? event.touches[0].clientY : null
  }
  const onTouchMove = (event: React.TouchEvent) => {
    if (start.current === null) return
    const delta = event.touches[0].clientY - start.current
    // Resistencia: o indicador anda menos que o dedo, como no resto do sistema.
    setPull(delta > 0 ? Math.min(delta * 0.45, PULL_TRIGGER + 20) : 0)
  }
  const onTouchEnd = () => {
    if (pull >= PULL_TRIGGER * 0.7) onRefresh()
    start.current = null
    setPull(0)
  }

  return { pull, handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}
