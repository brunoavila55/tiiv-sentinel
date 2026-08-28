import type { Asset, KindConfig } from '../../api/types'
import { actionsFor } from '../../lib/actions'
import { copyText, vibrate } from '../lib/device'
import { useToast } from './Toast'

/**
 * O bloco que existe para os dois primeiros motivos de o tecnico abrir o app:
 * copiar o IP e entrar no equipamento. Sao botoes grandes, nao links de texto.
 */
export function ActionBlock({ asset, kinds }: { asset: Asset; kinds: KindConfig[] }) {
  const notify = useToast()
  const actions = actionsFor(asset, kinds)

  const copy = async () => {
    if (!asset.mgmt_ip) return
    const ok = await copyText(asset.mgmt_ip)
    // Confirmacao tatil e visual: da para conferir sem tirar o dedo da tela.
    vibrate(ok ? 15 : [10, 60, 10])
    notify(ok ? `IP ${asset.mgmt_ip} copiado` : 'nao foi possivel copiar o IP')
  }

  if (!asset.mgmt_ip) {
    return <p className="no-ip">Este ativo nao tem IP de gerencia cadastrado.</p>
  }

  return (
    <div className="actions">
      <button type="button" className="btn-copy" onClick={copy}>
        <span className="btn-copy-label">Copiar IP</span>
        <span className="btn-copy-ip ip">{asset.mgmt_ip}</span>
      </button>
      {actions.length > 0 && (
        <div className="action-grid">
          {actions.map(({ action, href }) => (
            // Protocolos vem do mapa por kind servido em /api/config; nada de
            // ssh:// escrito dentro de componente.
            <a key={action.id} className="btn-action" href={href} rel="noreferrer">
              {action.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
