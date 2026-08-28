import { useEffect, useRef } from 'react'
import type { Asset } from '../../api/types'

/**
 * Breadcrumb horizontal. Rola sozinho para o fim porque o nivel atual e o que
 * importa; seis niveis nao quebram a linha, so alongam a rolagem.
 */
export function Trail({
  path,
  current,
  onNavigate,
  onRoot,
}: {
  path: Asset[]
  current?: string
  onNavigate: (asset: Asset) => void
  onRoot: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [path.length, current])

  return (
    <div className="trail" ref={ref}>
      <button type="button" className="trail-item" onClick={onRoot}>
        Rede
      </button>
      {path.map((asset) => (
        <span key={asset.id} className="trail-step">
          <span className="trail-sep" aria-hidden="true">
            ›
          </span>
          <button type="button" className="trail-item" onClick={() => onNavigate(asset)}>
            {asset.name}
          </button>
        </span>
      ))}
      {current && (
        <span className="trail-step">
          <span className="trail-sep" aria-hidden="true">
            ›
          </span>
          <span className="trail-item trail-current">{current}</span>
        </span>
      )}
    </div>
  )
}
