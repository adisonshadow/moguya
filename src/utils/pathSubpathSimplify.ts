/**
 * 矢量子路径：采样折线 + RDP 简化（图片编辑器「简化路径」预览与应用）
 */
import type { Point } from '@/utils/potraceCore';
import { rdpSimplify } from '@/utils/potraceCore';
import type { ParsedPathModel, PathSubpath, PathVertex } from '@/utils/svgPathEditModel';
import {
  pathDataFromModel,
  serializeSubpathToD,
  tryParsePathData,
} from '@/utils/svgPathEditModel';

const STEPS_PER_CURVE = 12;

function nearPt(a: Point, b: Point, eps = 1e-4): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

/** 点 p 到线段 ab 的最短距离（与 potraceCore 内 RDP 一致） */
function pointToSegDist(p: Point, a: Point, b: Point): number {
  const lx = b.x - a.x;
  const ly = b.y - a.y;
  const len = Math.hypot(lx, ly);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * lx + (p.y - a.y) * ly) / (len * len);
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * lx;
  const qy = a.y + t * ly;
  return Math.hypot(p.x - qx, p.y - qy);
}

/**
 * 闭合折线 RDP：open RDP 若首尾为同一点会退化为「一切点到同一点」而失真。
 * 在环上取弦 (p0, p_mid)，找最远点分裂为两条开链再合并。
 */
function rdpSimplifyRing(ring: Point[], epsilon: number): Point[] {
  const n = ring.length;
  if (n < 3 || epsilon <= 0) return ring.slice();
  if (n === 3) return ring.slice();

  const mid = Math.max(1, Math.min(n - 1, Math.floor(n / 2)));
  const a = ring[0]!;
  const b = ring[mid]!;
  let idx = -1;
  let dmax = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === mid) continue;
    const d = pointToSegDist(ring[i]!, a, b);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (idx < 0 || dmax <= epsilon) {
    const c = ring[mid]!;
    if (!nearPt(a, b) && !nearPt(b, c) && !nearPt(a, c)) return [a, b, c];
    return ring.slice();
  }

  const chainAlongRing = (from: number, to: number): Point[] => {
    const out: Point[] = [];
    let i = from;
    for (;;) {
      out.push(ring[i]!);
      if (i === to) break;
      i = (i + 1) % n;
      if (out.length > n + 2) break;
    }
    return out;
  };

  const part1 = chainAlongRing(0, idx);
  const part2 = chainAlongRing(idx, 0);
  const left = rdpSimplify(part1, epsilon);
  const right = rdpSimplify(part2, epsilon);
  if (left.length < 2 || right.length < 2) return ring.slice();
  const merged = [...left.slice(0, -1), ...right.slice(0, -1)];
  return merged.length >= 3 ? merged : ring.slice();
}

function cubicBezier(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + ttt * p1.x,
    y: uuu * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + ttt * p1.y,
  };
}

/** 将单段边采样为折线点（含起点，末点由下一迭代处理以避免重复） */
function sampleEdgeOpen(a: PathVertex, b: PathVertex, steps: number): Point[] {
  const ho = a.handleOut;
  const hi = b.handleIn;
  const out: Point[] = [];
  if (ho && hi) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push(cubicBezier(a, ho, hi, b, t));
    }
  } else if (ho && !hi) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push(cubicBezier(a, ho, b, b, t));
    }
  } else if (!ho && hi) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      out.push(cubicBezier(a, a, hi, b, t));
    }
  } else {
    out.push({ x: a.x, y: a.y });
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function subpathToPolyline(sp: PathSubpath): Point[] {
  const verts = sp.verts;
  const n = verts.length;
  if (n < 2) return verts.map((v) => ({ x: v.x, y: v.y }));
  const segCount = sp.closed ? n : n - 1;
  const all: Point[] = [];
  for (let k = 0; k < segCount; k++) {
    const a = verts[k]!;
    const b = verts[(k + 1) % n]!;
    const seg = sampleEdgeOpen(a, b, STEPS_PER_CURVE);
    if (all.length === 0) all.push(...seg);
    else all.push(...seg.slice(1));
  }
  return all;
}

function bboxOfSubpaths(model: ParsedPathModel, indices: Set<number>): { w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of indices) {
    const sp = model.subpaths[i];
    if (!sp) continue;
    for (const v of sp.verts) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
  }
  if (!Number.isFinite(minX)) return { w: 1, h: 1 };
  return { w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) };
}

