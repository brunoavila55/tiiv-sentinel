import type { Asset, KindAction, KindConfig } from '../api/types'

/**
 * Resolve os links de acao de um ativo a partir do mapa configuravel por kind
 * (servido em /api/config). Nada de protocolo hardcoded em componente.
 */
export function actionsFor(asset: Asset, kinds: KindConfig[]): { action: KindAction; href: string }[] {
  if (!asset.mgmt_ip) return []
  const kind = kinds.find((k) => k.id === asset.kind)
  if (!kind) return []
  return kind.actions
    .filter((action) => {
      if (!action.when_attr) return true
      const value = asset.attrs?.[action.when_attr.key]
      return String(value ?? '').toLowerCase() === action.when_attr.value.toLowerCase()
    })
    .map((action) => ({
      action,
      href: action.template
        .replaceAll('{ip}', asset.mgmt_ip as string)
        .replaceAll('{name}', asset.name),
    }))
}

export function kindConfig(kindId: string, kinds: KindConfig[]): KindConfig | undefined {
  return kinds.find((k) => k.id === kindId)
}
