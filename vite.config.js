import { defineConfig } from 'vite';

export default defineConfig({
  base: '/chord-identifier/',
  optimizeDeps: {
    include: ['@tonejs/midi'],
  },
});