function simplifyOneSubpath(sp: PathSubpath, epsilon: number): PathSubpath {
  if (epsilon <= 0) return sp;
  // 1. 采样为折线
  const poly = subpathToPolyline(sp);
  if (poly.length < 3) return sp;
  // 2. RDP：闭合轮廓去掉首尾重合点后用环上 RDP，避免 open RDP 端点重合退化
  let simplifiedPoints: Point[];
  if (sp.closed && poly.length >= 2 && nearPt(poly[0]!, poly[poly.length - 1]!)) {
    const ring = poly.slice(0, -1);
    if (ring.length < 3) return sp;
    simplifiedPoints = rdpSimplifyRing(ring, epsilon);
  } else {
    simplifiedPoints = rdpSimplify(poly, epsilon);
  }
  if (simplifiedPoints.length < 2) return sp;
  if (sp.closed && simplifiedPoints.length < 3) return sp;
  // 3. 将简化后的点拟合为贝塞尔曲线子路径
  const fitted = fitBezierToPoints(simplifiedPoints, sp.closed);
  return fitted ?? sp;
}

/**
 * 给定一系列点，拟合出一条平滑的三次贝塞尔曲线子路径（带手柄）
 * 使用 Catmull-Rom 样条（张力=0.5），每相邻两点之间生成一段三次贝塞尔曲线
 */
