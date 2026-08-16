/**
 * MOSS-TTS-Nano：健康检查（嵌入式 python/env + mlx-audio）
 * 实际合成由 AI 模型服务内常驻 Python（127.0.0.1:54323）完成。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { TtsAdapter, TtsInput, TtsResult } from '../ttsTypes';
import { ttsError, TtsErrorCode } from '../ttsTypes';
import { resolveYimanEmbeddedPythonExe, yimanEmbeddedPythonReady } from '../pythonPaths';
import { diagnoseNanoModelRoot } from './mlxNanoModelPaths';

const TTS_TAG = '本地TTS';

export class MossTtsNanoLocalMlxAdapter implements TtsAdapter {
  readonly id = 'moss_tts_nano';
  readonly name = 'MOSS-TTS-Nano';
  readonly tag = TTS_TAG;

  constructor(public readonly modelPath: string) {}

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.modelPath?.trim() || !fs.existsSync(this.modelPath)) {
      return { ok: false, message: `模型目录不存在: ${this.modelPath}` };
    }
    const diag = diagnoseNanoModelRoot(this.modelPath);
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
      await this.execPython(
        ['-c', 'import mlx_audio; import mlx_audio.tts.models.moss_tts_nano'],
        60_000,
      );
    } catch (e) {
      return {
        ok: false,
        message: `mlx-audio 未正确安装，请在 python/env 中执行 pip install -r requirements.txt：${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    const weightsNote =
      diag.resolved !== diag.root
        ? `权重: ${diag.resolved}（自配置根目录 ${diag.root} 解析）`
        : `权重: ${diag.resolved}`;
    return {
      ok: true,
      message: `MOSS-TTS-Nano 检查通过 | ${weightsNote}（合成由 python/main.py --backend moss_nano 常驻）`,
    };
  }

  async run(_input: TtsInput): Promise<TtsResult> {
    return ttsError(
      TtsErrorCode.INFERENCE_FAILED,
      'MOSS-TTS-Nano 合成由 python/main.py 常驻服务处理，请通过 AI 模型服务调用',
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
