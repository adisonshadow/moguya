/**
 * Potrace 风格位图矢量化（独立核心）
 * 管线：输入 RGBA → 灰度（低 alpha 视为背景）→ 二值化 →（可选）浅色边缘剔除 → 忽略高亮 → 连通域过滤 →（可选）前景腐蚀 → marching squares → RDP 简化 → 角点分段 + Catmull-Rom 转三次贝塞尔（SVG d）
 * 说明：与 Selinger 原 Potrace 的曲线最优划分不同，此处采用工程上常用的轮廓 + 平滑贝塞尔拟合，满足交互式编辑预览与导出。
 */

export type PotraceCoreOptions = {
  /** 灰度低于此值视为前景（描黑边一侧），0–255；设为 -1 时自动使用 Otsu 方法计算 */
  threshold: number;
  /** 丢弃面积小于此像素数的连通块（去噪） */
  turdSize: number;
  /** Ramer–Douglas–Peucker 简化epsilon（像素），越大曲线越少 */
  simplifyEpsilon: number;
  /** 追踪前若长边超过此值则等比缩小，控制耗时 */
  maxTraceSide: number;
  /**
   * Catmull-Rom→Bezier 张力：0 接近折线，0.5 默认，1 最平滑
   */
  curveTension: number;
  /**
   * 邻边方向变化角 ≥ 此度数（°）时标为角点并打断平滑；链内仍用 Catmull-Rom。
   * 越小 → 越多尖角；越大 → 仅大转折才打断（更圆滑）。0 关闭角点检测（整圈旧版平滑）。
   */
  cornerAngleThreshold: number;
  /** 是否启用自适应 RDP epsilon（根据点数自动调整），默认 false */
  adaptiveSimplify: boolean;
  /** 为 true 时将高亮像素强制视为背景，避免白底/浅灰被描进轮廓 */
  ignoreWhite: boolean;
  /** 与 ignoreWhite 联用：灰度 ≥ 此值视为白（0–255），默认 248 */
  ignoreWhiteMinLuma: number;
  /**
   * 二值前景做十字腐蚀次数（0 关闭）。每次向内缩 1 像素，可去掉抗锯齿造成的浅色外扩轮廓、减轻白边。
   */
  edgeErosionPasses: number;
  /**
   * 若 >0：已判为前景且 min(R,G,B) ≥ 此值的像素改回背景，用于剔除彩色边缘的灰白过渡（锯齿混合色）。
   * 0 关闭。典型彩色字可试 180–220；灰度图请保持 0。
   */
  fringeSuppressMinRgb: number;
  /**
   * alpha 低于此值的像素在转灰度时强制为 255（背景），避免四周透明（常为 RGBA=0,0,0,0）被当成黑前景、沿画布边描出整幅矩形；evenodd 与子路径叠加还会导致填充变空。
   * 设为 0 关闭（不读 alpha，兼容特殊素材）。
   */
  traceMinAlpha: number;
};

export const DEFAULT_POTRACE_OPTIONS: PotraceCoreOptions = {
  threshold: 128,
  turdSize: 16,
  simplifyEpsilon: 1.6,
  maxTraceSide: 1600,
  curveTension: 0.5,
  cornerAngleThreshold: 38,
  adaptiveSimplify: false,
  ignoreWhite: true,
  ignoreWhiteMinLuma: 248,
  edgeErosionPasses: 0,
  fringeSuppressMinRgb: 0,
  traceMinAlpha: 16,
};

/** 轮廓点过多时自动抬高 RDP epsilon，避免生成数万段贝塞尔拖垮 Konva */
function effectiveSimplifyEpsilon(base: number, loopVertexCount: number, enabled: boolean): number {
  if (!enabled) return base;
  let e = base;
  if (loopVertexCount > 500) e = Math.max(e, 2.5);
  if (loopVertexCount > 1000) e = Math.max(e, 4.0);
  if (loopVertexCount > 2000) e = Math.max(e, 6.0);
  return e;
}

export type Point = { x: number; y: number };

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, n | 0));
}

