import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { User } from '../api/types'

/** Gestão de contas: admin faz CRUD completo, viewer lê e anexa foto. */
export function UsersDialog({ current, onClose }: { current: User; onClose: () => void }) {
  const qc = useQueryClient()
  const users = useQuery({ queryKey: ['users'], queryFn: api.users })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer')

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })
  const create = useMutation({
    mutationFn: () => api.createUser(email, password, role),
    onSuccess: () => {
      setEmail('')
      setPassword('')
      invalidate()
    },
  })
  const remove = useMutation({ mutationFn: api.deleteUser, onSuccess: invalidate })
  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.setUserActive(id, active),
    onSuccess: invalidate,
  })
  const resetPassword = useMutation({
    mutationFn: ({ id, password: pw }: { id: string; password: string }) => api.resetUserPassword(id, pw),
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Usuários</h2>
        <ul className="doc-list users-list">
          {(users.data ?? []).map((user) => (
            <li key={user.id}>
              <span className={user.active ? '' : 'muted'}>{user.email}</span>
              <span className={`badge ${user.role === 'admin' ? 'admin' : ''}`}>{user.role}</span>
              {!user.active && <span className="badge warn">inativo</span>}
              {user.id !== current.id && (
                <>
                  <button
                    className="ghost small"
                    onClick={() => {
                      const next = window.prompt(`nova senha para ${user.email} (mínimo 8 caracteres)`)
                      if (next) resetPassword.mutate({ id: user.id, password: next })
                    }}
                  >
                    resetar senha
                  </button>
                  <button
                    className="ghost small"
                    onClick={() => toggleActive.mutate({ id: user.id, active: !user.active })}
                  >
                    {user.active ? 'desativar' : 'reativar'}
                  </button>
                  <button className="ghost small danger-text" onClick={() => remove.mutate(user.id)}>remover</button>
                </>
              )}
            </li>
          ))}
          {users.isLoading && <li className="muted">carregando…</li>}
        </ul>
        {resetPassword.isError && (
          <div className="error">
            {resetPassword.error instanceof ApiError ? resetPassword.error.message : 'falha ao resetar senha'}
          </div>
        )}
        {resetPassword.isSuccess && <div className="muted small">senha atualizada.</div>}

        <form
          className="asset-fields"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Senha (mínimo 8 caracteres)
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Papel
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'viewer')}>
              <option value="viewer">viewer — lê tudo e anexa fotos</option>
              <option value="admin">admin — CRUD completo</option>
            </select>
          </label>
          {create.isError && (
            <div className="error">
              {create.error instanceof ApiError ? create.error.message : 'falha ao criar'}
            </div>
          )}
          {remove.isError && (
            <div className="error">
              {remove.error instanceof ApiError ? remove.error.message : 'falha ao remover'}
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={onClose}>fechar</button>
            <button type="submit" disabled={create.isPending}>criar usuário</button>
          </div>
        </form>
      </div>
    </div>
  )
}
