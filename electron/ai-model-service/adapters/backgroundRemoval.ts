/**
 * Background Removal 抠图适配器
 * 模型文件：electron/models/background-removal.onnx
 * 输入 1200×1800 ImageNet 归一化；输出单通道 mask（0–1）
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import type { MattingAdapter, MattingInput, MattingResult } from '../types';
import { mattingError, MattingErrorCode } from '../types';
import { preprocessImageNet, maskToRgba } from '../base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '../../electron/models');
const MODELS_DIR_ALT = path.join(__dirname, '../models');
const MODEL_FILE = 'background-removal.onnx';

const INPUT_H = 1200;
const INPUT_W = 1800;
const TAG = '抠图';

let session: ort.InferenceSession | null = null;

function resolveModelPath(): string | null {
  for (const base of [MODELS_DIR, MODELS_DIR_ALT]) {
    const p = path.join(base, MODEL_FILE);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function clampToMask(outData: Float32Array, len: number): Uint8Array {
  const maskBuf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    maskBuf[i] = Math.round(Math.max(0, Math.min(1, outData[i] ?? 0)) * 255);
  }
  return maskBuf;
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    const modelPath = resolveModelPath();
    if (!modelPath) {
      throw new Error(`Background Removal 模型未找到。请将 ${MODEL_FILE} 放到 electron/models/`);
    }
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  }
  return session;
}

export const backgroundRemovalAdapter: MattingAdapter = {
  id: 'background-removal',
  name: 'Background Removal',
  tag: TAG,
  async run(input: MattingInput): Promise<MattingResult> {
    const { rgbData, width, height, channels } = input;
    if (!rgbData?.length || width <= 0 || height <= 0 || channels < 3) {
      return mattingError(MattingErrorCode.INVALID_INPUT, '无效的抠图输入');
    }
    try {
      const sess = await getSession();
      const tensor = await preprocessImageNet(rgbData, width, height, channels, INPUT_W, INPUT_H);
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_H, INPUT_W]);
      const result = await sess.run({ input: inputTensor });
      const out = result.output;
      if (!out) {
        return mattingError(
          MattingErrorCode.INFERENCE_FAILED,
          'Background Removal 输出异常',
          `可用输出: ${sess.outputNames.join(', ')}`
        );
      }
      const outData = out.data as Float32Array;
      const dims = (out as ort.Tensor).dims;
      const maskH = dims?.[2] ?? INPUT_H;
      const maskW = dims?.[3] ?? INPUT_W;
      const maskBuf = clampToMask(outData, maskW * maskH);
      const rgba = maskToRgba(rgbData, width, height, channels, maskBuf, maskW, maskH);
      return { ok: true, rgba };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return mattingError(MattingErrorCode.INFERENCE_FAILED, `Background Removal 推理失败: ${msg}`, stack);
    }
  },
};