/** RGBA ImageData → 灰度 luminance（忽略 alpha） */
export function imageDataToGrayscaleLuma(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    out[p] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

/**
 * Potrace 用灰度：minAlpha>0 时 alpha<minAlpha 的像素视为背景（255），避免透明边被当成黑墨。
 */
export function imageDataToTraceGrayscale(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minAlpha: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  const cut = Math.max(0, Math.min(255, minAlpha | 0));
  const useAlpha = cut > 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    if (useAlpha && (data[i + 3] ?? 0) < cut) {
      out[p] = 255;
    } else {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      out[p] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return out;
}

/** Otsu 自适应阈值算法 */
export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    histogram[gray[i]!]!++;
  }
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i]!;
  }
  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 0;
  for (let t = 0; t < 256; t++) {
    wB += histogram[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

/** 灰度 → 二值：1=前景（要描的「墨」），0=背景 */
export function binarize(gray: Uint8Array, width: number, height: number, threshold: number): Uint8Array {
  const bin = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    bin[i] = gray[i]! < threshold ? 1 : 0;
  }
  return bin;
}

/** 将足够亮的像素强制为背景（减轻 Otsu/阈值把浅灰当墨） */
function forceBrightToBackground(bin: Uint8Array, gray: Uint8Array, minLuma: number): void {
  const cut = Math.max(0, Math.min(255, minLuma | 0));
  for (let i = 0; i < bin.length; i++) {
    if (gray[i]! >= cut) bin[i] = 0;
  }
}

/** 每像素 min(R,G,B)，与灰度同分辨率；用于识别偏白的抗锯齿混合色 */
export function imageDataToMinRgbChannel(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    out[p] = Math.min(r, g, b);
  }
  return out;
}

/**
 * 与 scaleDownGrayIfNeeded 相同采样（sx=(x+0.5)/scale-0.5），保证与追踪用灰度格对齐。
 */
function downscaleUint8ToTraceGrid(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  scale: number
): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = (y + 0.5) / scale - 0.5;
    const y0 = Math.max(0, Math.min(sh - 2, Math.floor(sy)));
    const y1 = y0 + 1;
    const fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = (x + 0.5) / scale - 0.5;
      const x0 = Math.max(0, Math.min(sw - 2, Math.floor(sx)));
      const x1 = x0 + 1;
      const fx = sx - x0;
      const v00 = src[y0 * sw + x0] ?? 0;
      const v10 = src[y0 * sw + x1] ?? 0;
      const v01 = src[y1 * sw + x0] ?? 0;
      const v11 = src[y1 * sw + x1] ?? 0;
      const v0 = v00 * (1 - fx) + v10 * fx;
      const v1 = v01 * (1 - fx) + v11 * fx;
      out[y * dw + x] = clampByte(v0 * (1 - fy) + v1 * fy);
    }
  }
  return out;
}

function scaleDownUint8IfNeeded(
  src: Uint8Array,
  width: number,
  height: number,
  maxSide: number
): { data: Uint8Array; width: number; height: number; scale: number } {
  const m = Math.max(width, height);
  if (m <= maxSide) return { data: src, width, height, scale: 1 };
  const scale = maxSide / m;
  const nw = Math.max(1, Math.round(width * scale));
  const nh = Math.max(1, Math.round(height * scale));
  const out = downscaleUint8ToTraceGrid(src, width, height, nw, nh, scale);
  return { data: out, width: nw, height: nh, scale };
}

function scaleDownGrayIfNeeded(
  gray: Uint8Array,
  width: number,
  height: number,
  maxSide: number
): { gray: Uint8Array; width: number; height: number; scale: number } {
  const r = scaleDownUint8IfNeeded(gray, width, height, maxSide);
  return { gray: r.data, width: r.width, height: r.height, scale: r.scale };
}

/** 前景中「min 通道已偏高」的像素视为浅色锯齿，改回背景 */
function stripFringeForegroundByMinRgb(
  bin: Uint8Array,
  minRgb: Uint8Array,
  w: number,
  h: number,
  minCut: number
): void {
  const cut = Math.max(0, Math.min(255, minCut | 0));
  if (cut <= 0) return;
  const n = w * h;
  if (minRgb.length !== n) return;
  for (let i = 0; i < n; i++) {
    if (bin[i] === 1 && minRgb[i]! >= cut) bin[i] = 0;
  }
}

