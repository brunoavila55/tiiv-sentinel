import type { Asset } from '../api/types'

export interface TreeNode {
  id: string
  name: string
  asset: Asset
  children: TreeNode[]
}

/** Monta a arvore aninhada a partir da lista plana devolvida pela CTE. */
export function buildTree(items: Asset[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const asset of items) {
    byId.set(asset.id, { id: asset.id, name: asset.name, asset, children: [] })
  }
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    const parentId = node.asset.parent_id
    const parent = parentId ? byId.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    nodes.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

/** Cadeia de ancestrais de um no, da raiz ate o pai direto. */
export function ancestorIds(items: Asset[], id: string): string[] {
  const byId = new Map(items.map((a) => [a.id, a]))
  const chain: string[] = []
  let current = byId.get(id)
  while (current?.parent_id) {
    chain.unshift(current.parent_id)
    current = byId.get(current.parent_id)
  }
  return chain
}

/** Subtree de um no dentro da lista plana, limitada por profundidade. */
export function subtreeOf(items: Asset[], rootId: string | null, maxDepth: number): Asset[] {
  const childrenOf = new Map<string | null, Asset[]>()
  for (const asset of items) {
    const list = childrenOf.get(asset.parent_id) ?? []
    list.push(asset)
    childrenOf.set(asset.parent_id, list)
  }
  const out: Asset[] = []
  const walk = (id: string | null, depth: number) => {
    for (const child of childrenOf.get(id) ?? []) {
      out.push(child)
      if (depth < maxDepth) walk(child.id, depth + 1)
    }
  }
  if (rootId) {
    const root = items.find((a) => a.id === rootId)
    if (root) {
      out.push(root)
      walk(root.id, 1)
    }
  } else {
    walk(null, 1)
  }
  return out
}
