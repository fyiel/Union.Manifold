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
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) {
              return 'vendor-lucide'
            }
            if (id.includes('react-router') || id.includes('@remix-run')) {
              return 'vendor-router'
            }
            if (id.includes('@radix-ui')) {
              return 'vendor-radix'
            }
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('unist') || id.includes('mdast') || id.includes('micromark') || id.includes('vfile')) {
              return 'vendor-markdown'
            }
            if (id.includes('react-dom')) {
              return 'vendor-react-dom'
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react'
            }
            return 'vendor-libs'
          }
        }
      }
    }
  }
})
