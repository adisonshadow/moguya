/**
 * 画布毛玻璃：截取底层像素 → 高斯模糊 → 按形状裁剪（圆角矩形 / 椭圆 / SVG path）叠半透明白 + 描边
 */

function createGaussianKernel(radius: number): number[] {
  const r = Math.max(1, Math.min(32, Math.round(radius)));
  const sigma = r / 3;
  const kernel: number[] = [];
  let sum = 0;
  for (let x = -r; x <= r; x++) {
    const val = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(val);
    sum += val;
  }
  return kernel.map((v) => v / sum);
}

/** 分离卷积高斯模糊，就地修改 imageData */
export function gaussianBlurImageData(imageData: ImageData, radius: number): void {
  const r = Math.max(1, Math.min(32, Math.round(radius)));
  const pixels = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  if (width < 2 || height < 2) return;

  const temp = new Uint8ClampedArray(pixels.length);
  const kernel = createGaussianKernel(r);
  const len = kernel.length;
  const half = Math.floor(len / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      for (let k = -half; k <= half; k++) {
        const ix = Math.min(width - 1, Math.max(0, x + k));
        const i = (y * width + ix) * 4;
        const wk = kernel[k + half];
        rr += pixels[i] * wk;
        gg += pixels[i + 1] * wk;
        bb += pixels[i + 2] * wk;
        aa += pixels[i + 3] * wk;
      }
      const i = (y * width + x) * 4;
      temp[i] = rr;
      temp[i + 1] = gg;
      temp[i + 2] = bb;
      temp[i + 3] = aa;
    }
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      for (let k = -half; k <= half; k++) {
        const iy = Math.min(height - 1, Math.max(0, y + k));
        const i = (iy * width + x) * 4;
        const wk = kernel[k + half];
        rr += temp[i] * wk;
        gg += temp[i + 1] * wk;
        bb += temp[i + 2] * wk;
        aa += temp[i + 3] * wk;
      }
      const i = (y * width + x) * 4;
      pixels[i] = rr;
      pixels[i + 1] = gg;
      pixels[i + 2] = bb;
      pixels[i + 3] = aa;
    }
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function ellipsePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.closePath();
}

export type FrostedGlassComposeKind = 'rect' | 'circle' | 'path';

/**
 * 对「已含模糊前底图」的整幅截取 canvas 做高斯模糊，再按形状裁剪叠白与高光。
 * path：pathData 为 naturalW×naturalH 局部坐标下的 SVG d（与 Konva.Path 一致）
 */
export function composeBackdropFrostedTexture(options: {
  sourceCanvas: HTMLCanvasElement;
  blurRadiusPx: number;
  padPx: number;
  shapePxW: number;
  shapePxH: number;
  cornerRadiusLogical: number;
  shapeLogicalW: number;
  shapeLogicalH: number;
  kind: FrostedGlassComposeKind;
  frostedOpacity: number;
  pathData?: string;
  naturalW?: number;
  naturalH?: number;
}): HTMLCanvasElement {
  const {
    sourceCanvas,
    blurRadiusPx,
    padPx,
    shapePxW,
    shapePxH,
    cornerRadiusLogical,
    shapeLogicalW,
    shapeLogicalH,
    kind,
    frostedOpacity,
    pathData,
    naturalW: naturalWIn,
    naturalH: naturalHIn,
  } = options;

  const src = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!src) throw new Error('no 2d');

  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const img = src.getImageData(0, 0, sw, sh);
  gaussianBlurImageData(img, blurRadiusPx);
  src.putImageData(img, 0, 0);

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(shapeLogicalW));
  out.height = Math.max(1, Math.round(shapeLogicalH));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('no 2d');

  const sx = Math.max(0, Math.floor(padPx));
  const sy = Math.max(0, Math.floor(padPx));
  const cw = Math.min(shapePxW, sw - sx);
  const ch = Math.min(shapePxH, sh - sy);

  const whiteAlpha = Math.min(0.82, Math.max(0.06, frostedOpacity * 0.62));

  if (kind === 'path') {
    const nw = Math.max(1, naturalWIn ?? 100);
    const nh = Math.max(1, naturalHIn ?? 100);
    const pd = pathData?.trim();
    if (!pd) throw new Error('pathData required for path kind');

    let clipPath: Path2D;
    try {
      clipPath = new Path2D(pd);
    } catch {
      throw new Error('invalid pathData for Path2D');
    }

    ctx.save();
    ctx.scale(out.width / nw, out.height / nh);
    ctx.clip(clipPath, 'evenodd');
    ctx.drawImage(sourceCanvas, sx, sy, cw, ch, 0, 0, nw, nh);

    ctx.globalAlpha = whiteAlpha;
    ctx.fillStyle = '#ffffff';
    ctx.fill(clipPath, 'evenodd');
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(nw / out.width, nh / out.height);
    ctx.stroke(clipPath);
    ctx.restore();
    return out;
  }

  ctx.save();
  if (kind === 'rect') {
    const r = Math.min(cornerRadiusLogical, shapeLogicalW / 2, shapeLogicalH / 2);
    roundRectPath(ctx, 0, 0, out.width, out.height, r);
    ctx.clip();
  } else {
    ellipsePath(ctx, out.width / 2, out.height / 2, out.width / 2, out.height / 2);
    ctx.clip();
  }

  ctx.drawImage(sourceCanvas, sx, sy, cw, ch, 0, 0, out.width, out.height);

  ctx.globalAlpha = whiteAlpha;
  ctx.fillStyle = '#ffffff';
  if (kind === 'rect') {
    const r = Math.min(cornerRadiusLogical, shapeLogicalW / 2, shapeLogicalH / 2);
    roundRectPath(ctx, 0, 0, out.width, out.height, r);
    ctx.fill();
  } else {
    ellipsePath(ctx, out.width / 2, out.height / 2, out.width / 2, out.height / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  if (kind === 'rect') {
    const r = Math.min(cornerRadiusLogical, shapeLogicalW / 2, shapeLogicalH / 2);
    roundRectPath(ctx, 0.5, 0.5, out.width - 1, out.height - 1, r);
    ctx.stroke();
  } else {
    ellipsePath(ctx, out.width / 2, out.height / 2, out.width / 2 - 0.5, out.height / 2 - 0.5);
    ctx.stroke();
  }

  return out;
}
