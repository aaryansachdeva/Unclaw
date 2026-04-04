import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/electron',
      lib: {
        entry: path.resolve(__dirname, 'electron/main.ts'),
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      lib: {
        entry: path.resolve(__dirname, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: 'src',
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/index.html'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
