/**
 * Confirmacao reutilizavel para acoes que nao dao para desfazer sozinhas:
 * excluir, mover subtree grande, desativar usuario. Nunca um alert() generico.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'confirmar',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>cancelar</button>
          <button
            type="button"
            className={danger ? 'danger' : ''}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'aguarde…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
