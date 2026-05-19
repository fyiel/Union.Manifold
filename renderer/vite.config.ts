import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { strict: true }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
            return 'vendor-react'
          }
          if (id.includes('/react-router/') || id.includes('/react-router-dom/')) {
            return 'vendor-router'
          }
          if (id.includes('/@radix-ui/')) {
            return 'vendor-radix'
          }
          if (id.includes('/lucide-react/')) {
            return 'vendor-icons'
          }
          if (id.includes('/react-markdown/') || id.includes('/remark-gfm/') || id.includes('/micromark') || id.includes('/mdast') || id.includes('/hast') || id.includes('/unified/')) {
            return 'vendor-markdown'
          }
          return 'vendor'
        }
      }
    }
  }
})
