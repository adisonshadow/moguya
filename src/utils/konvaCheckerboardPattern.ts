/**
 * 生成 Konva fillPatternImage 用棋盘格小图（与 CHECKERBOARD_BACKGROUND 视觉接近）
 */
export function createKonvaCheckerboardTile(): HTMLCanvasElement {
  const s = 10;
  const w = s * 2;
  const h = s * 2;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, s, s);
  ctx.fillRect(s, s, s, s);
  return c;
}