function fitBezierToPoints(points: Point[], closed: boolean): PathSubpath | null {
  if (points.length < 2) return null;
  if (points.length === 2) {
    if (closed) return null;
    return {
      closed,
      verts: points.map((p) => ({ x: p.x, y: p.y, corner: true })),
    };
  }

  const n = points.length;
  const verts: PathVertex[] = [];

  // 辅助：计算 Catmull-Rom 某点的切线 (张力 0.5)
  function getTangent(prev: Point, next: Point): Point {
    return { x: (next.x - prev.x) / 2, y: (next.y - prev.y) / 2 };
  }

  // 根据 Catmull-Rom 段 (P0,P1,P2,P3) 生成三次贝塞尔控制点
  // 公式: B0 = P1, B3 = P2, B1 = P1 + T1/3, B2 = P2 - T2/3, 其中 T1,T2 为切线
  function catmullRomToBezier(p1: Point, p2: Point, t1: Point, t2: Point): [Point, Point, Point, Point] {
    const b0 = { x: p1.x, y: p1.y };
    const b3 = { x: p2.x, y: p2.y };
    const b1 = { x: p1.x + t1.x / 3, y: p1.y + t1.y / 3 };
    const b2 = { x: p2.x - t2.x / 3, y: p2.y - t2.y / 3 };
    return [b0, b1, b2, b3];
  }

  // 生成所有曲线段的控制点（每段 4 个点）
  const segments: Array<[Point, Point, Point, Point]> = [];

  if (closed) {
    // 封闭路径：环绕处理，P-1 = P(n-1), Pn = P0
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n];
      const p1 = points[i];
      const p2 = points[(i + 1) % n];
      const p3 = points[(i + 2) % n];
      const t1 = getTangent(p0, p2);
      const t2 = getTangent(p1, p3);
      segments.push(catmullRomToBezier(p1, p2, t1, t2));
    }
  } else {
    // 开放路径：端点使用单侧切线
    for (let i = 0; i < n - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      let t1: Point, t2: Point;

      if (i === 0) {
        // 起点：切线方向 = p2 - p1
        t1 = { x: p2.x - p1.x, y: p2.y - p1.y };
      } else {
        const p0 = points[i - 1];
        t1 = getTangent(p0, p2);
      }

      if (i === n - 2) {
        // 终点：切线方向 = p2 - p1
        t2 = { x: p2.x - p1.x, y: p2.y - p1.y };
      } else {
        const p3 = points[i + 2];
        t2 = getTangent(p1, p3);
      }

      segments.push(catmullRomToBezier(p1, p2, t1, t2));
    }
  }

  // 构建顶点：handleOut / handleIn 须为**绝对坐标**（与 svgPathEditModel / SVG C 的 c1、c2 一致），不可存锚点相对偏移

  if (closed) {
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      verts.push({
        x: p.x,
        y: p.y,
        corner: false,
        handleOut: { x: segments[i]![1].x, y: segments[i]![1].y },
        handleIn: { x: segments[(i - 1 + n) % n]![2].x, y: segments[(i - 1 + n) % n]![2].y },
      });
    }
  } else {
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      if (i === 0) {
        verts.push({
          x: p.x,
          y: p.y,
          corner: true,
          handleOut: segments[0] ? { x: segments[0][1].x, y: segments[0][1].y } : undefined,
        });
      } else if (i === n - 1) {
        verts.push({
          x: p.x,
          y: p.y,
          corner: true,
          handleIn: segments[n - 2] ? { x: segments[n - 2][2].x, y: segments[n - 2][2].y } : undefined,
        });
      } else {
        verts.push({
          x: p.x,
          y: p.y,
          corner: false,
          handleOut: { x: segments[i]![1].x, y: segments[i]![1].y },
          handleIn: { x: segments[i - 1]![2].x, y: segments[i - 1]![2].y },
        });
      }
    }
  }

  // 移除相邻重复点（由于浮点误差可能产生）
  const uniqueVerts: PathVertex[] = [];
  for (let i = 0; i < verts.length; i++) {
    if (i === 0 || !nearPt(verts[i], verts[i-1])) {
      uniqueVerts.push(verts[i]);
    }
  }
  if (closed && uniqueVerts.length > 2 && nearPt(uniqueVerts[0], uniqueVerts[uniqueVerts.length-1])) {
    uniqueVerts.pop();
  }

  if (closed && uniqueVerts.length < 3) return null;
  if (!closed && uniqueVerts.length < 2) return null;

  return { closed, verts: uniqueVerts };
}

/** 合并若干子路径的 d（自然坐标），用于红色预览轮廓 */
export function mergeSubpathsToD(pathData: string, indices: number[]): string | null {
  const m = tryParsePathData(pathData);
  if (!m) return null;
  const sorted = [...new Set(indices)].filter((i) => i >= 0 && i < m.subpaths.length).sort((a, b) => a - b);
  const parts: string[] = [];
  for (const i of sorted) {
    const d = serializeSubpathToD(m.subpaths[i]!);
    if (d.trim()) parts.push(d);
  }
  const joined = parts.join(' ').trim();
  return joined || null;
}

/**
 * 按「曲线精度」百分比对指定子路径做 RDP，返回**整段** pathData（未选中子路径不变）。
 * percent 0 → 近似不简化；100 → 较强简化。
 */
export function simplifySubpathsByPercent(
  pathData: string,
  subpathIndices: number[],
  percent: number
): string | null {
  const model = tryParsePathData(pathData);
  if (!model) return null;
  const idxSet = new Set(
    subpathIndices.filter((i) => i >= 0 && i < model.subpaths.length)
  );
  if (idxSet.size === 0) return pathData;

  const { w, h } = bboxOfSubpaths(model, idxSet);
  const diagonal = Math.hypot(w, h);
  const epsilon = (Math.max(0, Math.min(100, percent)) / 100) * diagonal * 0.42;

  const nextSubpaths = model.subpaths.map((sp, i) =>
    idxSet.has(i) ? simplifyOneSubpath(sp, epsilon) : sp
  );
  return pathDataFromModel({ subpaths: nextSubpaths });
}
