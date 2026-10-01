import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    visualizer({
      filename: 'dist/stats.html',  // Output file
      open: true,                   // Auto-open in browser
      gzipSize: true,              // Show gzipped sizes
      brotliSize: true,            // Show brotli sizes
      template: 'treemap',         // Interactive treemap
    }),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8501',
        changeOrigin: true,
      },
    },
  },
})