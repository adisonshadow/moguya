/**
 * 图片编辑器：遮罩裁切 — 整图在文档中的外接框与裁切映射（见 docs/12-图片编辑功能设计.md）
 */

export type SourceCropRect = { x: number; y: number; width: number; height: number };

export type CropDocRect = { x: number; y: number; w: number; h: number };

/** 判断本次裁切框相对进入模式时是否被用户改动过 */
export function cropDocRectsApproxEqual(a: CropDocRect, b: CropDocRect, eps = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}

/**
 * 根据当前图层框 (ox,oy,ow,oh) 与 sourceCrop，求「整图源图」在文档中应占据的矩形 F：
 * UV (0..1) 与 F 线性对应，且当前可见区 (sourceCrop) 与图层框重合。
 */
export function getFullImageDisplayFrameInDoc(obj: {
  x: number;
  y: number;
  width: number;
  height: number;
  naturalW?: number;
  naturalH?: number;
  sourceCrop?: SourceCropRect;
}): CropDocRect {
  const ox = obj.x;
  const oy = obj.y;
  const ow = obj.width;
  const oh = obj.height;
  const NW = Math.max(1, obj.naturalW ?? 1);
  const NH = Math.max(1, obj.naturalH ?? 1);
  const sx = obj.sourceCrop?.x ?? 0;
  const sy = obj.sourceCrop?.y ?? 0;
  const sw = Math.max(1, obj.sourceCrop?.width ?? NW);
  const sh = Math.max(1, obj.sourceCrop?.height ?? NH);
  const u0 = sx / NW;
  const v0 = sy / NH;
  const du = Math.max(1e-9, sw / NW);
  const dv = Math.max(1e-9, sh / NH);
  const Fw = ow / du;
  const Fh = oh / dv;
  const Fx = ox - u0 * Fw;
  const Fy = oy - v0 * Fh;
  return { x: Fx, y: Fy, w: Fw, h: Fh };
}

/** 以 F 的中心为基准缩放（工具条「预览缩放」） */
export function applyZoomAroundCenter(F: CropDocRect, z: number): CropDocRect {
  const zz = Math.max(0.1, z);
  const cx = F.x + F.w / 2;
  const cy = F.y + F.h / 2;
  const nw = F.w * zz;
  const nh = F.h * zz;
  return { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
}

/** 文档中的裁切矩形 R 相对整图显示框 F（已与预览缩放合并）→ 源图 sourceCrop */
export function mapDocCropRectToSourceCrop(R: CropDocRect, F: CropDocRect, NW: number, NH: number): SourceCropRect {
  const nw = Math.max(1, NW);
  const nh = Math.max(1, NH);
  if (F.w < 1e-9 || F.h < 1e-9) {
    return { x: 0, y: 0, width: nw, height: nh };
  }
  let u0 = (R.x - F.x) / F.w;
  let v0 = (R.y - F.y) / F.h;
  let u1 = (R.x + R.w - F.x) / F.w;
  let v1 = (R.y + R.h - F.y) / F.h;
  u0 = Math.max(0, Math.min(1, u0));
  v0 = Math.max(0, Math.min(1, v0));
  u1 = Math.max(0, Math.min(1, u1));
  v1 = Math.max(0, Math.min(1, v1));
  if (u1 < u0) [u0, u1] = [u1, u0];
  if (v1 < v0) [v0, v1] = [v1, v0];
  const du = Math.max(1e-6, u1 - u0);
  const dv = Math.max(1e-6, v1 - v0);
  let sx = Math.round(u0 * nw);
  let sy = Math.round(v0 * nh);
  let sw = Math.max(1, Math.round(du * nw));
  let sh = Math.max(1, Math.round(dv * nh));
  sx = Math.min(sx, nw - 1);
  sy = Math.min(sy, nh - 1);
  sw = Math.min(sw, nw - sx);
  sh = Math.min(sh, nh - sy);
  return { x: sx, y: sy, width: sw, height: sh };
}

/** 进入遮罩时虚线框 = 当前图层显示区域（裁剪结果的位置与大小） */
export function getInitialCropDocRectFromLayer(o: { x: number; y: number; width: number; height: number }): CropDocRect {
  return { x: o.x, y: o.y, w: o.width, h: o.height };
}
