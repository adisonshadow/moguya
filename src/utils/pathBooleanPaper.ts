/**
 * 使用 Paper.js 对两段 SVG path `d` 做布尔运算（见图片编辑器矢量模式：子图形合并/打孔/相交/差集）
 */
import paper from 'paper';

export type PathBooleanOp = 'unite' | 'subtract' | 'intersect' | 'exclude';

function ensureClosedForBoolean(p: paper.Path): void {
  if (!p.closed) p.closePath();
}

function isClockwise(p: paper.Path): boolean {
  return p.area > 0;
}

function makeClockwise(p: paper.Path): void {
  if (!isClockwise(p)) p.reverse();
}

function pathDataFromPaperItem(item: paper.Item | null): string | null {
  if (!item) return null;
  if (item.className === 'CompoundPath') {
    const cp = item as paper.CompoundPath;
    const parts: string[] = [];
    for (let i = 0; i < cp.children.length; i++) {
      const ch = cp.children[i] as paper.Path | undefined;
      if (ch && Math.abs(ch.area) > 0.01) { // 忽略面积小于0.01的碎片
        const pd = ch.pathData?.trim();
        if (pd) parts.push(pd);
      }
    }
    const joined = parts.join(' ').trim();
    return joined || null;
  }
  if (item.className === 'Path') {
    const pd = (item as paper.Path).pathData?.trim();
    return pd || null;
  }
  return null;
}

/**
 * @param dA 子路径序号较小的一侧：pathData / SVG 中靠前，**先绘制 = 在下层**
 * @param dB 子路径序号较大的一侧：**后绘制 = 在上层**
 * subtract：**下层 − 上层**（用上层形状在下层上打孔），与点选顺序无关，也不按几何谁包谁交换
 */
