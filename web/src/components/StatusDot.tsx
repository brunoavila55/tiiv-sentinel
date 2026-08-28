import type { Asset } from '../api/types'

/**
 * Bolinha de status. Ativo com ancestral down aparece atenuado: e sintoma, nao
 * causa — sem isso um POP caindo pinta 400 nos de vermelho.
 */
export function StatusDot({ asset, title }: { asset: Pick<Asset, 'status' | 'suppressed'>; title?: string }) {
  const state = asset.suppressed && asset.status === 'down' ? 'symptom' : asset.status
  const labels: Record<string, string> = {
    up: 'up',
    down: 'down',
    unknown: 'sem ping',
    symptom: 'down por consequencia (ancestral caiu)',
  }
  return <span className={`dot dot-${state}`} title={title ?? labels[state]} />
}
