/**
 * 图片编辑器：适合画布 / 适合内容 的布局计算
 */
import type { EditorImageObject } from './editorTypes';

/** 可见区域宽高比（宽/高），考虑 sourceCrop */
export function getImageIntrinsicAspectRatio(o: EditorImageObject): number {
  const { naturalW, naturalH, width, height, sourceCrop } = o;
  if (naturalW && naturalH && naturalW > 0 && naturalH > 0) {
    if (sourceCrop && sourceCrop.width > 0.5 && sourceCrop.height > 0.5) {
      return sourceCrop.width / sourceCrop.height;
    }
    return naturalW / naturalH;
  }
  if (height > 1e-6) return Math.max(0.01, width / height);
  return 1;
}

export function computeImageFitToCanvasLayout(
  docW: number,
  docH: number,
  pad: number,
  maintainAspect: boolean,
  aspectRatio: number
): { x: number; y: number; width: number; height: number } {
  const p = Math.max(0, pad);
  const innerW = Math.max(16, docW - 2 * p);
  const innerH = Math.max(16, docH - 2 * p);
  const ar = Math.max(0.01, aspectRatio);

  if (!maintainAspect) {
    return { x: p, y: p, width: innerW, height: innerH };
  }

  let nw: number;
  let nh: number;
  if (innerW / innerH > ar) {
    nh = innerH;
    nw = nh * ar;
  } else {
    nw = innerW;
    nh = nw / ar;
  }
  const x = p + (innerW - nw) / 2;
  const y = p + (innerH - nh) / 2;
  return { x, y, width: nw, height: nh };
}
