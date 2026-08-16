/**
 * 图片编辑器：多选对齐与分布（基于各图层轴对齐外接框）
 */
import { objectRotatedBounds } from './editorContentBounds';
import type { EditorObject } from './editorTypes';

export type AlignKind = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';

export type DistributeKind = 'horizontal' | 'vertical' | 'both';

function withBounds(objects: EditorObject[], selectedIds: string[]) {
  const set = new Set(selectedIds);
  return objects
    .filter((o) => set.has(o.id))
    .map((o) => ({ obj: o, b: objectRotatedBounds(o) }));
}

/** 对齐到所选整体外接框 */
export function alignSelectedObjects(objects: EditorObject[], selectedIds: string[], kind: AlignKind): EditorObject[] {
  const list = withBounds(objects, selectedIds);
  if (list.length < 2) return objects;

  const minX = Math.min(...list.map((x) => x.b.minX));
  const maxX = Math.max(...list.map((x) => x.b.maxX));
  const minY = Math.min(...list.map((x) => x.b.minY));
  const maxY = Math.max(...list.map((x) => x.b.maxY));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  const delta = new Map<string, { dx: number; dy: number }>();
  for (const { obj: o, b } of list) {
    let dx = 0;
    let dy = 0;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    switch (kind) {
      case 'left':
        dx = minX - b.minX;
        break;
      case 'right':
        dx = maxX - b.maxX;
        break;
      case 'centerH':
        dx = midX - cx;
        break;
      case 'top':
        dy = minY - b.minY;
        break;
      case 'bottom':
        dy = maxY - b.maxY;
        break;
      case 'centerV':
        dy = midY - cy;
        break;
      default:
        break;
    }
    delta.set(o.id, { dx, dy });
  }

  return objects.map((o) => {
    const d = delta.get(o.id);
    return d ? { ...o, x: o.x + d.dx, y: o.y + d.dy } : o;
  });
}

/** 沿 X 或 Y 将相邻外接框间距均匀（保持两端整体范围不变） */
function distributeAxis(
  objects: EditorObject[],
  selectedIds: string[],
  axis: 'x' | 'y'
): EditorObject[] {
  const list = withBounds(objects, selectedIds);
  if (list.length < 3) return objects;

  const byMin =
    axis === 'x'
      ? [...list].sort((a, b) => a.b.minX - b.b.minX)
      : [...list].sort((a, b) => a.b.minY - b.b.minY);

  const first = byMin[0]!;
  const last = byMin[byMin.length - 1]!;
  const outerStart = axis === 'x' ? first.b.minX : first.b.minY;
  const outerEnd = axis === 'x' ? last.b.maxX : last.b.maxY;
  const span = outerEnd - outerStart;
  const sizes = byMin.map((x) => (axis === 'x' ? x.b.maxX - x.b.minX : x.b.maxY - x.b.minY));
  const sumW = sizes.reduce((s, w) => s + w, 0);
  const n = byMin.length;
  const gap = (span - sumW) / (n - 1);
  if (!Number.isFinite(gap)) return objects;

  const targetMins: number[] = [];
  let cursor = outerStart;
  for (let i = 0; i < n; i++) {
    targetMins.push(cursor);
    cursor += sizes[i]! + gap;
  }

  const delta = new Map<string, { dx: number; dy: number }>();
  byMin.forEach((item, i) => {
    const tMin = targetMins[i]!;
    const dx = axis === 'x' ? tMin - item.b.minX : 0;
    const dy = axis === 'y' ? tMin - item.b.minY : 0;
    delta.set(item.obj.id, { dx, dy });
  });

  return objects.map((o) => {
    const d = delta.get(o.id);
    return d ? { ...o, x: o.x + d.dx, y: o.y + d.dy } : o;
  });
}

export function distributeSelectedObjects(
  objects: EditorObject[],
  selectedIds: string[],
  kind: DistributeKind
): EditorObject[] {
  const list = withBounds(objects, selectedIds);
  if (list.length < 3) return objects;

  let next = objects;
  if (kind === 'horizontal' || kind === 'both') {
    next = distributeAxis(next, selectedIds, 'x');
  }
  if (kind === 'vertical' || kind === 'both') {
    next = distributeAxis(next, selectedIds, 'y');
  }
  return next;
}
