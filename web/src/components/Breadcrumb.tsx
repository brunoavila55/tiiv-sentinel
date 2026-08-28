import type { Asset } from '../api/types'

export function Breadcrumb({
  trail,
  onSelect,
}: {
  trail: Asset[]
  onSelect: (id: string) => void
}) {
  if (trail.length === 0) return <div className="breadcrumb muted">raiz</div>
  return (
    <nav className="breadcrumb">
      {trail.map((asset, index) => (
        <span key={asset.id}>
          {index > 0 && <span className="sep">/</span>}
          <button className="link" onClick={() => onSelect(asset.id)}>{asset.name}</button>
        </span>
      ))}
    </nav>
  )
}
