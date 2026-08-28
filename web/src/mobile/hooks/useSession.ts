import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { SessionInfo, User } from '../../api/types'

/**
 * Sessao longa com renovacao silenciosa. O tecnico nao pode ser deslogado no
 * meio da rua: enquanto faltar menos de uma semana, todo boot com rede empurra
 * a validade; faltando menos de tres dias a tela avisa, em vez de ele descobrir
 * na hora que precisa da senha e nao lembra.
 */

const DAY = 24 * 60 * 60 * 1000
const RENEW_BELOW = 7 * DAY
const WARN_BELOW = 3 * DAY
const RENEW_INTERVAL = 6 * 60 * 60 * 1000

export const sessionKey = ['session'] as const

export interface SessionState {
  user: User | undefined
  authenticated: boolean
  loading: boolean
  /** Dias restantes, para o aviso. `null` quando ainda nao sabemos. */
  daysLeft: number | null
  expiring: boolean
  refresh: () => void
}

export function useSession(): SessionState {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: sessionKey,
    queryFn: api.session,
    retry: false,
    staleTime: 5 * 60_000,
  })

  const expiresAt = query.data?.session?.expires_at
  const msLeft = expiresAt ? Date.parse(expiresAt) - Date.now() : null

  const renew = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const fresh = await api.refresh()
      qc.setQueryData<{ user: User; session: SessionInfo }>(sessionKey, fresh)
    } catch {
      // Sem rede ou sessao ja vencida: o gate de autenticacao resolve.
    }
  }, [qc])

  useEffect(() => {
    if (msLeft === null || msLeft > RENEW_BELOW) return
    void renew()
  }, [msLeft, renew])

  // App aberto por muito tempo (o tecnico deixa em segundo plano o dia todo).
  useEffect(() => {
    const timer = window.setInterval(() => void renew(), RENEW_INTERVAL)
    return () => window.clearInterval(timer)
  }, [renew])

  return {
    user: query.data?.user,
    authenticated: Boolean(query.data?.user),
    loading: query.isPending,
    daysLeft: msLeft === null ? null : Math.max(0, Math.floor(msLeft / DAY)),
    expiring: msLeft !== null && msLeft < WARN_BELOW,
    refresh: () => void query.refetch(),
  }
}
