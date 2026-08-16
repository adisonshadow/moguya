/**
 * 形状线性渐变：角度（与 AngleDegreeControl 一致，0° 向右、90° 向下）→ Konva 起止点
 */
import { normalizeDeg } from '@/components/antd-plus/AngleDegreeControl';
import type { EditorShapeObject } from './editorTypes';

/** 旧文档仅有 gradientVertical；新文档用 gradientAngleDeg */
export function resolveShapeGradientAngleDeg(o: EditorShapeObject): number {
  if (typeof o.gradientAngleDeg === 'number' && Number.isFinite(o.gradientAngleDeg)) {
    return normalizeDeg(Math.round(o.gradientAngleDeg));
  }
  if (o.gradientVertical === true) return 90;
  return 0;
}

/** 形状局部坐标：左上 (0,0)，右下 (width,height) */
export function rectLocalGradientLine(
  width: number,
  height: number,
  angleDeg: number
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rad = (normalizeDeg(angleDeg) * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const d = Math.sqrt(width * width + height * height) / 2 + 0.001;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    start: { x: cx - c * d, y: cy - s * d },
    end: { x: cx + c * d, y: cy + s * d },
  };
}

/**
 * 与 Ellipse 一致：局部原点为图形中心，横向范围 [-w/2, w/2]，纵向 [-h/2, h/2]
 */
export function centeredGradientLine(fullWidth: number, fullHeight: number, angleDeg: number) {
  const rad = (normalizeDeg(angleDeg) * Math.PI) / 180;
  const d = Math.sqrt(fullWidth * fullWidth + fullHeight * fullHeight) / 2 + 0.001;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    start: { x: -c * d, y: -s * d },
    end: { x: c * d, y: s * d },
  };
}

/** 矩形局部坐标：圆心在框中心，半径覆盖到角点 */
export function rectLocalRadialGradient(width: number, height: number): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.sqrt(cx * cx + cy * cy) + 0.001;
  return { start: { x: cx, y: cy }, end: { x: cx + r, y: cy } };
}

/** Ellipse 局部：原点在图形中心，半径取 max(radiusX, radiusY) 以铺满 */
export function centeredRadialEllipse(radiusX: number, radiusY: number): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const r = Math.max(radiusX, radiusY) + 0.001;
  return { start: { x: 0, y: 0 }, end: { x: r, y: 0 } };
}

/** path 自然坐标系内的放射渐变（与 rectLocalRadialGradient 同理，用 naturalW×naturalH） */
export function naturalRectRadialGradient(nw: number, nh: number) {
  return rectLocalRadialGradient(nw, nh);
}
