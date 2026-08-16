/**
 * BiRefNet 抠图适配器
 * 优先 tiny 1024×1024，其次 2K 1440×2560
 * 参考: https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import type { MattingAdapter, MattingInput, MattingResult } from '../types';
import { mattingError, MattingErrorCode } from '../types';
import { preprocessImageNet, maskToRgba, sigmoidToMask } from '../base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 与 spriteOnnxService 一致：打包后 __dirname=dist-electron/main
const MODELS_DIR = path.join(__dirname, '../../electron/models');
const MODELS_DIR_ALT = path.join(__dirname, '../models');

const TAG = '抠图';

const MODEL_PATHS = [
  { file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', w: 1024, h: 1024 },
  { file: 'BiRefNet_lite-general-2K-epoch_232.onnx', w: 1440, h: 2560 },
] as const;

let session: ort.InferenceSession | null = null;

function resolveModelPath(): { path: string; inputW: number; inputH: number } {
  for (const { file, w, h } of MODEL_PATHS) {
    const full = path.join(MODELS_DIR, file);
    const alt = path.join(MODELS_DIR_ALT, file);
    const p = fs.existsSync(full) ? full : fs.existsSync(alt) ? alt : null;
    if (p) return { path: p, inputW: w, inputH: h };
  }
  return {
    path: path.join(MODELS_DIR, MODEL_PATHS[0]!.file),
    inputW: 1024,
    inputH: 1024,
  };
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    const { path: modelPath } = resolveModelPath();
    if (!fs.existsSync(modelPath)) {
      throw new Error(`BiRefNet 模型未找到: ${modelPath}`);
    }
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  }
  return session;
}

export const birefnetAdapter: MattingAdapter = {
  id: 'birefnet',
  name: 'BiRefNet',
  tag: TAG,
  async run(input: MattingInput): Promise<MattingResult> {
    const { rgbData, width, height, channels } = input;
    if (!rgbData?.length || width <= 0 || height <= 0 || channels < 3) {
      return mattingError(MattingErrorCode.INVALID_INPUT, '无效的抠图输入');
    }
    try {
      const { inputW, inputH } = resolveModelPath();
      const sess = await getSession();
      const tensor = await preprocessImageNet(rgbData, width, height, channels, inputW, inputH);
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, inputH, inputW]);
      const result = await sess.run({ input_image: inputTensor });
      const out = result.output_image;
      if (!out) {
        return mattingError(MattingErrorCode.INFERENCE_FAILED, 'BiRefNet 无 output_image 输出');
      }
      const outData = out.data as Float32Array;
      const dims = (out as ort.Tensor).dims;
      const maskH = dims?.[2] ?? inputH;
      const maskW = dims?.[3] ?? inputW;
      const maskBuf = sigmoidToMask(outData, maskW * maskH);
      const rgba = maskToRgba(rgbData, width, height, channels, maskBuf, maskW, maskH);
      return { ok: true, rgba };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return mattingError(MattingErrorCode.INFERENCE_FAILED, `BiRefNet 推理失败: ${msg}`, stack);
    }
  },
};
