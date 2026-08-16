import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts')) return 'recharts';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('xlsx')) return 'xlsx';
            if (id.includes('react-router')) return 'react-vendor';
            if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
})