/** 十字结构元腐蚀；边界外视为背景，可逐层剥掉抗锯齿浅色环 */
function erodeBinaryCross(bin: Uint8Array, w: number, h: number, passes: number): void {
  const p = Math.max(0, Math.min(8, passes | 0));
  if (p === 0) return;
  const tmp = new Uint8Array(bin.length);
  for (let pass = 0; pass < p; pass++) {
    tmp.fill(0);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = row + x;
        if (bin[i] !== 1) continue;
        if (bin[i - 1] !== 1 || bin[i + 1] !== 1 || bin[i - w] !== 1 || bin[i + w] !== 1) continue;
        tmp[i] = 1;
      }
    }
    bin.set(tmp);
  }
}

function getV(bin: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return bin[y * w + x] ? 1 : 0;
}

function getGray(gray: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return 255;
  return gray[y * w + x] ?? 255;
}

type EdgeKey = string;

function makeEdgeKey(x: number, y: number, edge: 'top' | 'right' | 'bottom' | 'left'): EdgeKey {
  return `${x},${y},${edge}`;
}

function interpolateEdgePoint(
  x: number,
  y: number,
  edge: 'top' | 'right' | 'bottom' | 'left',
  gray: Uint8Array,
  w: number,
  h: number,
  threshold: number
): Point {
  let g1: number, g2: number;
  let p1x: number, p1y: number, p2x: number, p2y: number;

  switch (edge) {
    case 'top':
      g1 = getGray(gray, w, h, x, y);
      g2 = getGray(gray, w, h, x + 1, y);
      p1x = x;
      p1y = y;
      p2x = x + 1;
      p2y = y;
      break;
    case 'right':
      g1 = getGray(gray, w, h, x + 1, y);
      g2 = getGray(gray, w, h, x + 1, y + 1);
      p1x = x + 1;
      p1y = y;
      p2x = x + 1;
      p2y = y + 1;
      break;
    case 'bottom':
      g1 = getGray(gray, w, h, x, y + 1);
      g2 = getGray(gray, w, h, x + 1, y + 1);
      p1x = x;
      p1y = y + 1;
      p2x = x + 1;
      p2y = y + 1;
      break;
    case 'left':
      g1 = getGray(gray, w, h, x, y);
      g2 = getGray(gray, w, h, x, y + 1);
      p1x = x;
      p1y = y;
      p2x = x;
      p2y = y + 1;
      break;
  }

  const d1 = Math.abs(g1 - threshold);
  const d2 = Math.abs(g2 - threshold);
  const total = d1 + d2;
  if (total < 1e-6) {
    return { x: (p1x + p2x) / 2, y: (p1y + p2y) / 2 };
  }
  const t = d1 / total;
  return { x: p1x + t * (p2x - p1x), y: p1y + t * (p2y - p1y) };
}

