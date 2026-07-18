import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vite-konfiguraatio. `base: ''` on tärkeä Capacitorille, jotta
// varmistetaan suhteelliset polut natiivissa WebView-ympäristössä.
export default defineConfig({
  base: '',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
