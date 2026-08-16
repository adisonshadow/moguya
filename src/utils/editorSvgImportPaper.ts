/**
 * 将 SVG 文本解析为编辑器 path 图层数据（Paper.js importSVG，见图片编辑器矢量图层）
 */
import paper from 'paper';

import type { PathSubpathStyleOverride } from '@/components/imageEditor/editorTypes';

export type EditorSvgImportPathPayload = {
  pathData: string;
  naturalW: number;
  naturalH: number;
  pathSubpathStyles: PathSubpathStyleOverride[];
};

function colorToCss(c: paper.Color | null, fallback: string): string {
  if (!c) return fallback;
  try {
    return c.toCSS(true);
  } catch {
    return fallback;
  }
}

/**
 * 在浏览器环境中把 SVG 转为单图层 pathData + 局部尺寸；无矢量路径时返回 null。
 */
export function importSvgTextToEditorPathPayload(svgText: string): EditorSvgImportPathPayload | null {
  if (typeof document === 'undefined') return null;
  const trimmed = svgText.trim();
  if (!trimmed.startsWith('<')) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  paper.setup(canvas);
  paper.project.clear();

  let root: paper.Item | null = null;
  try {
    root = paper.project.importSVG(trimmed, { insert: true, expandShapes: true }) as paper.Item;
  } catch {
    paper.project.clear();
    return null;
  }
  if (!root) {
    paper.project.clear();
    return null;
  }

  type Collected = { path: paper.Path; fill: string; stroke: string; strokeWidth: number };
  const collected: Collected[] = [];

  const walk = (item: paper.Item) => {
    if (item instanceof paper.Path) {
      const p = item.clone({ insert: false }) as paper.Path;
      p.transform(item.globalMatrix);
      const fill =
        item.fillColor != null ? colorToCss(item.fillColor, 'rgba(0,0,0,0.88)') : 'rgba(0,0,0,0)';
      const hasStroke = item.strokeColor != null && item.strokeWidth > 0;
      const stroke = hasStroke ? colorToCss(item.strokeColor, 'rgba(0,0,0,1)') : 'transparent';
      const strokeWidth = hasStroke ? item.strokeWidth : 0;
      collected.push({ path: p, fill, stroke, strokeWidth });
      return;
    }
    const ch = item.children;
    if (ch?.length) {
      for (let i = 0; i < ch.length; i++) walk(ch[i] as paper.Item);
    }
  };

  walk(root);
  root.remove();

  if (collected.length === 0) {
    paper.project.clear();
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of collected) {
    const b = c.path.bounds;
    if (!(b.width > 0 || b.height > 0)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) {
    for (const c of collected) c.path.remove();
    paper.project.clear();
    return null;
  }

  const tx = -minX;
  const ty = -minY;
  for (const c of collected) {
    c.path.translate([tx, ty]);
  }

  const cp = new paper.CompoundPath({ insert: true });
  for (const c of collected) {
    cp.addChild(c.path);
  }

  const pathData = cp.pathData?.trim();
  const b = cp.bounds;
  const pathSubpathStyles: PathSubpathStyleOverride[] = collected.map((c) => ({
    fill: c.fill,
    stroke: c.stroke,
    strokeWidth: c.strokeWidth,
  }));
  cp.remove();
  paper.project.clear();

  if (!pathData) return null;
  const naturalW = Math.max(1, Math.round(b.width));
  const naturalH = Math.max(1, Math.round(b.height));

  return { pathData, naturalW, naturalH, pathSubpathStyles };
}
