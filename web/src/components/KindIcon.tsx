/** Icone por tipo de ativo. Formas simples, legiveis em 16px. */
export function KindIcon({ kind, color, size = 16 }: { kind: string; color?: string; size?: number }) {
  const stroke = color ?? '#9aa4b2'
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'kind-icon',
  }
  switch (kind) {
    case 'pop':
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M7 8l5-4 5 4" />
          <path d="M5 21h14" />
          <path d="M9 14h6" />
        </svg>
      )
    case 'router':
      return (
        <svg {...common}>
          <rect x="3" y="13" width="18" height="7" rx="2" />
          <path d="M7 16.5h.01M11 16.5h.01" />
          <path d="M12 10V6" />
          <path d="M8 8l4-4 4 4" />
        </svg>
      )
    case 'switch':
      return (
        <svg {...common}>
          <rect x="3" y="8" width="18" height="9" rx="2" />
          <path d="M7 12v2M11 12v2M15 12v2M19 12v2" />
        </svg>
      )
    case 'olt':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 8h8M8 12h8M8 16h4" />
        </svg>
      )
    case 'ap':
      return (
        <svg {...common}>
          <path d="M12 18v-4" />
          <path d="M8.5 12a5 5 0 017 0" />
          <path d="M5.5 9a9 9 0 0113 0" />
          <circle cx="12" cy="19.5" r="1.2" />
        </svg>
      )
    case 'link':
      return (
        <svg {...common}>
          <path d="M9 15l6-6" />
          <path d="M13 5l2-2a4 4 0 016 6l-2 2" />
          <path d="M11 19l-2 2a4 4 0 01-6-6l2-2" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M4 20v-2a4 4 0 014-4h8a4 4 0 014 4v2" />
          <circle cx="12" cy="7" r="3.2" />
        </svg>
      )
  }
}
