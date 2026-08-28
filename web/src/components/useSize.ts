import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Mede o container para dar largura/altura fixas ao virtualizador. A medicao
 * inicial e sincrona: depender so do ResizeObserver deixa a arvore em branco
 * quando o callback nao dispara (aba em segundo plano, por exemplo).
 */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      setSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return { ref, ...size }
}
