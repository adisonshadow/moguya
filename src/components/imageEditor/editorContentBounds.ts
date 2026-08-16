/**
 * 图片编辑器：计算图层在文档中的轴对齐外接框（旋转按 Konva 默认：绕左上角 x,y）
 */
import type { EditorObject } from './editorTypes';

function rotatePoint(px: number, py: number, ox: number, oy: number, rotationDeg: number) {
  if (Math.abs(rotationDeg) < 1e-6) return { x: px, y: py };
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - ox;
  const dy = py - oy;
  return { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos };
}

export function objectRotatedBounds(o: EditorObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const { x, y, width: w, height: h, rotation } = o;
  const px = x;
  const py = y;
  const pts = [
    rotatePoint(x, y, px, py, rotation),
    rotatePoint(x + w, y, px, py, rotation),
    rotatePoint(x + w, y + h, px, py, rotation),
    rotatePoint(x, y + h, px, py, rotation),
  ];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** 所有对象并集外接框 */
export function getEditorObjectsDocBounds(objects: EditorObject[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} | null {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const b = objectRotatedBounds(o);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1 || height < 1) return null;
  return { minX, minY, maxX, maxY, width, height };
}
