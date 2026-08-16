/**
 * RMBG-2 抠图适配器
 * BRIA Background Removal v2.0，基于 BiRefNet 架构
 * 输入 1024×1024 ImageNet 归一化；输出 alphas 或 output_image
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import type { MattingAdapter, MattingInput, MattingResult } from '../types';
import { mattingError, MattingErrorCode } from '../types';
import { preprocessImageNet, maskToRgba, sigmoidToMask } from '../base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '../../electron/models');
const MODELS_DIR_ALT = path.join(__dirname, '../models');

const INPUT_SIZE = 1024;
/** 优先 fp32（CPU 兼容性好）；fp16 在 CPU 上易触发 InsertedPrecisionFreeCast 等图优化错误 */
const MODEL_FILES = [
  'RMBG-2-Matting-model.onnx',           // FP32 版本（若有）
  'model.onnx',                          // briaai/RMBG-2.0 官方 fp32
  'RMBG-2-Matting-model_fp16.onnx',      // FP16（CPU 可能失败）
];
const TAG = '抠图';

let session: ort.InferenceSession | null = null;

function resolveModelPath(): string | null {
  for (const file of MODEL_FILES) {
    for (const base of [MODELS_DIR, MODELS_DIR_ALT]) {
      const p = path.join(base, file);
      if (fs.existsSync(p)) return p;
    }
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
      throw new Error(
        `RMBG-2 模型未找到。请将以下任一文件放到 electron/models/：${MODEL_FILES.join('、')}`
      );
    }
    // FP16 模型在 CPU 上易触发 InsertedPrecisionFreeCast 错误，禁用图优化规避
    const isFp16 = modelPath.includes('fp16');
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      ...(isFp16 && { graphOptimizationLevel: 'disabled' }),
    });
  }
  return session;
}

export const rmbg2Adapter: MattingAdapter = {
  id: 'rmbg2',
  name: 'RMBG-2',
  tag: TAG,
  async run(input: MattingInput): Promise<MattingResult> {
    const { rgbData, width, height, channels } = input;
    if (!rgbData?.length || width <= 0 || height <= 0 || channels < 3) {
      return mattingError(MattingErrorCode.INVALID_INPUT, '无效的抠图输入');
    }
    try {
      const sess = await getSession();
      const tensor = await preprocessImageNet(rgbData, width, height, channels, INPUT_SIZE, INPUT_SIZE);
      const inputName = sess.inputNames[0];
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const result = await sess.run({ [inputName]: inputTensor });
      const outputName =
        sess.outputNames.find((n) => n === 'alphas' || n === 'output_image') ?? sess.outputNames[0];
      if (!outputName || !result[outputName]) {
        return mattingError(
          MattingErrorCode.INFERENCE_FAILED,
          'RMBG-2 输出异常',
          `可用输出: ${sess.outputNames.join(', ')}`
        );
      }
      const outData = result[outputName].data as Float32Array;
      const dims = (result[outputName] as ort.Tensor).dims;
      const maskH = dims?.[2] ?? INPUT_SIZE;
      const maskW = dims?.[3] ?? INPUT_SIZE;
      const len = maskW * maskH;
      const maskBuf =
        outputName === 'alphas' ? clampToMask(outData, len) : sigmoidToMask(outData, len);
      const rgba = maskToRgba(rgbData, width, height, channels, maskBuf, maskW, maskH);
      return { ok: true, rgba };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return mattingError(MattingErrorCode.INFERENCE_FAILED, `RMBG-2 推理失败: ${msg}`, stack);
    }
  },
};
