/**
 * RVM（Robust Video Matting）抠图适配器
 * 输入 RGB 0–1 归一化；支持 downsampleRatio；过小输入会放大到 MIN_RVM_DIM
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import type { MattingAdapter, MattingInput, MattingResult } from '../types';
import { mattingError, MattingErrorCode } from '../types';
import { imageToTensorRgb } from '../base';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '../../electron/models');
const MODELS_DIR_ALT = path.join(__dirname, '../models');

const MIN_RVM_DIM = 512;
const TAG = '抠图';

let session: ort.InferenceSession | null = null;

function resolveModelPath(): string {
  const candidates = [
    path.join(MODELS_DIR_ALT, 'rvm_mobilenetv3_fp32.onnx'),
    path.join(MODELS_DIR, 'rvm_mobilenetv3_fp32.onnx'),
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
      throw new Error(`RVM 模型未找到: ${modelPath}`);
    }
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  }
  return session;
}

export const rvmAdapter: MattingAdapter = {
  id: 'rvm',
  name: 'RVM',
  tag: TAG,
  async run(input: MattingInput): Promise<MattingResult> {
    const { rgbData, width, height, channels, options } = input;
    if (!rgbData?.length || width <= 0 || height <= 0 || channels < 3) {
      return mattingError(MattingErrorCode.INVALID_INPUT, '无效的抠图输入');
    }
    const downsampleRatio = (options?.downsampleRatio as number) ?? 0.5;

    try {
      let w = width;
      let h = height;
      let data = rgbData;

      const minDim = Math.min(w, h);
      if (minDim < MIN_RVM_DIM) {
        const scale = MIN_RVM_DIM / minDim;
        const newW = Math.round(w * scale);
        const newH = Math.round(h * scale);
        const resized = await sharp(rgbData, {
          raw: { width: w, height: h, channels: channels as 1 | 2 | 3 | 4 },
        })
          .resize(newW, newH)
          .raw()
          .toBuffer({ resolveWithObject: true });
        data = resized.data;
        w = resized.info.width ?? newW;
        h = resized.info.height ?? newH;
      }

      const sess = await getSession();
      const srcTensor = new ort.Tensor('float32', imageToTensorRgb(data, w, h, channels), [1, 3, h, w]);
      const rec = new ort.Tensor('float32', new Float32Array([0]), [1, 1, 1, 1]);
      const dr = new ort.Tensor('float32', new Float32Array([downsampleRatio]), [1]);

      const result = await sess.run({
        src: srcTensor,
        r1i: rec,
        r2i: rec,
        r3i: rec,
        r4i: rec,
        downsample_ratio: dr,
      });

      const pha = result.pha.data as Float32Array;
      const fgr = result.fgr.data as Float32Array;
      const outW = w;
      const outH = h;

      const rgba = Buffer.alloc(outW * outH * 4);
      for (let i = 0; i < outW * outH; i++) {
        rgba[i * 4] = Math.round(Math.max(0, Math.min(1, fgr[i * 3]!)) * 255);
        rgba[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, fgr[i * 3 + 1]!)) * 255);
        rgba[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, fgr[i * 3 + 2]!)) * 255);
        rgba[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, pha[i]!)) * 255);
      }

      if (outW !== width || outH !== height) {
        const resized = await sharp(rgba, {
          raw: { width: outW, height: outH, channels: 4, premultiplied: false },
        })
          .resize(width, height)
          .raw()
          .toBuffer();
        return { ok: true, rgba: resized };
      }
      return { ok: true, rgba };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      return mattingError(MattingErrorCode.INFERENCE_FAILED, `RVM 推理失败: ${msg}`, stack);
    }
  },
};
