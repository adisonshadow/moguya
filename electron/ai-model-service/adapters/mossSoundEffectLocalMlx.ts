/**
 * MOSS-SoundEffect：健康检查（嵌入式 python/env + mlx-speech）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { diagnoseSfxModelRoot } from './mlxSfxModelPaths';
import { resolveYimanEmbeddedPythonExe, yimanEmbeddedPythonReady } from '../pythonPaths';

export async function mossSoundEffectHealthCheck(modelPath: string): Promise<{
  ok: boolean;
  message?: string;
}> {
  if (!modelPath?.trim() || !fs.existsSync(modelPath)) {
    return { ok: false, message: `模型目录不存在: ${modelPath}` };
  }
  const diag = diagnoseSfxModelRoot(modelPath);
  if (!diag.ok) {
    return { ok: false, message: diag.message };
  }
  if (!yimanEmbeddedPythonReady()) {
    return {
      ok: false,
      message:
        '未找到 python/env：请在项目 python 目录下执行 python3 -m venv env 并 pip install -r requirements.txt',
    };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(resolveYimanEmbeddedPythonExe(), ['-c', 'import mlx_speech; import mlx_speech.tts'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.slice(-800) || `退出码 ${code}`));
      });
    });
  } catch (e) {
    return {
      ok: false,
      message: `mlx-speech 未正确安装：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const weightsNote =
    diag.resolved !== diag.root
      ? `权重: ${diag.resolved}（自 ${diag.root} 解析）`
      : `权重: ${diag.resolved}`;
  return {
    ok: true,
    message: `MOSS-SoundEffect 检查通过 | ${weightsNote}（合成由 sfx_main.py 常驻）`,
  };
}
