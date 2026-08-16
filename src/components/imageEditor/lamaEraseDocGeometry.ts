/**
 * 文档坐标 → 源图像素（与 Konva Image + sourceCrop 一致）
 */
import type { EditorImageObject } from './editorTypes';
import { docPointToImageNorm } from './zoomBlurDocGeometry';

/** 命中源图矩形内则返回像素坐标 [0, NW)×[0, NH) */
export function docPointToSourcePixel(
  img: EditorImageObject,
  docX: number,
  docY: number
): { px: number; py: number } | null {
  const { nx, ny } = docPointToImageNorm(img, docX, docY);
  const NW = Math.max(1, img.naturalW ?? 1);
  const NH = Math.max(1, img.naturalH ?? 1);
  const sx = img.sourceCrop?.x ?? 0;
  const sy = img.sourceCrop?.y ?? 0;
  const sw = img.sourceCrop?.width ?? NW;
  const sh = img.sourceCrop?.height ?? NH;
  const px = sx + nx * sw;
  const py = sy + ny * sh;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  if (ix < 0 || iy < 0 || ix >= NW || iy >= NH) return null;
  return { px: ix, py: iy };
}
