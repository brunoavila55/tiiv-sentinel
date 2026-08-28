import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ToastProvider } from './components/Toast'
import { setupPWA } from './lib/pwa'
import { initSunMode } from './lib/sun'
import './app.css'

/**
 * Entrada da PWA de campo. Bundle e telas proprios: nada aqui e o desktop com
 * media query. Os hooks de API e os componentes de dominio, sim, sao os mesmos.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Em 4G de poste, refetch a cada foco custa caro e raramente muda algo.
      refetchOnWindowFocus: false,
      // Uma tentativa: falhou, o app cai no cache do service worker ou no
      // pacote offline, que e mais rapido que insistir.
      retry: 1,
      staleTime: 30_000,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'offlineFirst' },
  },
})

initSunMode()
setupPWA()

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* O bundle e servido em /m; a selecao continua na URL para o link ser
          compartilhavel no WhatsApp. */}
      <BrowserRouter basename="/m">
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
