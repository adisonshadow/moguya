/**
 * U2NetP 抠图适配器
 * 输入 320×320 ImageNet 归一化；输出 d0 sigmoid mask；可选 alpha matting 边缘细化
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import type { MattingAdapter, MattingInput, MattingResult } from '../types';
import { mattingError, MattingErrorCode } from '../types';
import { preprocessImageNet, maskToRgba, sigmoidToMask, refineAlphaWithBilateral } from '../base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '../../electron/models');
const MODELS_DIR_ALT = path.join(__dirname, '../models');

const INPUT_SIZE = 320;
const TAG = '抠图';

let session: ort.InferenceSession | null = null;

function resolveModelPath(): string {
  const candidates = [
    path.join(MODELS_DIR, 'u2netp.onnx'),
    path.join(MODELS_DIR_ALT, 'u2netp.onnx'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]!;
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    const modelPath = resolveModelPath();
    if (!fs.existsSync(modelPath)) {
      throw new Error(`U2NetP 模型未找到: ${modelPath}`);
    }
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  }
  return session;
}

export const u2netpAdapter: MattingAdapter = {
  id: 'u2netp',
  name: 'U2NetP',
  tag: TAG,
  async run(input: MattingInput): Promise<MattingResult> {
    const { rgbData, width, height, channels, options } = input;
    if (!rgbData?.length || width <= 0 || height <= 0 || channels < 3) {
      return mattingError(MattingErrorCode.INVALID_INPUT, '无效的抠图输入');
    }
    const alphaMatting = (options?.u2netpAlphaMatting as boolean) ?? false;

    try {
      const sess = await getSession();
      const tensor = await preprocessImageNet(rgbData, width, height, channels, INPUT_SIZE, INPUT_SIZE);
      const inputName = sess.inputNames[0];
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const result = await sess.run({ [inputName]: inputTensor });
      const outputName = sess.outputNames.find((n) => n === 'd0') ?? sess.outputNames[0];
      if (!outputName || !result[outputName]) {
        return mattingError(
          MattingErrorCode.INFERENCE_FAILED,
          'U2NetP 输出异常',
          `可用输出: ${sess.outputNames.join(', ')}`
        );
      }
      const outData = result[outputName].data as Float32Array;
      const dims = (result[outputName] as ort.Tensor).dims;
      const maskH = dims?.[2] ?? INPUT_SIZE;
      const maskW = dims?.[3] ?? INPUT_SIZE;
      const maskBuf = sigmoidToMask(outData, maskW * maskH);
      let rgba = maskToRgba(rgbData, width, height, channels, maskBuf, maskW, maskH);
      if (alphaMatting) {
        refineAlphaWithBilateral(rgba, width, height, 3, 3, 20);
      }
      return { ok: true, rgba };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return mattingError(MattingErrorCode.INFERENCE_FAILED, `U2NetP 推理失败: ${msg}`, stack);
    }
  },
};
