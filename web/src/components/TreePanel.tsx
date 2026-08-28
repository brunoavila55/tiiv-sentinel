import { useEffect, useMemo, useRef, useState } from 'react'
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist'
import type { Asset, KindConfig } from '../api/types'
import { ancestorIds, buildTree, type TreeNode } from '../lib/tree'
import { useMoveAsset } from '../api/hooks'
import { KindIcon } from './KindIcon'
import { StatusDot } from './StatusDot'
import { NewAssetDialog } from './NewAssetDialog'
import { useSize } from './useSize'

export function TreePanel({
  items,
  loading,
  selectedId,
  kinds,
  onSelect,
  isAdmin,
}: {
  items: Asset[]
  loading: boolean
  selectedId?: string
  kinds: KindConfig[]
  onSelect: (id: string) => void
  isAdmin: boolean
}) {
  const [term, setTerm] = useState('')
  const [creating, setCreating] = useState(false)
  const treeRef = useRef<TreeApi<TreeNode> | null>(null)
  const { ref, width, height } = useSize<HTMLDivElement>()
  const move = useMoveAsset()

  const data = useMemo(() => buildTree(items), [items])

  // Selecionar em outro painel abre a arvore ate o no, expande o proprio no e
  // rola ate ele.
  useEffect(() => {
    if (!selectedId || !treeRef.current) return
    for (const id of ancestorIds(items, selectedId)) treeRef.current.open(id)
    treeRef.current.open(selectedId)
    treeRef.current.scrollTo(selectedId, 'center')
  }, [selectedId, items, data])

  return (
    <aside className="panel tree-panel">
      <div className="panel-head">
        <input
          className="tree-search"
          placeholder="filtrar arvore…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {isAdmin && (
          <button className="ghost" title="novo ativo" onClick={() => setCreating(true)}>+</button>
        )}
      </div>

      <div className="tree-body" ref={ref}>
        {loading && <div className="muted pad">carregando arvore…</div>}
        {!loading && data.length === 0 && <div className="muted pad">nenhum ativo cadastrado</div>}
        {width > 0 && height > 0 && (
          <Tree<TreeNode>
            ref={treeRef}
            data={data}
            width={width}
            height={height}
            rowHeight={30}
            indent={14}
            openByDefault={false}
            selection={selectedId}
            searchTerm={term}
            searchMatch={(node, search) => {
              const asset = node.data.asset
              const needle = search.toLowerCase()
              return (
                asset.name.toLowerCase().includes(needle) ||
                (asset.mgmt_ip ?? '').includes(needle) ||
                (asset.description ?? '').toLowerCase().includes(needle)
              )
            }}
            disableDrag={!isAdmin}
            disableDrop={!isAdmin}
            onMove={({ dragIds, parentId }) => {
              dragIds.forEach((id) => move.mutate({ id, parentId: parentId ?? null }))
            }}
            onSelect={(nodes) => {
              const node = nodes[0]
              if (node && node.id !== selectedId) onSelect(node.id)
            }}
          >
            {(props) => <Row {...props} kinds={kinds} />}
          </Tree>
        )}
      </div>

      {move.isError && <div className="error pad">{(move.error as Error).message}</div>}

      {creating && (
        <NewAssetDialog
          kinds={kinds}
          parentId={selectedId ?? null}
          parentName={items.find((a) => a.id === selectedId)?.name}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            onSelect(id)
          }}
        />
      )}
    </aside>
  )
}

function Row({ node, style, dragHandle, kinds }: NodeRendererProps<TreeNode> & { kinds: KindConfig[] }) {
  const asset = node.data.asset
  const kind = kinds.find((k) => k.id === asset.kind)
  return (
    <div
      ref={dragHandle}
      style={style}
      className={`tree-row ${node.isSelected ? 'selected' : ''} ${asset.suppressed ? 'suppressed' : ''}`}
      onClick={() => node.select()}
    >
      <button
        className="twisty"
        onClick={(e) => {
          e.stopPropagation()
          node.toggle()
        }}
      >
        {node.children && node.children.length > 0 ? (node.isOpen ? '▾' : '▸') : ''}
      </button>
      <KindIcon kind={asset.kind} color={kind?.color} />
      <span className="tree-name">{asset.name}</span>
      {asset.mgmt_ip && <span className="tree-ip">{asset.mgmt_ip}</span>}
      <StatusDot asset={asset} />
    </div>
  )
}
