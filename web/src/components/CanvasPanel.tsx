import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from 'reactflow'
import dagre from 'dagre'
import 'reactflow/dist/style.css'
import type { Asset, KindConfig } from '../api/types'
import { subtreeOf } from '../lib/tree'
import { api } from '../api/client'
import { AssetNode, type AssetNodeData } from './AssetNode'

const nodeTypes = { asset: AssetNode }
const NODE_W = 190
const NODE_H = 64

/** Layout hierarquico para os nos que ainda nao tem posicao gravada. */
function dagreLayout(assets: Asset[]): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 70 })
  assets.forEach((a) => graph.setNode(a.id, { width: NODE_W, height: NODE_H }))
  const ids = new Set(assets.map((a) => a.id))
  assets.forEach((a) => {
    if (a.parent_id && ids.has(a.parent_id)) graph.setEdge(a.parent_id, a.id)
  })
  dagre.layout(graph)
  const out = new Map<string, { x: number; y: number }>()
  assets.forEach((a) => {
    const node = graph.node(a.id)
    if (node) out.set(a.id, { x: node.x - NODE_W / 2, y: node.y - NODE_H / 2 })
  })
  return out
}

const HIDDEN_KINDS_KEY = 'sentinel.canvas.hiddenKinds'

function loadHiddenKinds(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KINDS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function CanvasPanel(props: {
  items: Asset[]
  totalAssets: number
  selectedId?: string
  kinds: KindConfig[]
  onSelect: (id: string) => void
  canPersist: boolean
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}

function Canvas({
  items,
  totalAssets,
  selectedId,
  kinds,
  onSelect,
  canPersist,
}: {
  items: Asset[]
  totalAssets: number
  selectedId?: string
  kinds: KindConfig[]
  onSelect: (id: string) => void
  canPersist: boolean
}) {
  const flow = useReactFlow()
  const [depth, setDepth] = useState(2)
  const [hidden, setHidden] = useState<string[]>(loadHiddenKinds)

  useEffect(() => {
    window.localStorage.setItem(HIDDEN_KINDS_KEY, JSON.stringify(hidden))
  }, [hidden])
  const [nodes, setNodes] = useState<Node<AssetNodeData>[]>([])
  const pending = useRef(new Map<string, { pos_x: number; pos_y: number }>())
  const timer = useRef<number | undefined>(undefined)

  // Raiz do canvas: o ativo selecionado quando tem filhos, senao o pai — ver a
  // topologia inteira quase nunca ajuda, ver o trecho ao redor sim.
  const rootId = useMemo(() => {
    const selected = items.find((a) => a.id === selectedId)
    if (!selected) return null
    if (selected.child_count > 0) return selected.id
    return selected.parent_id ?? selected.id
  }, [items, selectedId])

  const visible = useMemo(() => {
    const scope = subtreeOf(items, rootId, depth)
    return scope.filter((a) => a.id === rootId || !hidden.includes(a.kind))
  }, [items, rootId, depth, hidden])

  useEffect(() => {
    const layout = dagreLayout(visible)
    const missing: { id: string; pos_x: number; pos_y: number }[] = []
    const next = visible.map<Node<AssetNodeData>>((asset) => {
      const fallback = layout.get(asset.id) ?? { x: 0, y: 0 }
      const hasPosition = asset.pos_x !== null && asset.pos_y !== null
      if (!hasPosition) missing.push({ id: asset.id, pos_x: fallback.x, pos_y: fallback.y })
      return {
        id: asset.id,
        type: 'asset',
        position: hasPosition ? { x: asset.pos_x as number, y: asset.pos_y as number } : fallback,
        data: { asset, kind: kinds.find((k) => k.id === asset.kind), selected: asset.id === selectedId },
      }
    })
    setNodes(next)
    // A primeira renderizacao grava a posicao vinda do layout automatico.
    if (canPersist && missing.length > 0) void api.savePositions(missing).catch(() => undefined)
  }, [visible, kinds, selectedId, canPersist])

  const edges = useMemo<Edge[]>(() => {
    const ids = new Set(visible.map((a) => a.id))
    return visible
      .filter((a) => a.parent_id && ids.has(a.parent_id))
      .map((a) => ({
        id: `${a.parent_id}-${a.id}`,
        source: a.parent_id as string,
        target: a.id,
        type: 'smoothstep',
      }))
  }, [visible])

  // Fit-to-view enquadra o subtree em foco, nao a rede inteira.
  useEffect(() => {
    if (nodes.length === 0) return
    const id = window.setTimeout(() => flow.fitView({ padding: 0.25, duration: 250 }), 60)
    return () => window.clearTimeout(id)
  }, [rootId, depth, flow, nodes.length])

  const flush = useCallback(() => {
    if (pending.current.size === 0) return
    const payload = Array.from(pending.current.entries()).map(([id, pos]) => ({ id, ...pos }))
    pending.current.clear()
    void api.savePositions(payload).catch(() => undefined)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current) as Node<AssetNodeData>[])
      if (!canPersist) return
      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          pending.current.set(change.id, { pos_x: change.position.x, pos_y: change.position.y })
        }
      }
      // Debounce de 500ms: arrastar nao vira uma escrita por frame.
      if (pending.current.size > 0) {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, 500)
      }
    },
    [canPersist, flush],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <section className="panel canvas-panel">
      {totalAssets > 0 && (
        <div className="canvas-toolbar">
          <label className="depth">
            profundidade
            <input type="range" min={1} max={4} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
            <span>{depth}</span>
          </label>
          <div className="kind-filter">
            {kinds.map((kind) => {
              const off = hidden.includes(kind.id)
              return (
                <button
                  key={kind.id}
                  className={`chip ${off ? 'off' : ''}`}
                  style={off ? undefined : { borderColor: kind.color, color: kind.color }}
                  onClick={() =>
                    setHidden((current) =>
                      current.includes(kind.id) ? current.filter((k) => k !== kind.id) : [...current, kind.id],
                    )
                  }
                >
                  {kind.label}
                </button>
              )
            })}
          </div>
          {hidden.length > 0 && (
            <button className="link small filter-clear" onClick={() => setHidden([])}>
              {hidden.length} filtro(s) ativo(s) · limpar
            </button>
          )}
        </div>
      )}
      <div className="canvas-body">
        {nodes.length === 0 ? (
          <div className="muted pad">
            {totalAssets === 0 ? 'nenhum ativo cadastrado ainda' : 'selecione um ativo na árvore para ver a topologia'}
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => onSelect(node.id)}
            nodesDraggable={canPersist}
            nodesConnectable={false}
            edgesFocusable={false}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="#1e2632" />
            <MiniMap pannable zoomable maskColor="rgba(9,12,17,0.7)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </section>
  )
}
