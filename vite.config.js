import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    // three.js is its own lazily loaded chunk (~520 KB); the entry bundle stays ~40 KB
    chunkSizeWarningLimit: 600,
  },
})
