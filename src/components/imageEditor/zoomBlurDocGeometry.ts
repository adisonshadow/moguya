/**
 * 图片图层局部归一化坐标 ⟷ 文档坐标（与 Konva Image：先绕左上角旋转再平移 一致）
 */
import type { EditorImageObject } from './editorTypes';

type ImgGeom = Pick<EditorImageObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** 文档点 → 图层局部 [0,1]×[0,1]，越界则钳制到边内 */
export function docPointToImageNorm(img: ImgGeom, docX: number, docY: number): { nx: number; ny: number } {
  const rad = (img.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = docX - img.x;
  const dy = docY - img.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const nx = Math.max(0, Math.min(1, lx / img.width));
  const ny = Math.max(0, Math.min(1, ly / img.height));
  return { nx, ny };
}

/** 图层局部 [0,1]×[0,1] → 文档点（通常为缩放原点） */
export function imageNormToDocPoint(img: ImgGeom, nx: number, ny: number): { x: number; y: number } {
  const lx = Math.max(0, Math.min(1, nx)) * img.width;
  const ly = Math.max(0, Math.min(1, ny)) * img.height;
  const rad = (img.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rdx = lx * cos - ly * sin;
  const rdy = lx * sin + ly * cos;
  return { x: img.x + rdx, y: img.y + rdy };
}
