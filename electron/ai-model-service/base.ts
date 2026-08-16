/**
 * AI 模型服务 - 共享工具函数
 */
import sharp from 'sharp';

export const IMAGENET_MEAN = [0.485, 0.456, 0.406];
export const IMAGENET_STD = [0.229, 0.224, 0.225];

/**
 * ImageNet 归一化预处理：Resize 到指定尺寸，输出 NCHW Float32
 */
export async function preprocessImageNet(
  rgbData: Buffer,
  width: number,
  height: number,
  channels: number,
  inputW: number,
  inputH: number
): Promise<Float32Array> {
  const resized = await sharp(rgbData, {
    raw: { width, height, channels: channels as 1 | 2 | 3 | 4 },
  })
    .resize(inputW, inputH, { fit: 'fill' }) // fill=拉伸整图，避免 cover 裁剪导致 mask 与输入不对齐
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = resized.data;
  const outW = resized.info.width ?? inputW;
  const outH = resized.info.height ?? inputH;
  const ch = resized.info.channels ?? channels;
  const nPixels = outW * outH;
  const tensor = new Float32Array(1 * 3 * outH * outW);
  for (let i = 0; i < nPixels; i++) {
    const si = i * ch;
    const r = (data[si] ?? 0) / 255;
    const g = (data[si + 1] ?? 0) / 255;
    const b = (data[si + 2] ?? 0) / 255;
    tensor[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    tensor[nPixels + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    tensor[2 * nPixels + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return tensor;
}

/**
 * 将模型输出的 mask（任意尺寸）双线性插值回原图，并与 RGB 合成 RGBA
 * - 使用像素中心映射，避免边缘偏移
 * - 背景区（alpha≈0）强制 RGB=0，确保透明通道正确
 */
export function maskToRgba(
  rgbData: Buffer,
  width: number,
  height: number,
  channels: number,
  maskBuf: Uint8Array,
  maskW: number,
  maskH: number
): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 像素中心映射，避免边界偏移
      const fx = width > 1 ? ((x + 0.5) / width) * maskW - 0.5 : (maskW - 1) / 2;
      const fy = height > 1 ? ((y + 0.5) / height) * maskH - 0.5 : (maskH - 1) / 2;
      const sx0 = Math.max(0, Math.min(Math.floor(fx), maskW - 1));
      const sy0 = Math.max(0, Math.min(Math.floor(fy), maskH - 1));
      const sx1 = Math.min(sx0 + 1, maskW - 1);
      const sy1 = Math.min(sy0 + 1, maskH - 1);
      const wx = Math.max(0, Math.min(1, fx - sx0));
      const wy = Math.max(0, Math.min(1, fy - sy0));
      const m00 = maskBuf[sy0 * maskW + sx0] ?? 0;
      const m10 = maskBuf[sy0 * maskW + sx1] ?? 0;
      const m01 = maskBuf[sy1 * maskW + sx0] ?? 0;
      const m11 = maskBuf[sy1 * maskW + sx1] ?? 0;
      const maskVal = Math.round(
        m00 * (1 - wx) * (1 - wy) + m10 * wx * (1 - wy) + m01 * (1 - wx) * wy + m11 * wx * wy
      );
      const alpha = Math.max(0, Math.min(255, maskVal));
      const si = (y * width + x) * channels;
      const di = (y * width + x) * 4;
      if (alpha < 16) {
        // 背景区：透明通道，RGB 置 0 避免杂色
        rgba[di] = 0;
        rgba[di + 1] = 0;
        rgba[di + 2] = 0;
        rgba[di + 3] = 0;
      } else {
        rgba[di] = rgbData[si] ?? 0;
        rgba[di + 1] = rgbData[si + 1] ?? 0;
        rgba[di + 2] = rgbData[si + 2] ?? 0;
        rgba[di + 3] = alpha;
      }
    }
  }
  return rgba;
}

/**
 * 对 sigmoid 输出的 Float32 转为 0–255 的 mask
 */
export function sigmoidToMask(outData: Float32Array, len: number): Uint8Array {
  const maskBuf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const v = 1 / (1 + Math.exp(-outData[i]!));
    maskBuf[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  return maskBuf;
}

/**
 * 将 RGB Buffer 转为 NCHW Float32（0–1 归一化，无 ImageNet）
 */
export function imageToTensorRgb(
  data: Buffer,
  width: number,
  height: number,
  channels: number
): Float32Array {
  const tensor = new Float32Array(1 * 3 * height * width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * channels;
      const r = (data[srcIdx] ?? 0) / 255;
      const g = (data[srcIdx + 1] ?? 0) / 255;
      const b = (data[srcIdx + 2] ?? 0) / 255;
      const dstIdx = (y * width + x) * 3;
      tensor[dstIdx] = r;
      tensor[dstIdx + 1] = g;
      tensor[dstIdx + 2] = b;
    }
  }
  return tensor;
}

/**
 * 对 RGBA 的 alpha 通道做边缘保持平滑（类 rembg alpha matting）
 */
export function refineAlphaWithBilateral(
  rgba: Buffer,
  width: number,
  height: number,
  radius: number = 5,
  sigmaSpatial: number = 4,
  sigmaColor: number = 25
): void {
  const r = Math.min(radius, Math.floor(width / 2) - 1, Math.floor(height / 2) - 1);
  if (r < 1) return;
  const out = Buffer.alloc(rgba.length);
  rgba.copy(out);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumW = 0;
      let sumWAlpha = 0;
      const idx = (y * width + x) * 4;
      const r0 = rgba[idx] ?? 0;
      const g0 = rgba[idx + 1] ?? 0;
      const b0 = rgba[idx + 2] ?? 0;
      const a0 = (rgba[idx + 3] ?? 0) / 255;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const ny = Math.max(0, Math.min(height - 1, y + dy));
          const ni = (ny * width + nx) * 4;
          const rn = rgba[ni] ?? 0;
          const gn = rgba[ni + 1] ?? 0;
          const bn = rgba[ni + 2] ?? 0;
          const an = (rgba[ni + 3] ?? 0) / 255;
          const dSq = dx * dx + dy * dy;
          const cSq = (r0 - rn) ** 2 + (g0 - gn) ** 2 + (b0 - bn) ** 2;
          const w = Math.exp(-dSq / (2 * sigmaSpatial * sigmaSpatial) - cSq / (2 * sigmaColor * sigmaColor));
          sumW += w;
          sumWAlpha += w * an;
        }
      }
      const a = sumW > 1e-8 ? sumWAlpha / sumW : a0;
      out[idx + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  out.copy(rgba);
}
