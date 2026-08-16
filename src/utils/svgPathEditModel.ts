/**
 * SVG path `d` 编辑模型：解析 Potrace 类 M/L/C/Z 路径，锚点与贝塞尔手柄（见图片编辑器矢量模式）
 */

export type Point = { x: number; y: number };

export type PathVertex = {
  x: number;
  y: number;
  /** true=尖角，手柄独立；false=平滑（拖一侧时镜像另一侧） */
  corner: boolean;
  handleIn?: Point;
  handleOut?: Point;
};

export type PathSubpath = {
  closed: boolean;
  verts: PathVertex[];
};

export type ParsedPathModel = {
  subpaths: PathSubpath[];
};

const TOKEN_RE =
  /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.|\d+)(?:[eE][-+]?\d+)?)/g;

function near(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) <= eps;
}

function nearPt(a: Point, b: Point, eps = 1e-3): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

type Edge = { kind: 'L'; to: Point } | { kind: 'C'; c1: Point; c2: Point; to: Point };

function tokenize(d: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  const s = d.trim();
  while ((m = TOKEN_RE.exec(s)) !== null) {
    if (m[1]) tokens.push(m[1]);
    else tokens.push(parseFloat(m[2]!));
  }
  return tokens;
}

export function tryParsePathData(d: string): ParsedPathModel | null {
  const tokens = tokenize(d);
  if (tokens.length === 0) return null;

  const subpaths: PathSubpath[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let subStart: Point | null = null;
  let edges: Edge[] = [];
  let pendingClosed = false;

  const readNum = (): number | null => {
    const t = tokens[i];
    if (typeof t !== 'number' || !Number.isFinite(t)) return null;
    i += 1;
    return t;
  };

  const flush = () => {
    if (!subStart) {
      edges = [];
      pendingClosed = false;
      return;
    }
    const verts = edgesToVertices(subStart, edges, pendingClosed);
    if (!verts || verts.length === 0) {
      subStart = null;
      edges = [];
      pendingClosed = false;
      return;
    }
    subpaths.push({ closed: pendingClosed, verts });
    subStart = null;
    edges = [];
    pendingClosed = false;
  };

  while (i < tokens.length) {
    const cmdTok = tokens[i];
    if (typeof cmdTok !== 'string') return null;
    const rel = cmdTok === cmdTok.toLowerCase();
    const c = cmdTok.toUpperCase();
    i += 1;

    if (c === 'Z') {
      pendingClosed = true;
      flush();
      continue;
    }

    const toAbs = (x: number, y: number) => (rel ? { x: cx + x, y: cy + y } : { x, y });

    if (c === 'M') {
      if (subStart) flush();
      const x0 = readNum();
      const y0 = readNum();
      if (x0 == null || y0 == null) return null;
      const p = toAbs(x0, y0);
      subStart = { ...p };
      cx = p.x;
      cy = p.y;
      pendingClosed = false;
      while (i < tokens.length && typeof tokens[i] === 'number') {
        const x = readNum();
        const y = readNum();
        if (x == null || y == null) return null;
        const q = rel ? { x: cx + x, y: cy + y } : { x, y };
        edges.push({ kind: 'L', to: { ...q } });
        cx = q.x;
        cy = q.y;
      }
      continue;
    }

    if (!subStart) return null;

    if (c === 'L') {
      const x = readNum();
      const y = readNum();
      if (x == null || y == null) return null;
      const p = toAbs(x, y);
      edges.push({ kind: 'L', to: { ...p } });
      cx = p.x;
      cy = p.y;
    } else if (c === 'H') {
      const x = readNum();
      if (x == null) return null;
      const nx = rel ? cx + x : x;
      const p = { x: nx, y: cy };
      edges.push({ kind: 'L', to: p });
      cx = p.x;
    } else if (c === 'V') {
      const y = readNum();
      if (y == null) return null;
      const ny = rel ? cy + y : y;
      const p = { x: cx, y: ny };
      edges.push({ kind: 'L', to: p });
      cy = p.y;
    } else if (c === 'C') {
      const x1 = readNum();
      const y1 = readNum();
      const x2 = readNum();
      const y2 = readNum();
      const x = readNum();
      const y = readNum();
      if (x1 == null || y1 == null || x2 == null || y2 == null || x == null || y == null) return null;
      const c1 = rel ? { x: cx + x1, y: cy + y1 } : { x: x1, y: y1 };
      const c2 = rel ? { x: cx + x2, y: cy + y2 } : { x: x2, y: y2 };
      const p = rel ? { x: cx + x, y: cy + y } : { x, y };
      edges.push({ kind: 'C', c1, c2, to: { ...p } });
      cx = p.x;
      cy = p.y;
    } else {
      return null;
    }
  }

  flush();
  return subpaths.length > 0 ? { subpaths } : null;
}

function edgesToVertices(start: Point, edges: Edge[], closed: boolean): PathVertex[] | null {
  if (edges.length === 0) {
    if (!closed) return [{ x: start.x, y: start.y, corner: true }];
    return null;
  }
  const verts: PathVertex[] = [{ x: start.x, y: start.y, corner: true }];
  for (const e of edges) {
    const prev = verts[verts.length - 1]!;
    if (e.kind === 'L') {
      verts.push({ x: e.to.x, y: e.to.y, corner: true });
    } else {
      prev.handleOut = { ...e.c1 };
      verts.push({
        x: e.to.x,
        y: e.to.y,
        corner: true,
        handleIn: { ...e.c2 },
      });
    }
  }
  if (closed && verts.length >= 2) {
    const first = verts[0]!;
    const last = verts[verts.length - 1]!;
    if (last.handleOut && !first.handleIn) {
      first.handleIn = { ...last.handleOut };
    }
    if (first.handleIn && !last.handleOut) {
      last.handleOut = { ...first.handleIn };
    }
  }
  return verts;
}

function verticesToEdges(verts: PathVertex[], closed: boolean): Edge[] | null {
  const n = verts.length;
  if (n < 2) return [];
  const edges: Edge[] = [];
  /** 闭合路径：最后一段 v_{n-1}→v0 由 Z 完成，勿再写 L/C 到起点，否则重解析会多出一个与首点重合的锚点 */
  const segCount = n - 1;
  for (let k = 0; k < segCount; k++) {
    const a = verts[k]!;
    const b = verts[(k + 1) % n]!;
    const ho = a.handleOut;
    const hi = b.handleIn;
    if (ho && hi) {
      edges.push({ kind: 'C', c1: { ...ho }, c2: { ...hi }, to: { x: b.x, y: b.y } });
    } else if (!ho && !hi) {
      edges.push({ kind: 'L', to: { x: b.x, y: b.y } });
    } else {
      const ax = a.x;
      const ay = a.y;
      const bx = b.x;
      const by = b.y;
      if (ho && !hi) {
        edges.push({ kind: 'C', c1: { ...ho }, c2: { x: bx, y: by }, to: { x: bx, y: by } });
      } else if (!ho && hi) {
        edges.push({ kind: 'C', c1: { x: ax, y: ay }, c2: { ...hi }, to: { x: bx, y: by } });
      }
    }
  }
  return edges;
}

function fmt(n: number): string {
  const t = n.toFixed(3);
  return t.replace(/\.?0+$/, '') || '0';
}

function serializeOneSubpath(sp: PathSubpath): string {
  const { verts, closed } = sp;
  if (verts.length === 0) return '';
  const v0 = verts[0]!;
  const parts: string[] = [`M ${fmt(v0.x)} ${fmt(v0.y)}`];
  const edges = verticesToEdges(verts, closed);
  if (!edges) return parts.join(' ');
  for (const e of edges) {
    if (e.kind === 'L') {
      parts.push(`L ${fmt(e.to.x)} ${fmt(e.to.y)}`);
    } else {
      parts.push(
        `C ${fmt(e.c1.x)} ${fmt(e.c1.y)} ${fmt(e.c2.x)} ${fmt(e.c2.y)} ${fmt(e.to.x)} ${fmt(e.to.y)}`
      );
    }
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

export function serializePathModel(model: ParsedPathModel): string {
  const parts: string[] = [];
  for (const sp of model.subpaths) {
    const s = serializeOneSubpath(sp);
    if (s) parts.push(s);
  }
  return parts.join(' ');
}

/** 单个子路径的 SVG d，用于命中检测 / 分段子路径绘制 */
export function serializeSubpathToD(sp: PathSubpath): string {
  return serializeOneSubpath(sp);
}

export function subpathNextVertexIndex(sp: PathSubpath, i: number): number | null {
  const n = sp.verts.length;
  if (n < 2) return null;
  if (sp.closed) return (i + 1) % n;
  return i + 1 < n ? i + 1 : null;
}

export function subpathPrevVertexIndex(sp: PathSubpath, i: number): number | null {
  const n = sp.verts.length;
  if (n < 2) return null;
  if (sp.closed) return (i - 1 + n) % n;
  return i > 0 ? i - 1 : null;
}

export function areVerticesAdjacentOnSubpath(sp: PathSubpath, viA: number, viB: number): boolean {
  const na = subpathNextVertexIndex(sp, viA);
  const nb = subpathNextVertexIndex(sp, viB);
  return (na !== null && viB === na) || (nb !== null && viA === nb);
}

/** 与 viA、viB 相邻的轮廓边起点（从该顶点沿轮廓走向下一顶点为边方向） */
export function edgeStartForAdjacentPair(sp: PathSubpath, viA: number, viB: number): number | null {
  const na = subpathNextVertexIndex(sp, viA);
  if (na !== null && viB === na) return viA;
  const nb = subpathNextVertexIndex(sp, viB);
  if (nb !== null && viA === nb) return viB;
  return null;
}

function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 三次贝塞尔在 t 处分裂为两段 */
function splitCubicAt(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): { left: { c1: Point; c2: Point; to: Point }; right: { c1: Point; c2: Point; to: Point } } {
  const q0 = lerpPt(p0, p1, t);
  const q1 = lerpPt(p1, p2, t);
  const q2 = lerpPt(p2, p3, t);
  const r0 = lerpPt(q0, q1, t);
  const r1 = lerpPt(q1, q2, t);
  const s = lerpPt(r0, r1, t);
  return {
    left: { c1: q0, c2: r0, to: s },
    right: { c1: r1, c2: q2, to: p3 },
  };
}

/**
 * 在子路径上从 edgeStart 到下一顶点的边中点插入新锚点（直线取中点；三次曲线在 t=0.5 分裂）。
 */
export function insertVertexMidEdgeOnSubpath(
  model: ParsedPathModel,
  subpathIndex: number,
  edgeStart: number
): ParsedPathModel | null {
  const sp = model.subpaths[subpathIndex];
  if (!sp) return null;
  const nextIdx = subpathNextVertexIndex(sp, edgeStart);
  if (nextIdx === null) return null;
  const verts = sp.verts;
  const a = verts[edgeStart]!;
  const b = verts[nextIdx]!;
  const ho = a.handleOut;
  const hi = b.handleIn;
  const isLine = !ho && !hi;

  const n = verts.length;
  const wrapEdge = sp.closed && edgeStart === n - 1 && nextIdx === 0;

  let newVerts: PathVertex[];
  if (isLine) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const mid: PathVertex = { x: mx, y: my, corner: true };
    const na: PathVertex = { ...a, handleOut: undefined, handleIn: a.handleIn };
    const nb: PathVertex = { ...b, handleIn: undefined, handleOut: b.handleOut };
    if (wrapEdge) {
      const copy = verts.map((v) => ({ ...v }));
      copy[edgeStart] = na;
      copy[0] = nb;
      newVerts = [...copy, mid];
    } else {
      newVerts = verts.map((v, j) => (j === edgeStart ? na : j === nextIdx ? nb : { ...v }));
      newVerts.splice(nextIdx, 0, mid);
    }
  } else {
    const p0: Point = { x: a.x, y: a.y };
    const p3: Point = { x: b.x, y: b.y };
    const p1: Point = ho ? { ...ho } : p0;
    const p2: Point = hi ? { ...hi } : p3;
    const { left, right } = splitCubicAt(p0, p1, p2, p3, 0.5);
    const na: PathVertex = {
      ...a,
      handleOut: { ...left.c1 },
      handleIn: a.handleIn,
      corner: a.corner,
    };
    const mid: PathVertex = {
      x: left.to.x,
      y: left.to.y,
      corner: true,
      handleIn: { ...left.c2 },
      handleOut: { ...right.c1 },
    };
    const nb: PathVertex = {
      ...b,
      handleIn: { ...right.c2 },
      handleOut: b.handleOut,
      corner: b.corner,
    };
    if (wrapEdge) {
      const copy = verts.map((v) => ({ ...v }));
      copy[edgeStart] = na;
      copy[0] = nb;
      newVerts = [...copy, mid];
    } else {
      newVerts = verts.map((v) => ({ ...v }));
      newVerts[edgeStart] = na;
      newVerts[nextIdx] = nb;
      newVerts.splice(nextIdx, 0, mid);
    }
  }

  const subpaths = model.subpaths.map((s, i) =>
    i === subpathIndex ? { ...sp, verts: newVerts } : s
  );
  return { subpaths };
}

export function moveVerticesByDelta(
  model: ParsedPathModel,
  keys: readonly { subpathIndex: number; vertexIndex: number }[],
  dx: number,
  dy: number
): ParsedPathModel {
  const uniq = new Map<string, { subpathIndex: number; vertexIndex: number }>();
  for (const k of keys) uniq.set(`${k.subpathIndex},${k.vertexIndex}`, k);
  const subpaths = model.subpaths.map((s) => ({
    ...s,
    verts: s.verts.map((v) => ({ ...v })),
  }));
  for (const k of uniq.values()) {
    const sp = subpaths[k.subpathIndex];
    if (!sp || k.vertexIndex >= sp.verts.length) continue;
    const v = sp.verts[k.vertexIndex]!;
    sp.verts[k.vertexIndex] = {
      ...v,
      x: v.x + dx,
      y: v.y + dy,
      handleIn: v.handleIn ? { x: v.handleIn.x + dx, y: v.handleIn.y + dy } : undefined,
      handleOut: v.handleOut ? { x: v.handleOut.x + dx, y: v.handleOut.y + dy } : undefined,
    };
  }
  return { subpaths };
}

/** 整体平移若干子路径（拖子图形区域） */
export function moveSubpathsByDelta(
  model: ParsedPathModel,
  subpathIndices: readonly number[],
  dx: number,
  dy: number
): ParsedPathModel {
  const set = new Set(subpathIndices);
  const subpaths = model.subpaths.map((sp, idx) => {
    if (!set.has(idx)) {
      return { ...sp, verts: sp.verts.map((v) => ({ ...v })) };
    }
    return {
      ...sp,
      verts: sp.verts.map((v) => ({
        ...v,
        x: v.x + dx,
        y: v.y + dy,
        handleIn: v.handleIn ? { x: v.handleIn.x + dx, y: v.handleIn.y + dy } : undefined,
        handleOut: v.handleOut ? { x: v.handleOut.x + dx, y: v.handleOut.y + dy } : undefined,
      })),
    };
  });
  return { subpaths };
}

/** 删除指定下标的子路径（indices 任意顺序，内部去重） */
export function removeSubpathsFromModel(model: ParsedPathModel, indices: readonly number[]): ParsedPathModel {
  const rm = new Set(indices);
  const subpaths = model.subpaths.filter((_, i) => !rm.has(i));
  return { subpaths };
}

export function deleteVerticesAt(
  model: ParsedPathModel,
  keys: readonly { subpathIndex: number; vertexIndex: number }[]
): ParsedPathModel | null {
  const bySi = new Map<number, number[]>();
  for (const k of keys) {
    if (!bySi.has(k.subpathIndex)) bySi.set(k.subpathIndex, []);
    bySi.get(k.subpathIndex)!.push(k.vertexIndex);
  }
  let m = model;
  for (const [si, vis] of bySi) {
    const uniq = [...new Set(vis)].sort((a, b) => b - a);
    for (const vi of uniq) {
      const next = deleteVertex(m, si, vi);
      if (!next) return null;
      m = next;
    }
  }
  return m;
}

export function pathDataEditable(d: string): boolean {
  return tryParsePathData(d) != null;
}

export function canDeleteVertex(sp: PathSubpath, index: number): boolean {
  if (sp.closed) return sp.verts.length > 3;
  const n = sp.verts.length;
  if (n <= 2) return false;
  if (index === 0 || index === n - 1) return false;
  return true;
}

export function deleteVertex(model: ParsedPathModel, subpathIndex: number, vertexIndex: number): ParsedPathModel | null {
  const sp = model.subpaths[subpathIndex];
  if (!sp || !canDeleteVertex(sp, vertexIndex)) return null;
  const nextSp = { ...sp, verts: sp.verts.filter((_, j) => j !== vertexIndex) };
  const subpaths = model.subpaths.map((s, i) => (i === subpathIndex ? nextSp : s));
  return { subpaths };
}

function prevIndex(n: number, i: number, closed: boolean): number {
  if (closed) return (i - 1 + n) % n;
  return i - 1;
}

function nextIndex(n: number, i: number, closed: boolean): number {
  if (closed) return (i + 1) % n;
  return i + 1;
}

function applySmoothHandles(verts: PathVertex[], closed: boolean, i: number): void {
  const n = verts.length;
  if (n < 2) return;
  const v = verts[i]!;
  const pi = prevIndex(n, i, closed);
  const ni = nextIndex(n, i, closed);
  if (pi === i || ni === i) return;
  const prev = verts[pi]!;
  const next = verts[ni]!;
  const tx = (next.x - prev.x) * 0.15;
  const ty = (next.y - prev.y) * 0.15;
  if (near(tx, 0) && near(ty, 0)) return;
  v.handleOut = { x: v.x + tx, y: v.y + ty };
  v.handleIn = { x: v.x - tx, y: v.y - ty };
}

export function setVertexCorner(
  model: ParsedPathModel,
  subpathIndex: number,
  vertexIndex: number,
  corner: boolean
): ParsedPathModel {
  const sp = model.subpaths[subpathIndex];
  if (!sp) return model;
  const verts = sp.verts.map((v, j) => (j === vertexIndex ? { ...v, corner } : { ...v }));
  if (!corner) {
    applySmoothHandles(verts, sp.closed, vertexIndex);
  }
  const subpaths = model.subpaths.map((s, i) => (i === subpathIndex ? { ...sp, verts } : s));
  return { subpaths };
}

export function moveVertex(
  model: ParsedPathModel,
  subpathIndex: number,
  vertexIndex: number,
  x: number,
  y: number
): ParsedPathModel {
  const sp = model.subpaths[subpathIndex];
  if (!sp) return model;
  const dx = x - sp.verts[vertexIndex]!.x;
  const dy = y - sp.verts[vertexIndex]!.y;
  const verts = sp.verts.map((v, j) => {
    if (j !== vertexIndex) return { ...v };
    return {
      ...v,
      x,
      y,
      handleIn: v.handleIn ? { x: v.handleIn.x + dx, y: v.handleIn.y + dy } : undefined,
      handleOut: v.handleOut ? { x: v.handleOut.x + dx, y: v.handleOut.y + dy } : undefined,
    };
  });
  const subpaths = model.subpaths.map((s, i) => (i === subpathIndex ? { ...sp, verts } : s));
  return { subpaths };
}

export type HandleSide = 'in' | 'out';

export function moveHandle(
  model: ParsedPathModel,
  subpathIndex: number,
  vertexIndex: number,
  side: HandleSide,
  x: number,
  y: number
): ParsedPathModel {
  const sp = model.subpaths[subpathIndex];
  if (!sp) return model;
  const verts = sp.verts.map((v) => ({ ...v }));
  const vi = verts[vertexIndex]!;
  if (side === 'in') {
    vi.handleIn = { x, y };
    if (!vi.corner) {
      vi.handleOut = { x: vi.x + (vi.x - x), y: vi.y + (vi.y - y) };
    }
  } else {
    vi.handleOut = { x, y };
    if (!vi.corner) {
      vi.handleIn = { x: vi.x + (vi.x - x), y: vi.y + (vi.y - y) };
    }
  }
  const subpaths = model.subpaths.map((s, i) => (i === subpathIndex ? { ...sp, verts } : s));
  return { subpaths };
}

export function modelFromPathData(d: string): ParsedPathModel | null {
  return tryParsePathData(d);
}

export function pathDataFromModel(model: ParsedPathModel): string {
  return serializePathModel(model);
}

export function modelsApproxEqual(a: ParsedPathModel, b: ParsedPathModel, eps = 0.05): boolean {
  if (a.subpaths.length !== b.subpaths.length) return false;
  for (let s = 0; s < a.subpaths.length; s++) {
    const pa = a.subpaths[s]!;
    const pb = b.subpaths[s]!;
    if (pa.closed !== pb.closed || pa.verts.length !== pb.verts.length) return false;
    for (let i = 0; i < pa.verts.length; i++) {
      const va = pa.verts[i]!;
      const vb = pb.verts[i]!;
      if (!near(va.x, vb.x, eps) || !near(va.y, vb.y, eps)) return false;
      if (va.corner !== vb.corner) return false;
      const cinA = va.handleIn;
      const cinB = vb.handleIn;
      if (!!cinA !== !!cinB) return false;
      if (cinA && cinB && (!near(cinA.x, cinB.x, eps) || !near(cinA.y, cinB.y, eps))) return false;
      const coutA = va.handleOut;
      const coutB = vb.handleOut;
      if (!!coutA !== !!coutB) return false;
      if (coutA && coutB && (!near(coutA.x, coutB.x, eps) || !near(coutA.y, coutB.y, eps))) return false;
    }
  }
  return true;
}

export function normalizeClosedSubpaths(model: ParsedPathModel): ParsedPathModel {
  const subpaths = model.subpaths.map((sp) => {
    if (!sp.closed || sp.verts.length < 2) return sp;
    const first = sp.verts[0]!;
    const last = sp.verts[sp.verts.length - 1]!;
    if (nearPt(first, last)) {
      return { ...sp, verts: sp.verts.slice(0, -1) };
    }
    return sp;
  });
  return { subpaths };
}
