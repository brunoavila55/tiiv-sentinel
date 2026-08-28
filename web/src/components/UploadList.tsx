import type { UploadState } from '../lib/useUploads'

export function UploadList({
  uploads,
  onDismiss,
}: {
  uploads: UploadState[]
  onDismiss: (key: string) => void
}) {
  if (uploads.length === 0) return null
  return (
    <ul className="uploads">
      {uploads.map((upload) => (
        <li key={upload.key} className={upload.error ? 'failed' : ''}>
          <span className="upload-name" title={upload.name}>{upload.name}</span>
          {upload.error ? (
            <>
              <span className="error inline">{upload.error}</span>
              <button className="ghost small" onClick={() => onDismiss(upload.key)}>×</button>
            </>
          ) : (
            <span className="progress">
              <span className="bar" style={{ width: `${upload.percent}%` }} />
              <em>{upload.percent}%</em>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
