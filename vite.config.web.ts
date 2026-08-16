/**
 * 纯 Web 调试配置（无 Electron，用于排查 Vite/HMR）
 * 注意：图片编辑器依赖 window.yiman IPC，Web 模式下抠图/字体/文件读写不可用。
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5174,
    host: '127.0.0.1',
  },
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
  plugins: [react()],
});
