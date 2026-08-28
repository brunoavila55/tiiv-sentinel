import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { useOnline } from '../hooks/local'
import { sessionKey } from '../hooks/useSession'

/**
 * Login. Deveria ser raro: a sessao dura 30 dias e se renova sozinha. Se esta
 * tela apareceu no meio da rua, alguma coisa deu errado antes.
 */
export function LoginScreen() {
  const qc = useQueryClient()
  const online = useOnline()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.login(email, password)
      await qc.invalidateQueries({ queryKey: sessionKey })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'nao foi possivel entrar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="screen login">
      <h1 className="login-title">sentinel</h1>
      <p className="muted">acesso aos ativos de rede</p>

      {!online && (
        <p className="banner banner-warn">
          Sem rede. O login precisa de conexao — depois disso o app funciona offline.
        </p>
      )}

      <form className="login-form" onSubmit={submit}>
        <label className="field">
          <span>e-mail</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span>senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary wide" disabled={busy}>
          {busy ? 'entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}
