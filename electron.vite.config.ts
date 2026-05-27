import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };

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
    // `root: 'src'` makes Vite default publicDir to `src/public`, but our
    // static assets (Silero ONNX model, AudioWorklet, onnxruntime-web wasm
    // files) live at the project root in `public/`. Point Vite there so
    // they're reachable as `/silero_vad.onnx`, `/voice-worklet.js`, etc.
    publicDir: path.resolve(__dirname, 'public'),
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'src/index.html'),
      },
    },
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
  },
});
