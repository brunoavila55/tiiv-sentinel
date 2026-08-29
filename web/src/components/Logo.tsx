import { useId } from 'react'

/** Marca: nos de rede conectados, o mesmo grafo que a topologia desenha. */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="logo-mark" aria-hidden="true">
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#lg-${id})`} />
      <path d="M10 21.5L16 10.5L22 21.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
      <circle cx="16" cy="10.5" r="2.3" fill="#fff" />
      <circle cx="10" cy="21.5" r="2.1" fill="#fff" />
      <circle cx="22" cy="21.5" r="2.1" fill="#fff" />
    </svg>
  )
}
