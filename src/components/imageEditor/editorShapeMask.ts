/**
 * 用形状图层对图片做蒙版：按文档坐标合成后裁剪为形状旋转外接框
 */
import type { EditorImageObject, EditorShapeObject } from './editorTypes';
import { objectRotatedBounds } from './editorContentBounds';

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** 在已应用 translate(x,y)+rotate 的 ctx 上绘制形状白色填充（用于 destination-in） */
function fillShapeLocalWhite(ctx: CanvasRenderingContext2D, shape: EditorShapeObject) {
  const w = shape.width;
  const h = shape.height;
  ctx.fillStyle = '#ffffff';
  if (shape.geometryKind === 'rect') {
    const r = Math.min(shape.cornerRadius, w / 2, h / 2);
    ctx.beginPath();
    if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, w, h, r);
    else ctx.rect(0, 0, w, h);
    ctx.fill();
    return;
  }
  if (shape.geometryKind === 'circle') {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // 形状 path 蒙版仅依赖几何；与独立矢量图层 EditorPathObject 的 pattern 填充无关
  if (shape.geometryKind === 'path' && shape.pathData && shape.naturalW && shape.naturalH) {
    const nw = shape.naturalW;
    const nh = shape.naturalH;
    const psx = nw > 0 ? w / nw : 1;
    const psy = nh > 0 ? h / nh : 1;
    ctx.save();
    ctx.scale(psx, psy);
    const p = new Path2D(shape.pathData);
    ctx.fill(p, 'evenodd');
    ctx.restore();
    return;
  }
  ctx.fillRect(0, 0, w, h);
}

function drawEditorImageOnDocCtx(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  o: EditorImageObject
) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const c = o.sourceCrop;
  const sx = c ? c.x : 0;
  const sy = c ? c.y : 0;
  const sw = c ? c.width : nw;
  const sh = c ? c.height : nh;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate((o.rotation * Math.PI) / 180);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, o.width, o.height);
  ctx.restore();
}

export type ShapeMaskResult = {
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 将图片与形状按文档空间合成；透明区域保留 Alpha */
export async function renderShapeMaskedImagePng(
  imageObj: EditorImageObject,
  shapeObj: EditorShapeObject,
  docW: number,
  docH: number,
  pixelRatio = 1
): Promise<ShapeMaskResult | null> {
  if (docW < 1 || docH < 1) return null;
  const imgEl = await loadHtmlImage(imageObj.src);
  const pr = Math.max(1, Math.min(3, pixelRatio));
  const full = document.createElement('canvas');
  full.width = Math.ceil(docW * pr);
  full.height = Math.ceil(docH * pr);
  const fctx = full.getContext('2d');
  if (!fctx) return null;
  fctx.setTransform(pr, 0, 0, pr, 0, 0);
  fctx.clearRect(0, 0, docW, docH);
  drawEditorImageOnDocCtx(fctx, imgEl, imageObj);
  fctx.globalCompositeOperation = 'destination-in';
  fctx.save();
  fctx.translate(shapeObj.x, shapeObj.y);
  fctx.rotate((shapeObj.rotation * Math.PI) / 180);
  fillShapeLocalWhite(fctx, shapeObj);
  fctx.restore();
  fctx.globalCompositeOperation = 'source-over';

  const b = objectRotatedBounds(shapeObj);
  let cx = Math.max(0, Math.floor(b.minX));
  let cy = Math.max(0, Math.floor(b.minY));
  let cw = Math.min(docW - cx, Math.ceil(b.maxX - b.minX));
  let ch = Math.min(docH - cy, Math.ceil(b.maxY - b.minY));
  if (cw < 1 || ch < 1) return null;

  const out = document.createElement('canvas');
  out.width = Math.ceil(cw * pr);
  out.height = Math.ceil(ch * pr);
  const octx = out.getContext('2d');
  if (!octx) return null;
  // full 上内容按 setTransform(pr) 画在「文档逻辑坐标」里；drawImage 的源矩形必须是源画布的像素坐标
  const fsx = Math.max(0, Math.floor(cx * pr));
  const fsy = Math.max(0, Math.floor(cy * pr));
  const fsw = Math.min(full.width - fsx, Math.ceil(cw * pr));
  const fsh = Math.min(full.height - fsy, Math.ceil(ch * pr));
  if (fsw < 1 || fsh < 1) return null;
  octx.setTransform(pr, 0, 0, pr, 0, 0);
  octx.drawImage(full, fsx, fsy, fsw, fsh, 0, 0, cw, ch);
  const dataUrl = out.toDataURL('image/png');
  return { dataUrl, x: cx, y: cy, width: cw, height: ch };
}
