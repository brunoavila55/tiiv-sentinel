import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { User } from '../api/types'

/** Gestao de contas: admin faz CRUD completo, viewer le e anexa foto. */
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Usuarios</h2>
        <ul className="doc-list">
          {(users.data ?? []).map((user) => (
            <li key={user.id}>
              <span>{user.email}</span>
              <span className={`badge ${user.role === 'admin' ? 'admin' : ''}`}>{user.role}</span>
              {user.id !== current.id && (
                <button className="ghost small" onClick={() => remove.mutate(user.id)}>remover</button>
              )}
            </li>
          ))}
          {users.isLoading && <li className="muted">carregando…</li>}
        </ul>

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
            Senha (minimo 8 caracteres)
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
              <option value="viewer">viewer — le tudo e anexa fotos</option>
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
            <button type="submit" disabled={create.isPending}>criar usuario</button>
          </div>
        </form>
      </div>
    </div>
  )
}
