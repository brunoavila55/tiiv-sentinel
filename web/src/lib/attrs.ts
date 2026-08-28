export type AttrRow = [key: string, value: string]

export function stringifyAttrValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Preserva numero e booleano; o resto fica string. */
export function parseAttrValue(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return value
    }
  }
  return value
}

export function rowsToAttrs(rows: AttrRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of rows) {
    const name = key.trim()
    if (!name) continue
    out[name] = parseAttrValue(value)
  }
  return out
}

export function attrsToRows(attrs: Record<string, unknown> | null | undefined): AttrRow[] {
  return Object.entries(attrs ?? {}).map(([k, v]) => [k, stringifyAttrValue(v)])
}

/** Nomes de chave duplicados (case-insensitive), para bloquear o salvamento. */
export function duplicateKeys(rows: AttrRow[]): string[] {
  const seen = new Map<string, number>()
  for (const [key] of rows) {
    const k = key.trim().toLowerCase()
    if (!k) continue
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([k]) => k)
}
