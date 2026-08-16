/**
 * 项目根目录下 python/env 嵌入式解释器路径（与 python/main.py 配套）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 本文件位于 electron/ai-model-service 或打包后的 dist-electron/ai-server */
export function resolveYimanRepoRoot(): string {
  return path.resolve(__dirname, '../..');
}

export function resolveYimanPythonDir(): string {
  return path.join(resolveYimanRepoRoot(), 'python');
}

export function resolveYimanEmbeddedPythonExe(): string {
  const dir = resolveYimanPythonDir();
  return process.platform === 'win32'
    ? path.join(dir, 'env', 'Scripts', 'python.exe')
    : path.join(dir, 'env', 'bin', 'python3');
}

export function resolveYimanTtsMainPy(): string {
  return path.join(resolveYimanPythonDir(), 'main.py');
}

export function resolveYimanSfxMainPy(): string {
  return path.join(resolveYimanPythonDir(), 'sfx_main.py');
}

export function yimanEmbeddedPythonReady(): boolean {
  return fs.existsSync(resolveYimanEmbeddedPythonExe());
}
