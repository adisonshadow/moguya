/**
 * AI 模型服务 - LongCat-AudioDiT TTS 适配器
 * 通过 Python 子进程调用 LongCat-AudioDiT 模型进行语音合成
 * 依赖: pip install mlx-audio soundfile numpy
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type { TtsAdapter, TtsInput, TtsResult } from '../ttsTypes';
import { ttsError, TtsErrorCode } from '../ttsTypes';
import { resolveYimanEmbeddedPythonExe, yimanEmbeddedPythonReady } from '../pythonPaths';

const TTS_TAG = '本地TTS';

function writeInferenceScript(text: string, modelPath: string, outputPath: string): string {
  const script = `# -*- coding: utf-8 -*-
"""LongCat-AudioDiT TTS inference script"""
import sys, json, os

MODEL_PATH = ${JSON.stringify(modelPath)}
OUTPUT_PATH = ${JSON.stringify(outputPath)}
TEXT = ${JSON.stringify(text)}

def main():
    try:
        from mlx_audio.tts.utils import load
        import soundfile as sf
        
        model = load(MODEL_PATH)
        # 检测语言：含中文字符则用 zh
        lang = 'zh' if any('\\u4e00' <= c <= '\\u9fff' for c in TEXT) else 'en'
        speed = float(os.environ.get('YIMAN_TTS_SPEED', '1.0'))
        result = next(model.generate(TEXT, lang_code=lang, speed=speed, steps=16, cfg_strength=4.0, split_text=False))
        sf.write(OUTPUT_PATH, result.audio, 24000)
        print(json.dumps({"ok": True, "output": OUTPUT_PATH}))
    except ImportError as e:
        print(json.dumps({"ok": False, "error": f"Missing dependency: {e}. Please run: pip install mlx-audio soundfile numpy"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
`;
  const tmpDir = fs.realpathSync(os.tmpdir());
  const scriptPath = path.join(tmpDir, `yiman_tts_infer_${Date.now()}.py`);
  fs.writeFileSync(scriptPath, script, 'utf-8');
  return scriptPath;
}

export class LongCatAudioDiTAdapter implements TtsAdapter {
  readonly id = 'longcat_audio_dit';
  readonly name = 'LongCat-AudioDiT';
  readonly tag = TTS_TAG;

  constructor(public readonly modelPath: string) {}

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (!this.modelPath || !fs.existsSync(this.modelPath)) {
      return { ok: false, message: `模型目录不存在: ${this.modelPath}` };
    }
    if (!yimanEmbeddedPythonReady()) {
      return {
        ok: false,
        message:
          '未找到 python/env：请在项目 python 目录下执行 python3 -m venv env 并 pip install -r requirements.txt',
      };
    }
    try {
      const version = await this.execPython(['--version']);
      return { ok: true, message: `嵌入式 Python ${version.trim()} | 模型: ${this.modelPath}` };
    } catch (e) {
      return { ok: false, message: `嵌入式 Python 不可用: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async run(input: TtsInput): Promise<TtsResult> {
    const text = (input.text ?? '').trim();
    if (!text) {
      return ttsError(TtsErrorCode.INVALID_TEXT, '文本为空');
    }

    const tmpDir = fs.realpathSync(os.tmpdir());
    const outputPath = path.join(tmpDir, `yiman_tts_out_${Date.now()}.wav`);
    const scriptPath = writeInferenceScript(text, this.modelPath, outputPath);

    try {
      const speed = input.options?.speed ?? 1.0;
      const stdout = await this.execPython([scriptPath], 300_000, { YIMAN_TTS_SPEED: String(speed) }); // 5分钟超时

      let result: { ok: boolean; output?: string; error?: string };
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        return ttsError(TtsErrorCode.INFERENCE_FAILED, 'Python 输出解析失败', stdout.slice(0, 500));
      }

      if (!result.ok) {
        return ttsError(TtsErrorCode.INFERENCE_FAILED, result.error ?? '推理失败');
      }

      const actualOutput = result.output ?? outputPath;
      if (!fs.existsSync(actualOutput)) {
        return ttsError(TtsErrorCode.INFERENCE_FAILED, '推理完成但未找到输出文件');
      }

      const audio = fs.readFileSync(actualOutput);

      try { fs.unlinkSync(actualOutput); } catch { /* ignore */ }

      return { ok: true, audio, format: 'wav' };
    } catch (e) {
      return ttsError(TtsErrorCode.INFERENCE_FAILED, `推理异常: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    }
  }

  private execPython(args: string[], timeoutMs = 30_000, extraEnv: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(resolveYimanEmbeddedPythonExe(), args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        env: { ...process.env, ...extraEnv },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      proc.on('error', (err) => {
        reject(new Error(`启动 Python 子进程失败: ${err.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Python 退出码 ${code}: ${stderr.slice(0, 500)}`));
        }
      });
    });
  }
}
