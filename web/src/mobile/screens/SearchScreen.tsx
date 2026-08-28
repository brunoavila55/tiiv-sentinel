import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import { useConfig } from '../../api/hooks'
import type { Asset } from '../../api/types'
import { AssetRow } from '../components/AssetRow'
import { ScanButton } from '../components/ScanButton'
import { useFavorites, useOnline, useRecents } from '../hooks/local'
import { searchLocal } from '../lib/search'

const DEBOUNCE_MS = 250
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * A home e a busca. O tecnico quase nunca navega a arvore para achar o ativo:
 * ele ja sabe qual e e quer digitar tres letras. Abaixo do campo ficam os
 * ultimos acessados e os favoritos, que sao o atalho de quem volta ao mesmo
 * poste duas vezes na semana.
 */
export function SearchScreen() {
  const navigate = useNavigate()
  const online = useOnline()
  const config = useConfig(true)
  const recents = useRecents()
  const favorites = useFavorites()

  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [text])

  // Teclado abre junto com o app: o primeiro gesto e sempre digitar.
  useEffect(() => {
    field.current?.focus()
  }, [])

  const remote = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.search(term),
    enabled: term.length > 0 && online,
    retry: false,
    staleTime: 10_000,
  })

  const local = useQuery({
    queryKey: ['local', 'search', term],
    queryFn: () => searchLocal(term),
    // Sem rede — ou com o servidor fora — a busca cai no que ja esta no aparelho.
    enabled: term.length > 0 && (!online || remote.isError),
    staleTime: 0,
  })

  const results: Asset[] | undefined = remote.data ?? local.data
  const offlineResults = !remote.data && Boolean(local.data)

  const open = (asset: Asset) => navigate(`/a/${asset.id}`)

  const onScan = (value: string) => {
    // Etiqueta com o link do ativo, ou so o id: os dois levam direto a ficha.
    const found = value.match(UUID)
    if (found) navigate(`/a/${found[0]}`)
    else setText(value)
  }

  return (
    <main className="screen">
      <div className="search-bar">
        <input
          ref={field}
          className="search-field"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="nome, IP ou descricao"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <ScanButton onResult={onScan} />
      </div>

      {term.length > 0 && (
        <section>
          <h2 className="section-title">
            resultados
            {offlineResults && <span className="tag">offline</span>}
          </h2>
          {results?.length === 0 && (
            <p className="muted center">
              {online ? 'Nada encontrado.' : 'Nada encontrado no que esta salvo neste aparelho.'}
            </p>
          )}
          <div className="list">
            {results?.map((asset) => (
              <AssetRow key={asset.id} asset={asset} kinds={config.data?.kinds ?? []} onOpen={open} />
            ))}
          </div>
        </section>
      )}

      {term.length === 0 && (
        <>
          {favorites.data && favorites.data.length > 0 && (
            <section>
              <h2 className="section-title">favoritos</h2>
              <div className="list">
                {favorites.data.map((entry) => (
                  <AssetRow
                    key={entry.assetId}
                    asset={entry.asset}
                    kinds={config.data?.kinds ?? []}
                    onOpen={open}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="section-title">acessados recentemente</h2>
            {recents.data?.length === 0 && (
              <p className="muted center">
                Nada ainda. Busque um ativo ou{' '}
                <button type="button" className="link" onClick={() => navigate('/t')}>
                  navegue a topologia
                </button>
                .
              </p>
            )}
            <div className="list">
              {recents.data?.map((entry) => (
                <AssetRow
                  key={entry.assetId}
                  asset={entry.asset}
                  kinds={config.data?.kinds ?? []}
                  onOpen={open}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
