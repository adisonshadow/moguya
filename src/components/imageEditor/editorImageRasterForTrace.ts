/**
 * 将图片图层栅格为与画布显示一致的位图（含 sourceCrop / 遮罩裁切），供矢量化管线使用。
 */

import type { EditorImageObject } from './editorTypes';

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

export async function rasterizeEditorImageForPotrace(o: EditorImageObject): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  const img = await loadHtmlImage(o.src);
  const nw = o.naturalW && o.naturalW > 0 ? o.naturalW : img.naturalWidth;
  const nh = o.naturalH && o.naturalH > 0 ? o.naturalH : img.naturalHeight;
  const c = o.sourceCrop;
  const sx = c ? Math.max(0, Math.round(c.x)) : 0;
  const sy = c ? Math.max(0, Math.round(c.y)) : 0;
  const sw = c ? Math.max(1, Math.round(c.width)) : nw;
  const sh = c ? Math.max(1, Math.round(c.height)) : nh;
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return { dataUrl: canvas.toDataURL('image/png'), width: sw, height: sh };
}
