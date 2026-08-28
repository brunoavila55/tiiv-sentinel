import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Bundle proprio da PWA, servido em /m. Nao e o desktop com media query: as
// telas sao outras, o canvas React Flow nao vem junto e o service worker tem
// escopo /m/ para nao interferir no app do NOC servido em /.
const here = fileURLToPath(new URL('.', import.meta.url))
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: at('./m'),
  base: '/m/',
  plugins: [
    react(),
    VitePWA({
      // injectManifest: o precache vem do Vite, mas a logica de cache e escrita
      // a mao em sw.ts. Sao quatro estrategias e nenhuma cabe no generateSW
      // (thumbnail do MinIO precisa ignorar a assinatura na chave de cache).
      strategies: 'injectManifest',
      srcDir: at('./src/mobile'),
      filename: 'sw.ts',
      // Update em prompt, nao automatico: recarregar sozinho no meio de um
      // upload em 3G ruim e a pior hora possivel.
      registerType: 'prompt',
      injectRegister: null,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // O app shell e pequeno; o limite alto so evita surpresa se um icone
        // crescer.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        id: '/m/',
        name: 'Sentinel — campo',
        short_name: 'Sentinel',
        description: 'Ativos de rede na mao do tecnico.',
        start_url: '/m/',
        scope: '/m/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0e14',
        theme_color: '#0b0e14',
        lang: 'pt-BR',
        icons: [
          { src: '/m/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/m/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/m/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: at('./dist/m'),
    // outDir mora fora do root (m/), entao o vite exige a permissao explicita.
    emptyOutDir: true,
    assetsDir: 'static',
    sourcemap: false,
  },
  server: {
    port: 5174,
    // O src compartilhado vive um nivel acima do root do bundle mobile.
    fs: { allow: [here] },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8081',
        changeOrigin: false,
      },
      '/healthz': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8081' },
    },
  },
})
