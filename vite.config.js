import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) return 'vue-vendor';
          if (id.includes('node_modules/element-plus') || id.includes('node_modules/@element-plus')) return 'element-plus-vendor';
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4288',
        changeOrigin: true
      }
    }
  }
});