function marchingSquaresSegments(
  bin: Uint8Array,
  gray: Uint8Array,
  w: number,
  h: number,
  threshold: number
): Array<{ a: Point; b: Point }> {
  const segs: Array<{ a: Point; b: Point }> = [];
  const edgePoints = new Map<EdgeKey, Point>();

  const getEdgePoint = (x: number, y: number, edge: 'top' | 'right' | 'bottom' | 'left'): Point | null => {
    const key = makeEdgeKey(x, y, edge);
    if (edgePoints.has(key)) {
      return edgePoints.get(key)!;
    }
    const pt = interpolateEdgePoint(x, y, edge, gray, w, h, threshold);
    edgePoints.set(key, pt);
    return pt;
  };

  const getSharedEdgePoint = (
    x: number,
    y: number,
    edge: 'top' | 'right' | 'bottom' | 'left'
  ): Point | null => {
    switch (edge) {
      case 'top':
        if (y > 0) {
          return getEdgePoint(x, y - 1, 'bottom');
        }
        return getEdgePoint(x, y, 'top');
      case 'left':
        if (x > 0) {
          return getEdgePoint(x - 1, y, 'right');
        }
        return getEdgePoint(x, y, 'left');
      case 'right':
        return getEdgePoint(x, y, 'right');
      case 'bottom':
        return getEdgePoint(x, y, 'bottom');
    }
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = getV(bin, w, h, x, y);
      const tr = getV(bin, w, h, x + 1, y);
      const br = getV(bin, w, h, x + 1, y + 1);
      const bl = getV(bin, w, h, x, y + 1);
      const idx = tl * 8 + tr * 4 + br * 2 + bl;

      const topPt = tl !== tr ? getSharedEdgePoint(x, y, 'top') : null;
      const rightPt = tr !== br ? getSharedEdgePoint(x, y, 'right') : null;
      const bottomPt = bl !== br ? getSharedEdgePoint(x, y, 'bottom') : null;
      const leftPt = tl !== bl ? getSharedEdgePoint(x, y, 'left') : null;

      const pushSeg = (pa: Point | null, pb: Point | null) => {
        if (pa && pb) {
          segs.push({ a: pa, b: pb });
        }
      };

      // idx = tl*8 + tr*4 + br*2 + bl（1=前景）；0/15 无段；5/10 鞍点；11=顶+右（同 4）、12=左+右（同 3）
      switch (idx) {
        case 0:
        case 15:
          break;
        case 1:
          pushSeg(bottomPt, leftPt);
          break;
        case 2:
          pushSeg(rightPt, bottomPt);
          break;
        case 3:
          pushSeg(rightPt, leftPt);
          break;
        case 4:
          pushSeg(topPt, rightPt);
          break;
        case 5: {
          const tlGray = getGray(gray, w, h, x, y);
          const trGray = getGray(gray, w, h, x + 1, y);
          const brGray = getGray(gray, w, h, x + 1, y + 1);
          const blGray = getGray(gray, w, h, x, y + 1);
          const centerGray = (tlGray + trGray + brGray + blGray) / 4;
          if (centerGray < threshold) {
            pushSeg(topPt, leftPt);
            pushSeg(bottomPt, rightPt);
          } else {
            pushSeg(topPt, rightPt);
            pushSeg(bottomPt, leftPt);
          }
          break;
        }
        case 6:
          pushSeg(topPt, bottomPt);
          break;
        case 7:
          pushSeg(topPt, leftPt);
          break;
        case 8:
          pushSeg(leftPt, topPt);
          break;
        case 9:
          pushSeg(bottomPt, topPt);
          break;
        case 10: {
          const tlGray = getGray(gray, w, h, x, y);
          const trGray = getGray(gray, w, h, x + 1, y);
          const brGray = getGray(gray, w, h, x + 1, y + 1);
          const blGray = getGray(gray, w, h, x, y + 1);
          const centerGray = (tlGray + trGray + brGray + blGray) / 4;
          if (centerGray < threshold) {
            pushSeg(leftPt, bottomPt);
            pushSeg(rightPt, topPt);
          } else {
            pushSeg(leftPt, topPt);
            pushSeg(rightPt, bottomPt);
          }
          break;
        }
        case 11:
          pushSeg(topPt, rightPt);
          break;
        case 12:
          pushSeg(leftPt, rightPt);
          break;
        case 13:
          pushSeg(rightPt, bottomPt);
          break;
        case 14:
          pushSeg(leftPt, bottomPt);
          break;
        default:
          break;
      }
    }
  }
  return segs;
}

function nearPt(a: Point, b: Point, eps = 0.6): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < eps;
}

/** 环的轴对齐包围盒较短边，用于小字孔等窄环：限制 RDP 避免把小闭环简化成退化折线 */
function loopBBoxMinSide(loop: Point[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-9);
  const h = Math.max(maxY - minY, 1e-9);
  return Math.min(w, h);
}

