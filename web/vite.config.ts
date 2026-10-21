import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  server: { fs: { allow: ['..'] } },
  build:
    mode === 'single'
      ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000 }
      : { outDir: 'dist' },
}));