export function pathBooleanPathData(dA: string, dB: string, op: PathBooleanOp): string | null {
  if (typeof document === 'undefined') return null;
  const a = dA.trim();
  const b = dB.trim();
  if (!a || !b) return null;

  console.log(`[pathBoolean] op=${op}`);
  console.log(`[pathBoolean] dA: ${a.substring(0, 100)}...`);
  console.log(`[pathBoolean] dB: ${b.substring(0, 100)}...`);

  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  paper.setup(canvas);
  paper.project.clear();

  const pA = new paper.Path(a);
  const pB = new paper.Path(b);

  // 确保封闭并记录信息
  ensureClosedForBoolean(pA);
  ensureClosedForBoolean(pB);
  console.log(`[pathBoolean] pA closed=${pA.closed}, area=${pA.area}, clockwise=${isClockwise(pA)}`);
  console.log(`[pathBoolean] pB closed=${pB.closed}, area=${pB.area}, clockwise=${isClockwise(pB)}`);

  let result: paper.Item | null = null;
  try {
    switch (op) {
      case 'unite':
        result = pA.unite(pB);
        break;
      case 'subtract': {
        // 尝试两种方向策略
        // 策略1: 原逻辑（都顺时针）
        console.log(`[pathBoolean] subtract: try original (both clockwise)`);
        const pA_orig = new paper.Path(a);
        const pB_orig = new paper.Path(b);
        ensureClosedForBoolean(pA_orig);
        ensureClosedForBoolean(pB_orig);
        makeClockwise(pA_orig);
        makeClockwise(pB_orig);
        console.log(`  pA_orig area=${pA_orig.area}, clockwise=${isClockwise(pA_orig)}`);
        console.log(`  pB_orig area=${pB_orig.area}, clockwise=${isClockwise(pB_orig)}`);
        let res1 = pA_orig.subtract(pB_orig, { trace: true });
        console.log(`  original subtract result: ${res1 ? res1.className : 'null'}, area=${res1 && res1.area ? res1.area : 'N/A'}`);
        if (res1) {
          const pathData1 = pathDataFromPaperItem(res1);
          console.log(`  original result pathData: ${pathData1 ? pathData1.substring(0, 200) : 'null'}`);
          res1.remove();
        }

        // 策略2: A顺时针，B逆时针（推荐孔洞方向）
        console.log(`[pathBoolean] subtract: try A clockwise, B counter-clockwise`);
        const pA_ccw = new paper.Path(a);
        const pB_ccw = new paper.Path(b);
        ensureClosedForBoolean(pA_ccw);
        ensureClosedForBoolean(pB_ccw);
        makeClockwise(pA_ccw);  // A 顺时针
        if (isClockwise(pB_ccw)) pB_ccw.reverse(); // B 逆时针
        console.log(`  pA_ccw area=${pA_ccw.area}, clockwise=${isClockwise(pA_ccw)}`);
        console.log(`  pB_ccw area=${pB_ccw.area}, clockwise=${isClockwise(pB_ccw)}`);
        let res2 = pA_ccw.subtract(pB_ccw, { trace: true });
        console.log(`  ccw subtract result: ${res2 ? res2.className : 'null'}, area=${res2 && res2.area ? res2.area : 'N/A'}`);
        if (res2) {
          const pathData2 = pathDataFromPaperItem(res2);
          console.log(`  ccw result pathData: ${pathData2 ? pathData2.substring(0, 200) : 'null'}`);
          // 使用这个结果（如果非空）
          if (res2 && (!result || (res2.area && Math.abs(res2.area) > 0))) {
            if (result) result.remove();
            result = res2;
          } else if (res2) {
            res2.remove();
          }
        }

        // 如果两种策略都失败了，尝试不强制方向
        if (!result || (result.area === 0)) {
          console.log(`[pathBoolean] subtract: try no forced orientation (original paths as-is)`);
          const pA_raw = new paper.Path(a);
          const pB_raw = new paper.Path(b);
          ensureClosedForBoolean(pA_raw);
          ensureClosedForBoolean(pB_raw);
          console.log(`  pA_raw area=${pA_raw.area}, clockwise=${isClockwise(pA_raw)}`);
          console.log(`  pB_raw area=${pB_raw.area}, clockwise=${isClockwise(pB_raw)}`);
          let res3 = pA_raw.subtract(pB_raw, { trace: true });
          console.log(`  raw subtract result: ${res3 ? res3.className : 'null'}, area=${res3 && res3.area ? res3.area : 'N/A'}`);
          if (res3 && (!result || (res3.area && Math.abs(res3.area) > 0))) {
            if (result) result.remove();
            result = res3;
          } else if (res3) {
            res3.remove();
          }
        }

        // 如果仍然没有结果，尝试 unite 然后 subtract？这里仅做最后尝试
        if (!result || result.area === 0) {
          console.log(`[pathBoolean] subtract: fallback - try A.subtract(B) with trace=false`);
          const pA_fb = new paper.Path(a);
          const pB_fb = new paper.Path(b);
          ensureClosedForBoolean(pA_fb);
          ensureClosedForBoolean(pB_fb);
          let res4 = pA_fb.subtract(pB_fb);
          console.log(`  fallback result: ${res4 ? res4.className : 'null'}, area=${res4 && res4.area ? res4.area : 'N/A'}`);
          if (res4 && (!result || (res4.area && Math.abs(res4.area) > 0))) {
            if (result) result.remove();
            result = res4;
          } else if (res4) {
            res4.remove();
          }
        }

        // 后处理：如果结果是 CompoundPath，修正孔洞方向
        if (result && result.className === 'CompoundPath') {
          const comp = result as paper.CompoundPath;
          const children = comp.children as paper.Path[];
          console.log(`[pathBoolean] CompoundPath has ${children.length} children, areas: ${children.map(c => c.area).join(', ')}`);
          const sorted = [...children].sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
          for (let i = 1; i < sorted.length; i++) {
            if (isClockwise(sorted[i])) {
              console.log(`  reversing inner child ${i} (was clockwise)`);
              sorted[i].reverse();
            }
          }
        } else if (result && result.className === 'Path') {
          console.log(`[pathBoolean] Single path result area=${result.area}, clockwise=${isClockwise(result as paper.Path)}`);
          if (!isClockwise(result as paper.Path)) {
            console.log(`  reversing single path to clockwise`);
            (result as paper.Path).reverse();
          }
        }

        break;
      }
      case 'intersect':
        result = pA.intersect(pB);
        break;
      case 'exclude':
        result = pA.exclude(pB);
        break;
      default:
        return null;
    }
  } catch (err) {
    console.error(`[pathBoolean] Exception during ${op}:`, err);
    return null;
  }

  console.log(`[pathBoolean] final result: ${result ? result.className : 'null'}, area=${result && result.area ? result.area : 'N/A'}`);
  const out = pathDataFromPaperItem(result);
  console.log(`[pathBoolean] output pathData length: ${out ? out.length : 0}`);
  if (result) result.remove();
  paper.project.clear();
  return out;
}