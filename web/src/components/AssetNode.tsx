import { Handle, Position, type NodeProps } from 'reactflow'
import { KindIcon } from './KindIcon'
import { StatusDot } from './StatusDot'
import type { Asset, KindConfig } from '../api/types'

export interface AssetNodeData {
  asset: Asset
  kind?: KindConfig
  selected: boolean
}

/** No do canvas: icone por kind, nome, IP e borda colorida por status. */
export function AssetNode({ data }: NodeProps<AssetNodeData>) {
  const { asset, kind } = data
  const state = asset.suppressed && asset.status === 'down' ? 'symptom' : asset.status
  return (
    <div className={`flow-node status-${state} ${data.selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="flow-node-head">
        <KindIcon kind={asset.kind} color={kind?.color} size={14} />
        <span className="flow-node-name" title={asset.name}>{asset.name}</span>
        <StatusDot asset={asset} />
      </div>
      <div className="flow-node-meta">
        <span className="flow-node-kind">{kind?.label ?? asset.kind}</span>
        {asset.mgmt_ip && <span className="flow-node-ip">{asset.mgmt_ip}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