/** 将无向线段哈希成双向边，连成闭合或多义折线 */
function segmentsToPolylines(segs: Array<{ a: Point; b: Point }>, eps = 0.5): Point[][] {
  const near = (u: Point, v: Point) => Math.hypot(u.x - v.x, u.y - v.y) < eps;
  type Edge = { o: Point; d: Point; used: boolean };
  const edges: Edge[] = segs.map((s) => ({ o: { ...s.a }, d: { ...s.b }, used: false }));
  const loops: Point[][] = [];

  const findUnused = () => edges.find((e) => !e.used);

  while (true) {
    const startE = findUnused();
    if (!startE) break;
    const poly: Point[] = [{ ...startE.o }];
    let cur = { ...startE.d };
    startE.used = true;
    const startPt = poly[0]!;
    let guard = 0;
    while (guard++ < edges.length * 4) {
      poly.push(cur);
      if (near(cur, startPt) && poly.length > 2) break;
      let next: Point | null = null;
      for (const e of edges) {
        if (e.used) continue;
        if (near(e.o, cur)) {
          e.used = true;
          next = { ...e.d };
          break;
        }
        if (near(e.d, cur)) {
          e.used = true;
          next = { ...e.o };
          break;
        }
      }
      if (!next) break;
      cur = next;
    }
    if (poly.length >= 3) loops.push(poly);
  }
  return loops;
}

