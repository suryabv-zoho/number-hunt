import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Consume the shared package straight from source — no build step in dev.
      '@game/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // shadcn's generated components import the class helper as a bare 'cn'.
      cn: fileURLToPath(new URL('./src/lib/utils.ts', import.meta.url)),
    },
  },
  build: {
    // Split the vendor code out so a change to the game doesn't force players to
    // re-download React and friends — it matters most on the slow connections that
    // tend to come with the cheap devices.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'net';
          if (id.includes('@dnd-kit')) return 'dnd';
          if (id.includes('@radix-ui') || id.includes('radix-ui')) return 'ui';
          if (id.includes('fortawesome')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/health': { target: 'http://localhost:3001' },
    },
  },
});
