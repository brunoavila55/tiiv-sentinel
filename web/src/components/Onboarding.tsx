import { useState } from 'react'
import { useCreateAsset } from '../api/hooks'

/**
 * Banco vazio e um beco sem saida se a tela pedir "selecione um ativo" tres
 * vezes sem nunca ter havido nada para selecionar. Aqui existe exatamente um
 * caminho obvio: criar o primeiro ativo.
 */
export function Onboarding({
  onCreateFirst,
  onImportCSV,
}: {
  onCreateFirst: () => void
  onImportCSV: () => void
}) {
  const create = useCreateAsset()
  const [loadingSample, setLoadingSample] = useState(false)

  const loadSample = async () => {
    setLoadingSample(true)
    try {
      const pop = await create.mutateAsync({ name: 'POP Centro', kind: 'pop', parent_id: null })
      const router = await create.mutateAsync({ name: 'Router-Core-01', kind: 'router', parent_id: pop.id, mgmt_ip: '10.0.0.1' })
      const sw = await create.mutateAsync({ name: 'SW-Acesso-01', kind: 'switch', parent_id: router.id, mgmt_ip: '10.0.0.10' })
      const olt = await create.mutateAsync({ name: 'OLT-01', kind: 'olt', parent_id: sw.id, mgmt_ip: '10.0.1.1' })
      await create.mutateAsync({ name: 'AP-Cobertura-01', kind: 'ap', parent_id: sw.id, mgmt_ip: '10.0.0.20' })
      await create.mutateAsync({ name: 'Cliente Exemplo', kind: 'cliente', parent_id: olt.id })
    } finally {
      setLoadingSample(false)
    }
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h1>tiiv <span>sentinel</span></h1>
        <p className="muted">
          Documentação e acesso a ativos de rede com topologia hierárquica visual.
          Monte a árvore de POPs, roteadores, switches e clientes — e ache qualquer
          equipamento em segundos.
        </p>
        <button className="primary-action large" onClick={onCreateFirst}>
          Criar primeiro ativo
        </button>
        <div className="onboarding-secondary">
          <button className="ghost" onClick={onImportCSV}>Importar CSV</button>
          <button className="link" disabled={loadingSample} onClick={loadSample}>
            {loadingSample ? 'carregando dados de exemplo…' : 'carregar dados de exemplo (avaliação)'}
          </button>
        </div>
      </div>
    </div>
  )
}
