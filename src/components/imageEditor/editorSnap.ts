/**
 * 图片编辑器：拖拽时边/中线与画布或其它对象对齐（文档坐标系）
 */

export const EDITOR_SNAP_SCREEN_PX = 8;

export type EditorSnapGuides = { vx: number[]; hy: number[] };

function bestSnap1D(edges: number[], targets: number[], threshold: number): { delta: number; guide: number | undefined } {
  let bestDelta = 0;
  let bestDist = threshold + 1;
  let guide: number | undefined;
  for (const e of edges) {
    for (const t of targets) {
      const d = t - e;
      const ad = Math.abs(d);
      if (ad < bestDist) {
        bestDist = ad;
        bestDelta = d;
        guide = t;
      }
    }
  }
  if (bestDist > threshold) return { delta: 0, guide: undefined };
  return { delta: bestDelta, guide };
}

/** 根据当前包围盒与候选线，返回位移与要高亮显示的辅助线位置（文档坐标） */
export function snapDragRect(
  rect: { x: number; y: number; width: number; height: number },
  snapXs: number[],
  snapYs: number[],
  thresholdDoc: number
): { dx: number; dy: number; guides: EditorSnapGuides } {
  const xEdges = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
  const yEdges = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
  const { delta: dx, guide: gx } = bestSnap1D(xEdges, snapXs, thresholdDoc);
  const { delta: dy, guide: gy } = bestSnap1D(yEdges, snapYs, thresholdDoc);
  return {
    dx,
    dy,
    guides: {
      vx: gx != null ? [gx] : [],
      hy: gy != null ? [gy] : [],
    },
  };
}
