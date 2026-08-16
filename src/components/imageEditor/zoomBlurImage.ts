/**
 * 缩放模糊（径向）：自原点沿半径方向采样混合，近似「变焦曝光」效果
 */

export type ZoomBlurSourceCrop = { x: number; y: number; width: number; height: number };

/** 径向采样步数上限：与 UI 滑块一致 */
export const ZOOM_BLUR_SAMPLE_STEPS_MIN = 12;
export const ZOOM_BLUR_SAMPLE_STEPS_MAX = 256;
export const ZOOM_BLUR_SAMPLE_STEPS_DEFAULT = 160;

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

function sampleBilinear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number
): [number, number, number, number] {
  if (w < 1 || h < 1) return [0, 0, 0, 0];
  const xf = Math.max(0, Math.min(w - 1.0001, x));
  const yf = Math.max(0, Math.min(h - 1.0001, y));
  const x0 = Math.floor(xf);
  const y0 = Math.floor(yf);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = xf - x0;
  const fy = yf - y0;
  const idx = (yy: number, xx: number) => (yy * w + xx) * 4;
  const i00 = idx(y0, x0);
  const i10 = idx(y0, x1);
  const i01 = idx(y1, x0);
  const i11 = idx(y1, x1);
  const r =
    data[i00]! * (1 - fx) * (1 - fy) +
    data[i10]! * fx * (1 - fy) +
    data[i01]! * (1 - fx) * fy +
    data[i11]! * fx * fy;
  const g =
    data[i00 + 1]! * (1 - fx) * (1 - fy) +
    data[i10 + 1]! * fx * (1 - fy) +
    data[i01 + 1]! * (1 - fx) * fy +
    data[i11 + 1]! * fx * fy;
  const b =
    data[i00 + 2]! * (1 - fx) * (1 - fy) +
    data[i10 + 2]! * fx * (1 - fy) +
    data[i01 + 2]! * (1 - fx) * fy +
    data[i11 + 2]! * fx * fy;
  const a =
    data[i00 + 3]! * (1 - fx) * (1 - fy) +
    data[i10 + 3]! * fx * (1 - fy) +
    data[i01 + 3]! * (1 - fx) * fy +
    data[i11 + 3]! * fx * fy;
  return [r, g, b, a];
}

/** sRGB 字节 → 线性光 0…1（混合后再压回 sRGB，减轻暗部发灰、条带） */
function srgbByteToLinear(u255: number): number {
  const c = u255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgbByte(l: number): number {
  const cl = l <= 0 ? 0 : l >= 1 ? 1 : l;
  const u = cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(u * 255)));
}

/**
 * @param originXN originYN 相对当前处理图宽高的 0…1（左上为 0,0）
 * @param radiusPercent 0…100，越大径向拖影越长
 * @param sampleStepsMax 每条射线采样步数上限（越大越细腻、越慢）；默认见 ZOOM_BLUR_SAMPLE_STEPS_DEFAULT
 * @param maxSide 若设置，长边不超过此像素（用于实时预览）
 */
export async function renderZoomBlurDataUrl(
  imageSrc: string,
  options: {
    originXN: number;
    originYN: number;
    radiusPercent: number;
    sourceCrop?: ZoomBlurSourceCrop;
    /** 径向积分步数上限（与工具条「采样步数」一致） */
    sampleStepsMax?: number;
    maxSide?: number;
  }
): Promise<string> {
  const img = await loadHtmlImage(imageSrc);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw < 1 || nh < 1) throw new Error('图片尺寸无效');

  const c = options.sourceCrop;
  const sx = c && c.width > 0.5 && c.height > 0.5 ? c.x : 0;
  const sy = c && c.width > 0.5 && c.height > 0.5 ? c.y : 0;
  const sw = c && c.width > 0.5 && c.height > 0.5 ? c.width : nw;
  const sh = c && c.width > 0.5 && c.height > 0.5 ? c.height : nh;

  let w = Math.max(1, Math.round(sw));
  let h = Math.max(1, Math.round(sh));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d');
  if (!wctx) throw new Error('Canvas 不可用');
  wctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

  const maxSide = options.maxSide;
  if (maxSide != null && maxSide > 8) {
    const scale = Math.min(1, maxSide / Math.max(w, h));
    if (scale < 1) {
      const nw2 = Math.max(1, Math.round(w * scale));
      const nh2 = Math.max(1, Math.round(h * scale));
      const tmp = document.createElement('canvas');
      tmp.width = nw2;
      tmp.height = nh2;
      const tctx = tmp.getContext('2d');
      if (!tctx) throw new Error('Canvas 不可用');
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(work, 0, 0, w, h, 0, 0, nw2, nh2);
      w = nw2;
      h = nh2;
      wctx.canvas.width = w;
      wctx.canvas.height = h;
      wctx.drawImage(tmp, 0, 0);
    }
  }

  const imageData = wctx.getImageData(0, 0, w, h);
  const src = imageData.data;
  const out = wctx.createImageData(w, h);
  const dst = out.data;

  const cx = Math.max(0, Math.min(1, options.originXN)) * (w - 1);
  const cy = Math.max(0, Math.min(1, options.originYN)) * (h - 1);
  const rp = Math.max(0, Math.min(100, options.radiusPercent));
  const fullQuality = options.maxSide == null;
  const defaultCap = fullQuality ? ZOOM_BLUR_SAMPLE_STEPS_DEFAULT : 72;
  const maxSteps = Math.min(
    ZOOM_BLUR_SAMPLE_STEPS_MAX,
    Math.max(
      ZOOM_BLUR_SAMPLE_STEPS_MIN,
      Math.round(options.sampleStepsMax ?? defaultCap)
    )
  );
  const minSteps = ZOOM_BLUR_SAMPLE_STEPS_MIN;
  /** 沿射线每像素约多少采样点；过低会出现径向条纹与杂色块 */
  const samplesPerPixel = fullQuality ? 0.82 : 0.4;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vx = x - cx;
      const vy = y - cy;
      const dist = Math.hypot(vx, vy);
      const oi = (y * w + x) * 4;
      if (dist < 0.5) {
        dst[oi] = src[oi]!;
        dst[oi + 1] = src[oi + 1]!;
        dst[oi + 2] = src[oi + 2]!;
        dst[oi + 3] = src[oi + 3]!;
        continue;
      }
      const ux = vx / dist;
      const uy = vy / dist;
      const extent = dist * (1 + (rp / 100) * 1.65);
      const steps = Math.min(maxSteps, Math.max(minSteps, Math.ceil(extent * samplesPerPixel)));
      let lr = 0;
      let lg = 0;
      let lb = 0;
      let la = 0;
      for (let i = 0; i < steps; i++) {
        const t = steps === 1 ? 0 : (i / (steps - 1)) * extent;
        const sx_ = cx + ux * t;
        const sy_ = cy + uy * t;
        const p = sampleBilinear(src, w, h, sx_, sy_);
        lr += srgbByteToLinear(p[0]!);
        lg += srgbByteToLinear(p[1]!);
        lb += srgbByteToLinear(p[2]!);
        la += p[3]! / 255;
      }
      const inv = 1 / steps;
      dst[oi] = linearToSrgbByte(lr * inv);
      dst[oi + 1] = linearToSrgbByte(lg * inv);
      dst[oi + 2] = linearToSrgbByte(lb * inv);
      dst[oi + 3] = Math.min(255, Math.max(0, Math.round(la * inv * 255)));
    }
  }

  wctx.putImageData(out, 0, 0);
  return work.toDataURL('image/png');
}
