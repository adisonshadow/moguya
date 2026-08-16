/**
 * 在位图与 path 局部坐标系一致的前提下，对 path 内（evenodd）像素求加权平均色，作为「主色」近似。
 * 通过腐蚀 mask 剔除边缘像素，避免锯齿和羽化影响取色结果。
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load'));
    img.src = src;
  });
}

/**
 * 对 mask 做形态学腐蚀，去掉边缘像素
 * @param maskData mask 的 RGBA 数据（只取 R 通道，非零为前景）
 * @param w 宽度
 * @param h 高度
 * @param passes 腐蚀次数（每次去掉约 1 像素边缘）
 */
function erodeMask(maskData: Uint8ClampedArray, w: number, h: number, passes: number): void {
  if (passes <= 0) return;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i++) {
    binary[i] = maskData[i * 4]! > 0 ? 1 : 0;
  }
  const tmp = new Uint8Array(w * h);
  for (let pass = 0; pass < passes; pass++) {
    tmp.fill(0);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        if (binary[idx] === 0) continue;
        if (
          binary[idx - 1] === 0 ||
          binary[idx + 1] === 0 ||
          binary[idx - w] === 0 ||
          binary[idx + w] === 0
        ) {
          continue;
        }
        tmp[idx] = 1;
      }
    }
    binary.set(tmp);
  }
  for (let i = 0; i < binary.length; i++) {
    maskData[i * 4] = binary[i]! * 255;
    maskData[i * 4 + 1] = binary[i]! * 255;
    maskData[i * 4 + 2] = binary[i]! * 255;
    maskData[i * 4 + 3] = binary[i]! * 255;
  }
}

/**
 * 计算合适的腐蚀次数：基于图形尺寸自适应
 * 小图形少腐蚀，大图形多腐蚀
 */
function calcErosionPasses(w: number, h: number): number {
  const minDim = Math.min(w, h);
  if (minDim < 20) return 1;
  if (minDim < 50) return 2;
  if (minDim < 100) return 3;
  if (minDim < 200) return 4;
  return 5;
}

/**
 * @param imageSrc data URL 或同源 URL
 * @param pathD SVG path d，坐标系 0…w, 0…h
 * @param erosionPasses 腐蚀次数（剔除边缘像素层数），默认自适应
 */
export async function dominantRgbCssFromImageAndPath(
  imageSrc: string,
  pathD: string,
  w: number,
  h: number,
  erosionPasses?: number
): Promise<string> {
  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const img = await loadImage(imageSrc);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = iw;
  colorCanvas.height = ih;
  const cctx = colorCanvas.getContext('2d');
  if (!cctx) return 'rgb(128,128,128)';
  cctx.drawImage(img, 0, 0, iw, ih);
  const colorData = cctx.getImageData(0, 0, iw, ih).data;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = iw;
  maskCanvas.height = ih;
  const mctx = maskCanvas.getContext('2d');
  if (!mctx) return 'rgb(128,128,128)';

  let clip: Path2D;
  try {
    clip = new Path2D(pathD);
  } catch {
    return 'rgb(128,128,128)';
  }
  mctx.fillStyle = '#fff';
  mctx.fill(clip, 'evenodd');
  const maskImageData = mctx.getImageData(0, 0, iw, ih);
  const maskData = maskImageData.data;

  const passes = erosionPasses ?? calcErosionPasses(iw, ih);
  if (passes > 0) {
    erodeMask(maskData, iw, ih, passes);
  }

  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wa = 0;
  let validPixelCount = 0;
  for (let i = 0; i < colorData.length; i += 4) {
    if (maskData[i]! < 8) continue;
    const a = colorData[i + 3]! / 255;
    if (a < 0.02) continue;
    wr += colorData[i]! * a;
    wg += colorData[i + 1]! * a;
    wb += colorData[i + 2]! * a;
    wa += a;
    validPixelCount++;
  }
  if (wa < 1e-6 || validPixelCount < 1) return 'rgb(128,128,128)';
  const r = Math.round(wr / wa);
  const g = Math.round(wg / wa);
  const b = Math.round(wb / wa);
  return `rgb(${r},${g},${b})`;
}
