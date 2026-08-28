import { useEffect, useMemo, useRef, useState } from 'react'
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist'
import type { Asset, KindConfig } from '../api/types'
import { ancestorIds, buildTree, type TreeNode } from '../lib/tree'
import { useMoveAsset } from '../api/hooks'
import { KindIcon } from './KindIcon'
import { StatusDot } from './StatusDot'
import { ConfirmDialog } from './ConfirmDialog'
import { useSize } from './useSize'

export function TreePanel({
  items,
  loading,
  error,
  onRetry,
  selectedId,
  kinds,
  onSelect,
  onMultiSelect,
  onAddChild,
  onNotify,
  isAdmin,
}: {
  items: Asset[]
  loading: boolean
  error?: Error | null
  onRetry: () => void
  selectedId?: string
  kinds: KindConfig[]
  onSelect: (id: string) => void
  onMultiSelect?: (ids: string[]) => void
  onAddChild: (parentId: string | null, parentName?: string) => void
  onNotify?: (message: string, action?: { label: string; onClick: () => void }) => void
  isAdmin: boolean
}) {
  const [term, setTerm] = useState('')
  const [pendingMove, setPendingMove] = useState<{ id: string; name: string; parentId: string | null; count: number } | null>(null)
  const treeRef = useRef<TreeApi<TreeNode> | null>(null)
  const { ref, width, height } = useSize<HTMLDivElement>()
  const move = useMoveAsset()

  const data = useMemo(() => buildTree(items), [items])

  // Mover ja comita na hora (ao contrario de excluir, mover e barato de
  // reverter: um segundo move de volta nao perde nada), mas oferece
  // "desfazer" por alguns segundos porque foi a acao mais facil de fazer sem
  // querer no drag-and-drop.
  const runMove = (assetId: string, parentId: string | null) => {
    const asset = items.find((a) => a.id === assetId)
    const previousParentId = asset?.parent_id ?? null
    move.mutate(
      { id: assetId, parentId },
      {
        onSuccess: () => {
          onNotify?.(`"${asset?.name ?? assetId}" movido`, {
            label: 'desfazer',
            onClick: () => move.mutate({ id: assetId, parentId: previousParentId }),
          })
        },
      },
    )
  }

  // Ids do subtree de cada no arrastado: usados para bloquear soltar dentro
  // do proprio subtree antes mesmo de chegar na API, e para avisar quantos
  // descendentes vao junto quando o alvo arrastado tem filhos.
  const descendantsOf = useMemo(() => {
    const childrenByParent = new Map<string | null, string[]>()
    for (const a of items) {
      const list = childrenByParent.get(a.parent_id) ?? []
      list.push(a.id)
      childrenByParent.set(a.parent_id, list)
    }
    return (id: string): Set<string> => {
      const out = new Set<string>()
      const walk = (current: string) => {
        for (const child of childrenByParent.get(current) ?? []) {
          if (!out.has(child)) {
            out.add(child)
            walk(child)
          }
        }
      }
      walk(id)
      return out
    }
  }, [items])

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
          placeholder="filtrar árvore…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {isAdmin && (
          <button
            className="ghost"
            title="novo ativo na raiz (atalho: N)"
            onClick={() => onAddChild(null)}
          >
            +
          </button>
        )}
      </div>

      <div className="tree-body" ref={ref}>
        {loading && (
          <div className="skeleton-list pad">
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton-row" />)}
          </div>
        )}
        {!loading && error && (
          <div className="pad">
            <p className="error">falha ao carregar a árvore: {error.message}</p>
            <button className="ghost small" onClick={onRetry}>tentar de novo</button>
          </div>
        )}
        {!loading && !error && data.length === 0 && <div className="muted pad">nenhum ativo cadastrado</div>}
        {!loading && !error && width > 0 && height > 0 && (
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
            disableMultiSelection={!isAdmin}
            onMove={({ dragIds, parentId }) => {
              for (const id of dragIds) {
                if (parentId && (parentId === id || descendantsOf(id).has(parentId))) continue
                const count = descendantsOf(id).size
                if (count > 0) {
                  const name = items.find((a) => a.id === id)?.name ?? id
                  setPendingMove({ id, name, parentId: parentId ?? null, count })
                  continue
                }
                runMove(id, parentId ?? null)
              }
            }}
            onSelect={(nodes) => {
              if (nodes.length > 1) {
                onMultiSelect?.(nodes.map((n) => n.id))
                return
              }
              const node = nodes[0]
              if (node && node.id !== selectedId) onSelect(node.id)
            }}
          >
            {(props) => <Row {...props} kinds={kinds} isAdmin={isAdmin} onAddChild={onAddChild} />}
          </Tree>
        )}
      </div>

      {move.isError && <div className="error pad">{(move.error as Error).message}</div>}

      {pendingMove && (
        <ConfirmDialog
          title="Mover ativo com descendentes"
          message={`"${pendingMove.name}" tem ${pendingMove.count} descendente(s), que vão junto com ele. Confirmar o movimento?`}
          confirmLabel="mover"
          busy={move.isPending}
          onCancel={() => setPendingMove(null)}
          onConfirm={() => {
            runMove(pendingMove.id, pendingMove.parentId)
            setPendingMove(null)
          }}
        />
      )}
    </aside>
  )
}

function Row({
  node, style, dragHandle, kinds, isAdmin, onAddChild,
}: NodeRendererProps<TreeNode> & { kinds: KindConfig[]; isAdmin: boolean; onAddChild: (id: string, name?: string) => void }) {
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
      {isAdmin && (
        <button
          className="ghost small add-child"
          title="Adicionar filho aqui"
          onClick={(e) => {
            e.stopPropagation()
            onAddChild(asset.id, asset.name)
          }}
        >
          +
        </button>
      )}
    </div>
  )
}
