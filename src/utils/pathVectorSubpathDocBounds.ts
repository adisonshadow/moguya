/**
 * 矢量编辑：子路径在文档坐标系下的包围盒，用于框选子路径（见图片编辑器 PathVectorEditOverlay）
 */
import type { EditorPathObject } from '@/components/imageEditor/editorTypes';
import type { ParsedPathModel, PathSubpath } from '@/utils/svgPathEditModel';

export type DocAabb = { minX: number; minY: number; maxX: number; maxY: number };

function aabbIntersects(a: DocAabb, b: DocAabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** 自然坐标系顶点 → 文档坐标（与 PathVectorEditOverlay 中 Group 变换一致） */
function naturalPointToDoc(o: EditorPathObject, nx: number, ny: number): { x: number; y: number } {
  const sx = o.naturalW > 0 ? o.width / o.naturalW : 1;
  const sy = o.naturalH > 0 ? o.height / o.naturalH : 1;
  const lx = nx * sx;
  const ly = ny * sy;
  const rad = (o.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: o.x + lx * c - ly * s,
    y: o.y + lx * s + ly * c,
  };
}

/** 单条子路径在文档中的轴对齐包围盒（含锚点与手柄，便于框选贝塞尔范围） */
export function subpathDocAabb(o: EditorPathObject, sp: PathSubpath): DocAabb | null {
  if (sp.verts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (nx: number, ny: number) => {
    const p = naturalPointToDoc(o, nx, ny);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  for (const v of sp.verts) {
    add(v.x, v.y);
    if (v.handleIn) add(v.handleIn.x, v.handleIn.y);
    if (v.handleOut) add(v.handleOut.x, v.handleOut.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** 与文档矩形相交的子路径下标 */
export function subpathIndicesIntersectingDocRect(
  o: EditorPathObject,
  model: ParsedPathModel,
  docRect: DocAabb
): number[] {
  const out: number[] = [];
  model.subpaths.forEach((sp, i) => {
    const box = subpathDocAabb(o, sp);
    if (box && aabbIntersects(box, docRect)) out.push(i);
  });
  return out;
}
