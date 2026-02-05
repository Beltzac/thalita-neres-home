import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pageInputs = {
  home: resolve(__dirname, 'src/pages/home/index.html'),
  'sobre-mim': resolve(__dirname, 'src/pages/sobre-mim/index.html'),
  'maquina-escrever': resolve(__dirname, 'src/pages/maquina-escrever/index.html'),
  'filme-fotografico': resolve(__dirname, 'src/pages/filme-fotografico/index.html'),
  pastas: resolve(__dirname, 'src/pages/pastas/index.html'),
  index: resolve(__dirname, 'src/pages/index.html'),
};

export default defineConfig(() => {
  const singleInput = process.env.SINGLE_INPUT;
  const input = singleInput ? { [singleInput]: pageInputs[singleInput] } : pageInputs;

  return {
    base: './',
    plugins: singleInput ? [viteSingleFile()] : [],
    build: {
      outDir: 'dist',
      emptyOutDir: !singleInput,
      rollupOptions: {
        input,
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      },
    },
  };
});
