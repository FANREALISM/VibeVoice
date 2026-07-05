import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('tone')) return 'vendor-tone';
              if (id.includes('konva')) return 'vendor-konva';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (id.includes('jszip')) return 'vendor-jszip';
              if (id.includes('cmu-pronouncing-dictionary')) return 'vendor-cmudict';
              if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