/** Ramer–Douglas–Peucker */
export function rdpSimplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3 || epsilon <= 0) return points.slice();
  let idx = 0;
  let dmax = 0;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const d = pointToSegDist(p, a, b);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax > epsilon) {
    const left = rdpSimplify(points.slice(0, idx + 1), epsilon);
    const right = rdpSimplify(points.slice(idx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [a, b];
}

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

/** 闭合折线 → Catmull-Rom 等价三次贝塞尔片段，输出 SVG path d（子路径） */
export function closedPolylineToSvgCubicPath(points: Point[], tension: number = 0.5): string {
  const n = points.length;
  if (n < 3) return '';
  const p = points;
  const alpha = tension / 3;
  let d = `M ${p[0]!.x.toFixed(2)} ${p[0]!.y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n]!;
    const p1 = p[i]!;
    const p2 = p[(i + 1) % n]!;
    const p3 = p[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) * alpha;
    const c1y = p1.y + (p2.y - p0.y) * alpha;
    const c2x = p2.x - (p3.x - p1.x) * alpha;
    const c2y = p2.y - (p3.y - p1.y) * alpha;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

const DEG2RAD = Math.PI / 180;

/**
 * 检测闭合折线各顶点是否为角点：沿路径的转向角 |atan2(cross,dot)| ≥ thresholdDeg（弧度）时为角点。
 */
export function detectCornerVertices(ring: Point[], thresholdDeg: number, minEdgeLen = 0.35): boolean[] {
  const n = ring.length;
  const out = new Array<boolean>(n).fill(false);
  if (n < 3 || thresholdDeg <= 0) return out;
  const thr = thresholdDeg * DEG2RAD;
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n]!;
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % n]!;
    const e1x = p1.x - p0.x;
    const e1y = p1.y - p0.y;
    const e2x = p2.x - p1.x;
    const e2y = p2.y - p1.y;
    const l1 = Math.hypot(e1x, e1y);
    const l2 = Math.hypot(e2x, e2y);
    if (l1 < minEdgeLen || l2 < minEdgeLen) continue;
    const n1x = e1x / l1;
    const n1y = e1y / l1;
    const n2x = e2x / l2;
    const n2y = e2y / l2;
    const cross = n1x * n2y - n1y * n2x;
    const dot = Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y));
    const turn = Math.abs(Math.atan2(cross, dot));
    if (turn >= thr) out[i] = true;
  }
  return out;
}

function rotateRing(ring: Point[], start: number): Point[] {
  if (start <= 0) return ring.slice();
  return ring.slice(start).concat(ring.slice(0, start));
}

function rotateFlags(flags: boolean[], start: number): boolean[] {
  if (start <= 0) return flags.slice();
  return flags.slice(start).concat(flags.slice(0, start));
}

/** 从索引 from 沿 forward 走到 to（均含端点），含环绕 */
function extractChainForward(ring: Point[], from: number, to: number, n: number): Point[] {
  const pts: Point[] = [];
  let i = from;
  for (let guard = 0; guard <= n + 2; guard++) {
    pts.push(ring[i]!);
    if (i === to) break;
    i = (i + 1) % n;
  }
  return pts;
}

/**
 * 开折线（首点即当前笔位）→ clamped Catmull-Rom 三次贝塞尔；2 点则 L。
 */
function openChainToSvgCubicPath(chain: Point[], tension: number): string {
  const m = chain.length;
  if (m < 2) return '';
  const b = chain[m - 1]!;
  if (m === 2) {
    return ` L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  }
  const alpha = tension / 3;
  let d = '';
  for (let i = 0; i < m - 1; i++) {
    const p1 = chain[i]!;
    const p2 = chain[i + 1]!;
    const p0 = i === 0 ? p1 : chain[i - 1]!;
    const p3 = i + 2 < m ? chain[i + 2]! : p2;
    const c1x = p1.x + (p2.x - p0.x) * alpha;
    const c1y = p1.y + (p2.y - p0.y) * alpha;
    const c2x = p2.x - (p3.x - p1.x) * alpha;
    const c2y = p2.y - (p3.y - p1.y) * alpha;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

/**
 * 角点处打断平滑：相邻角点之间的开链用 clamped Catmull-Rom，角点用直线衔接。
 * cornerAngleThresholdDeg≤0 时与 closedPolylineToSvgCubicPath 等价（整圈平滑）。
 */
export function closedPolylineToSvgPathWithCorners(
  ring: Point[],
  tension: number,
  cornerAngleThresholdDeg: number,
  minEdgeLen = 0.35
): string {
  const n = ring.length;
  if (n < 3) return '';
  if (cornerAngleThresholdDeg <= 0) {
    return closedPolylineToSvgCubicPath(ring, tension);
  }

  const corners = detectCornerVertices(ring, cornerAngleThresholdDeg, minEdgeLen);
  if (!corners.some(Boolean)) {
    return closedPolylineToSvgCubicPath(ring, tension);
  }

  const start = corners.findIndex(Boolean);
  if (start < 0) return closedPolylineToSvgCubicPath(ring, tension);

  const r = rotateRing(ring, start);
  const f = rotateFlags(corners, start);
  const cornerIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (f[i]) cornerIdx.push(i);
  }
  if (cornerIdx.length < 2) {
    return closedPolylineToSvgCubicPath(ring, tension);
  }

  const p0 = r[0]!;
  let d = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
  const k = cornerIdx.length;
  for (let t = 0; t < k; t++) {
    const a = cornerIdx[t]!;
    const b = cornerIdx[(t + 1) % k]!;
    const chain = extractChainForward(r, a, b, n);
    d += openChainToSvgCubicPath(chain, tension);
  }
  d += ' Z';
  return d;
}

/** BFS 连通域标记，返回每域像素数与掩码 */
function labelComponents(bin: Uint8Array, w: number, h: number): { labels: Int32Array; counts: Map<number, number> } {
  const labels = new Int32Array(w * h).fill(-1);
  const counts = new Map<number, number>();
  let label = 0;

  for (let yi = 0; yi < h; yi++) {
    for (let xi = 0; xi < w; xi++) {
      const i = yi * w + xi;
      if (bin[i] !== 1 || labels[i] >= 0) continue;
      const stack: number[] = [i];
      labels[i] = label;
      let cnt = 0;
      while (stack.length) {
        const j = stack.pop()!;
        cnt++;
        const x = j % w;
        const y = (j / w) | 0;
        if (x > 0) {
          const nb = j - 1;
          if (bin[nb] === 1 && labels[nb] < 0) {
            labels[nb] = label;
            stack.push(nb);
          }
        }
        if (x < w - 1) {
          const nb = j + 1;
          if (bin[nb] === 1 && labels[nb] < 0) {
            labels[nb] = label;
            stack.push(nb);
          }
        }
        if (y > 0) {
          const nb = j - w;
          if (bin[nb] === 1 && labels[nb] < 0) {
            labels[nb] = label;
            stack.push(nb);
          }
        }
        if (y < h - 1) {
          const nb = j + w;
          if (bin[nb] === 1 && labels[nb] < 0) {
            labels[nb] = label;
            stack.push(nb);
          }
        }
      }
      counts.set(label, cnt);
      label++;
    }
  }
  return { labels, counts };
}

/** 仅保留面积 >= turdSize 的连通域 */
function filterTurd(bin: Uint8Array, w: number, h: number, turdSize: number): void {
  const { labels, counts } = labelComponents(bin, w, h);
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] !== 1) continue;
    const L = labels[i]!;
    if ((counts.get(L) ?? 0) < turdSize) bin[i] = 0;
  }
}

