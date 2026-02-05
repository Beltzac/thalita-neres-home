import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'src/pages/home/index.html'),
        'sobre-mim': resolve(__dirname, 'src/pages/sobre-mim/index.html'),
        'maquina-escrever': resolve(__dirname, 'src/pages/maquina-escrever/index.html'),
        'filme-fotografico': resolve(__dirname, 'src/pages/filme-fotografico/index.html'),
        pastas: resolve(__dirname, 'src/pages/pastas/index.html'),
        index: resolve(__dirname, 'src/pages/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    },
  },
});
