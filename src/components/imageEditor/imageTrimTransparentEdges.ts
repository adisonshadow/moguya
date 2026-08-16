/**
 * 图片图层：按 Alpha 裁掉四周全透明区域（不修改 src，仅改 sourceCrop 与画布几何，可 undo）
 */
import type { EditorImageObject } from './editorTypes';

const DEFAULT_PADDING = 10;
/** 视为「非全透明」的最小 Alpha（0–255） */
const DEFAULT_ALPHA_THRESHOLD = 1;

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export type TrimTransparentEdgesPatch = Pick<EditorImageObject, 'x' | 'y' | 'width' | 'height' | 'sourceCrop'>;

export type TrimTransparentEdgesResult =
  | { ok: true; patch: TrimTransparentEdgesPatch }
  | { ok: false; reason: string };

/**
 * 在当前图层所用的源图矩形内扫描 Alpha，得到「内容 + padding」外接矩形，并换算为新的
 * x/y/width/height 与 sourceCrop（原图文件不变）。
 */
export async function computeImageTrimTransparentPaddingPatch(
  o: EditorImageObject,
  options?: { paddingPx?: number; alphaThreshold?: number }
): Promise<TrimTransparentEdgesResult> {
  const pad = Math.max(0, Math.round(options?.paddingPx ?? DEFAULT_PADDING));
  const alphaThr = Math.min(255, Math.max(0, options?.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD));

  let img: HTMLImageElement;
  try {
    img = await loadHtmlImage(o.src);
  } catch {
    return { ok: false, reason: '图片加载失败' };
  }

  const NW = Math.max(1, img.naturalWidth);
  const NH = Math.max(1, img.naturalHeight);

  const baseX = Math.round(o.sourceCrop?.x ?? 0);
  const baseY = Math.round(o.sourceCrop?.y ?? 0);
  const srcW = Math.max(1, Math.round(o.sourceCrop?.width ?? NW));
  const srcH = Math.max(1, Math.round(o.sourceCrop?.height ?? NH));

  if (baseX < 0 || baseY < 0 || baseX + srcW > NW || baseY + srcH > NH) {
    return { ok: false, reason: '图层源区域超出图像范围' };
  }

  const canvas = document.createElement('canvas');
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: '无法创建画布上下文' };

  ctx.drawImage(img, baseX, baseY, srcW, srcH, 0, 0, srcW, srcH);
  const data = ctx.getImageData(0, 0, srcW, srcH).data;

  let minX = srcW;
  let minY = srcH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < srcH; y++) {
    const row = y * srcW * 4;
    for (let x = 0; x < srcW; x++) {
      const a = data[row + x * 4 + 3];
      if (a > alphaThr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return { ok: false, reason: '所选区域内没有不透明像素' };
  }

  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(srcW - 1, maxX + pad);
  const bottom = Math.min(srcH - 1, maxY + pad);
  const newSrcW = right - left + 1;
  const newSrcH = bottom - top + 1;

  if (newSrcW < 1 || newSrcH < 1) {
    return { ok: false, reason: '裁剪结果无效' };
  }

  const scaleX = o.width / srcW;
  const scaleY = o.height / srcH;

  const newX = o.x + left * scaleX;
  const newY = o.y + top * scaleY;
  const newW = Math.max(1, newSrcW * scaleX);
  const newH = Math.max(1, newSrcH * scaleY);

  if (
    left === 0 &&
    top === 0 &&
    newSrcW === srcW &&
    newSrcH === srcH &&
    Math.abs(newW - o.width) < 1e-6 &&
    Math.abs(newH - o.height) < 1e-6
  ) {
    return { ok: false, reason: '没有可移除的透明边' };
  }

  const patch: TrimTransparentEdgesPatch = {
    x: Math.round(newX * 1000) / 1000,
    y: Math.round(newY * 1000) / 1000,
    width: Math.round(newW * 1000) / 1000,
    height: Math.round(newH * 1000) / 1000,
    sourceCrop: {
      x: baseX + left,
      y: baseY + top,
      width: newSrcW,
      height: newSrcH,
    },
  };

  return { ok: true, patch };
}
