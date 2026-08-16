/**
 * 蘑菇鸭 - 主构建配置（Electron + React + Vite）
 * 保留芝绘的三入口结构（main / preload / renderer），
 * 以及独立 ai-server 子构建（抠图 ONNX 模型 HTTP 服务）。
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

export default defineConfig(({ command }) => {
  try {
    rmSync('dist-electron', { recursive: true, force: true });
  } catch {
    /* 目录可能被占用，忽略 */
  }

  const isBuild = command === 'build';
  const sourcemap = !isBuild;

  return {
    base: './',
    server: {
      port: 5174,
      host: '127.0.0.1',
    },
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
      },
    },
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main/index.ts',
          onstart(args) {
            args.startup();
          },
          vite: {
            plugins: [
              {
                name: 'build-ai-server',
                async closeBundle() {
                  await build({ configFile: 'vite.ai-server.config.ts' }).catch((e) =>
                    console.warn('[build-ai-server]', e),
                  );
                },
              },
            ],
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: [
                  'electron',
                  'better-sqlite3',
                  'ws',
                  'bufferutil',
                  'utf-8-validate',
                  'node:fs',
                  'node:path',
                  'node:url',
                  'node:http',
                  'node:os',
                  'node:child_process',
                  'node:crypto',
                  'sharp',
                  'font-list',
                  'onnxruntime-node',
                ],
              },
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          vite: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: 'index.cjs',
                },
              },
            },
          },
        },
        renderer: {},
      }),
    ],
    clearScreen: false,
  };
});
