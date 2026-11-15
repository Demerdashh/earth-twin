import { defineConfig } from 'vite';

// Static site: Vercel serves dist/ at the domain root. BASE_PATH only for sub-path hosting.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined) },
    },
  },
  server: { port: 5173 },
});
