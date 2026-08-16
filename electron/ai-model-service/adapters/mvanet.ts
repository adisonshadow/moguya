/**
 * MVANet 抠图适配器
 * 输入 1024×1024，input_image / output_image
 * 参考: https://github.com/hpc203/MVANet-BiRefNet-onnxrun
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

const INPUT_SIZE = 1024;
const TAG = '抠图';

let session: ort.InferenceSession | null = null;

function resolveModelPath(): string {
  const file = 'mvanet_1024x1024.onnx';
  const candidates = [path.join(MODELS_DIR, file), path.join(MODELS_DIR_ALT, file)];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]!;
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!session) {
    const modelPath = resolveModelPath();
    if (!fs.existsSync(modelPath)) {
      throw new Error(`MVANet 模型未找到: ${modelPath}`);
    }
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  }
  return session;
}

export const mvanetAdapter: MattingAdapter = {
  id: 'mvanet',
  name: 'MVANet',
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
      const outputName = sess.outputNames.find((n) => n === 'output_image') ?? sess.outputNames[0];
      if (!outputName || !result[outputName]) {
        return mattingError(
          MattingErrorCode.INFERENCE_FAILED,
          `MVANet 输出异常`,
          `可用输出: ${sess.outputNames.join(', ')}`
        );
      }
      const outData = result[outputName].data as Float32Array;
      const dims = (result[outputName] as ort.Tensor).dims;
      const maskH = dims?.[2] ?? INPUT_SIZE;
      const maskW = dims?.[3] ?? INPUT_SIZE;
      const maskBuf = sigmoidToMask(outData, maskW * maskH);
      const rgba = maskToRgba(rgbData, width, height, channels, maskBuf, maskW, maskH);
      return { ok: true, rgba };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return mattingError(MattingErrorCode.INFERENCE_FAILED, `MVANet 推理失败: ${msg}`, stack);
    }
  },
};
