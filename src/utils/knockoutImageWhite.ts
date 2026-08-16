/**
 * 将位图中「足够亮」的像素 alpha 置 0，用于 Potrace 保留颜色时对齐 Illustrator「忽略白色」（白底不填充）。
 * 亮度与 potraceCore.forceBrightToBackground / imageDataToGrayscaleLuma 一致。
 */

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, n | 0));
}

function pixelLuma(r: number, g: number, b: number): number {
  return clampByte(0.299 * r + 0.587 * g + 0.114 * b);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图像加载失败'));
    img.src = src;
  });
}

/**
 * 返回 PNG data URL：灰度 ≥ minLuma 的像素变为全透明（与 Potrace ignoreWhiteMinLuma 语义一致）。
 */
export async function imageSrcToKnockoutWhiteDataUrl(
  src: string,
  minLuma: number
): Promise<string> {
  const img = await loadImageElement(src);
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 2D');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const cut = Math.max(0, Math.min(255, minLuma | 0));
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] ?? 0;
    const g = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;
    if (pixelLuma(r, g, b) >= cut) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