/**
 * 从 RGBA ImageData 生成 Potrace 风格 SVG path `d`（可含多个子路径），坐标系与传入的 **imageData 的像素** 一致（左上为 0,0）。
 */
export function traceImageDataToSvgPathData(imageData: ImageData, options: Partial<PotraceCoreOptions> = {}): string {
  const opt = { ...DEFAULT_POTRACE_OPTIONS, ...options };
  const { width: iw, height: ih, data } = imageData;
  let gray =
    opt.traceMinAlpha > 0
      ? imageDataToTraceGrayscale(data, iw, ih, opt.traceMinAlpha)
      : imageDataToGrayscaleLuma(data, iw, ih);
  const scaled = scaleDownGrayIfNeeded(gray, iw, ih, opt.maxTraceSide);
  gray = scaled.gray;
  const w = scaled.width;
  const h = scaled.height;
  const scaleBack =
    scaled.scale < 1
      ? (p: Point) => ({ x: p.x / scaled.scale, y: p.y / scaled.scale })
      : (p: Point) => p;

  const threshold = opt.threshold < 0 ? otsuThreshold(gray) : opt.threshold;
  let bin = binarize(gray, w, h, threshold);

  if (opt.fringeSuppressMinRgb > 0) {
    const minFull = imageDataToMinRgbChannel(data, iw, ih);
    const minS =
      scaled.scale < 1
        ? downscaleUint8ToTraceGrid(minFull, iw, ih, w, h, scaled.scale)
        : minFull;
    stripFringeForegroundByMinRgb(bin, minS, w, h, opt.fringeSuppressMinRgb);
  }

  if (opt.ignoreWhite) {
    forceBrightToBackground(bin, gray, opt.ignoreWhiteMinLuma);
  }
  const bc = bin.slice();
  filterTurd(bc, w, h, opt.turdSize);
  bin = bc;
  erodeBinaryCross(bin, w, h, opt.edgeErosionPasses);

  const segs = marchingSquaresSegments(bin, gray, w, h, threshold);
  const loops = segmentsToPolylines(segs);
  let outD = '';
  for (const loop0 of loops) {
    if (loop0.length < 3) continue;
    let loop = loop0.map(scaleBack);
    if (loop.length >= 2 && nearPt(loop[0]!, loop[loop.length - 1]!)) {
      loop = loop.slice(0, -1);
    }
    if (loop.length < 3) continue;
    const effEps = effectiveSimplifyEpsilon(opt.simplifyEpsilon, loop.length, opt.adaptiveSimplify);
    const minSide = loopBBoxMinSide(loop);
    const smallLoopCap = Math.max(0.15, minSide * 0.18);
    const simp = rdpSimplify(loop, Math.min(effEps, smallLoopCap));
    if (simp.length < 3) continue;
    let ring = simp.slice();
    if (ring.length >= 2 && nearPt(ring[0]!, ring[ring.length - 1]!)) {
      ring = ring.slice(0, -1);
    }
    if (ring.length < 3) continue;
    const sub = closedPolylineToSvgPathWithCorners(
      ring,
      opt.curveTension,
      opt.cornerAngleThreshold
    );
    if (sub) outD += (outD ? ' ' : '') + sub;
  }
  return outD;
}

async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('图片加载失败'));
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** 从图片 dataUrl（当前图层 src）提取 SVG path d 与像素尺寸 */
export async function traceDataUrlToSvgPathResult(
  dataUrl: string,
  options?: Partial<PotraceCoreOptions>
): Promise<{ pathData: string; width: number; height: number }> {
  const imageData = await dataUrlToImageData(dataUrl);
  const pathData = traceImageDataToSvgPathData(imageData, options);
  return { pathData, width: imageData.width, height: imageData.height };
}
