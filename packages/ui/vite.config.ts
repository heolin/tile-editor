import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // During UI development the editor talks to a tile-editor server started
    // separately, so the API and project assets are proxied through.
    proxy: {
      '/api': 'http://127.0.0.1:4173',
      '/assets': 'http://127.0.0.1:4173',
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // '/assets' belongs to the project's own images, so the app's bundle lives
    // somewhere that cannot collide with a file inside the user's folder.
    assetsDir: 'app',
  },
})
