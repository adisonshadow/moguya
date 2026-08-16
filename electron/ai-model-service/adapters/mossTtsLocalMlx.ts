/**
 * MOSS-TTS：健康检查（嵌入式 python/env + mlx-speech）
 * 实际合成由 AI 模型服务内常驻 Python（127.0.0.1:54322）完成。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { TtsAdapter, TtsInput, TtsResult } from '../ttsTypes';
import { ttsError, TtsErrorCode } from '../ttsTypes';
import { resolveYimanEmbeddedPythonExe, yimanEmbeddedPythonReady } from '../pythonPaths';

const TTS_TAG = '本地TTS';

function resolveMlxWeightsDir(modelRoot: string): string {
  const int8 = path.join(modelRoot, 'mlx-int8');
  return fs.existsSync(int8) ? int8 : modelRoot;
}

export class MossTtsLocalMlxAdapter implements TtsAdapter {
  readonly id = 'moss_tts';
  readonly name = 'MOSS-TTS';
  readonly tag = TTS_TAG;

  constructor(public readonly modelPath: string) {}

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.modelPath?.trim() || !fs.existsSync(this.modelPath)) {
      return { ok: false, message: `模型目录不存在: ${this.modelPath}` };
    }
    if (!yimanEmbeddedPythonReady()) {
      return {
        ok: false,
        message:
          '未找到 python/env：请在项目 python 目录下执行 python3 -m venv env 并 pip install -r requirements.txt',
      };
    }
    const weights = resolveMlxWeightsDir(this.modelPath);
    if (!fs.existsSync(weights)) {
      return { ok: false, message: `未找到权重目录: ${weights}` };
    }
    try {
      await this.execPython(['-c', 'import mlx_speech; import mlx_speech.models.moss_local'], 60_000);
    } catch (e) {
      return {
        ok: false,
        message: `mlx-speech 未正确安装，请在 python/env 中执行 pip install -r requirements.txt：${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    return {
      ok: true,
      message: `MOSS 检查通过 | 权重: ${weights}（合成由 python/main.py --backend moss 常驻）`,
    };
  }

  async run(_input: TtsInput): Promise<TtsResult> {
    return ttsError(
      TtsErrorCode.INFERENCE_FAILED,
      'MOSS 合成由 python/main.py 常驻服务处理，请通过 AI 模型服务调用',
    );
  }

  private execPython(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(resolveYimanEmbeddedPythonExe(), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        env: { ...process.env },
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
  }
}
