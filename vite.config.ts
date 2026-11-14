import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// BASE_PATH: '/' for Netlify / local, '/<repo>/' for GitHub Pages (set by the deploy workflow).
const base = process.env.BASE_PATH ?? '/';
const cesiumBuild = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  base,
  define: {
    CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`),
  },
  plugins: [
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((dir) => ({
        src: `${cesiumBuild}/${dir}`,
        dest: 'cesium',
        // keep dist/cesium/<dir>/..., dropping node_modules/cesium/Build/Cesium
        rename: { stripBase: 4 },
      })),
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('node_modules/cesium') ? 'cesium' : undefined) },
    },
  },
  server: { port: 5173 },
});
