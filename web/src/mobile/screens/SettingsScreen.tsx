import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { formatBytes, formatDate } from '../../lib/format'
import { wipeLocalData } from '../db/index'
import {
  useDiscardUpload,
  useOnline,
  usePackages,
  useRemovePackage,
  useRetryUpload,
  useUploadQueue,
} from '../hooks/local'
import { useSession } from '../hooks/useSession'
import { useSunMode } from '../lib/sun'
import { runSync } from '../lib/sync'
import { useToast } from '../components/Toast'

/** Fila, pacotes offline e sessao: tudo que o tecnico pode precisar conferir. */
export function SettingsScreen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const notify = useToast()
  const online = useOnline()
  const session = useSession()
  const queue = useUploadQueue()
  const packages = usePackages()
  const retry = useRetryUpload()
  const discard = useDiscardUpload()
  const removePackage = useRemovePackage()
  const [sun, setSun] = useSunMode()

  const pending = queue.data?.filter((item) => item.status === 'pending') ?? []
  const failed = queue.data?.filter((item) => item.status === 'failed') ?? []

  const logout = async () => {
    try {
      await api.logout()
    } catch {
      // sem rede: encerramos localmente de qualquer forma
    }
    // O aparelho pode ser compartilhado entre tecnicos; nao deixamos rastro.
    await wipeLocalData()
    qc.clear()
    navigate('/')
  }

  return (
    <main className="screen">
      <header className="browse-head">
        <button type="button" className="head-back" onClick={() => navigate(-1)} aria-label="Voltar">
          ‹
        </button>
        <h1>Ajustes</h1>
      </header>

      <section className="card">
        <h2 className="card-title">Fila de envio</h2>
        {pending.length === 0 && failed.length === 0 && <p className="muted">Nada pendente.</p>}
        {pending.length > 0 && (
          <p>
            {pending.length} foto(s) aguardando {online ? 'envio' : 'rede'}.
          </p>
        )}
        {failed.map((item) => (
          <div key={item.id} className="queue-row">
            <span className="queue-name">{item.assetName}</span>
            <span className="queue-error">{item.error ?? 'falhou'}</span>
            <span className="button-row">
              <button type="button" className="link" onClick={() => retry.mutate(item.id)}>
                tentar de novo
              </button>
              <button type="button" className="link" onClick={() => discard.mutate(item.id)}>
                descartar
              </button>
            </span>
          </div>
        ))}
        {pending.length > 0 && online && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              void runSync()
              notify('enviando…')
            }}
          >
            Enviar agora
          </button>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Pacotes offline</h2>
        {packages.data?.length === 0 && (
          <p className="muted">
            Nenhum. Abra um POP e use “Baixar para uso offline” antes de entrar em area sem sinal.
          </p>
        )}
        {packages.data?.map((entry) => (
          <div key={entry.rootId} className="queue-row">
            <button type="button" className="queue-name link" onClick={() => navigate(`/a/${entry.rootId}`)}>
              {entry.name}
            </button>
            <span className="muted">
              {entry.assetCount} ativos · {formatBytes(entry.bytes)} ·{' '}
              {formatDate(new Date(entry.at).toISOString())}
            </span>
            <button type="button" className="link" onClick={() => removePackage.mutate(entry.rootId)}>
              remover
            </button>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="card-title">Tela</h2>
        <label className="switch">
          <input type="checkbox" checked={sun} onChange={(event) => setSun(event.target.checked)} />
          <span>
            Modo sol — contraste maximo para ler a tela sob luz direta.
          </span>
        </label>
      </section>

      <section className="card">
        <h2 className="card-title">Sessao</h2>
        <p className="muted">
          {session.user?.email}
          {session.daysLeft !== null && ` · expira em ${session.daysLeft} dia(s)`}
        </p>
        <button type="button" className="btn-ghost btn-danger" onClick={() => void logout()}>
          Sair e limpar este aparelho
        </button>
      </section>
    </main>
  )
}
