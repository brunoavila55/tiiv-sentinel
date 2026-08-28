import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O bundle sai em /static porque /assets/:id e rota do app.
export default defineConfig({
  plugins: [react()],
  build: { assetsDir: 'static', sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8081',
        changeOrigin: false,
      },
      '/healthz': { target: process.env.VITE_API_PROXY ?? 'http://localhost:8081' },
    },
  },
})
