import type { Asset, KindConfig } from '../../api/types'
import { KindIcon } from '../../components/KindIcon'
import { StatusDot } from '../../components/StatusDot'

/**
 * Linha da lista. Alta de proposito (56px minimo): o alvo precisa aceitar dedo
 * de luva, em movimento, sob sol.
 */
export function AssetRow({
  asset,
  kinds,
  onOpen,
  trailing,
}: {
  asset: Asset
  kinds: KindConfig[]
  onOpen: (asset: Asset) => void
  trailing?: React.ReactNode
}) {
  const kind = kinds.find((k) => k.id === asset.kind)
  return (
    <button type="button" className="row" onClick={() => onOpen(asset)}>
      <span className="row-icon">
        <KindIcon kind={asset.kind} color={kind?.color} size={22} />
      </span>
      <span className="row-body">
        <span className="row-name">{asset.name}</span>
        <span className="row-meta">
          {asset.mgmt_ip ? <span className="ip">{asset.mgmt_ip}</span> : <span className="muted">sem IP</span>}
          <span className="muted">{kind?.label ?? asset.kind}</span>
        </span>
      </span>
      <span className="row-tail">
        {trailing}
        <StatusDot asset={asset} />
        {asset.child_count > 0 && <span className="row-count">{asset.child_count}</span>}
      </span>
    </button>
  )
}
