/**
 * 文本框与形状内文字共用的排版模型与 Konva 映射。
 * 字体样式使用系统返回的字面（PostScript），而非通用数字字重。
 */
import type { EditorShapeObject, EditorTextObject } from './editorTypes';

export type EditorFontFaceInfo = {
  familyName: string;
  postScriptName: string;
  weight: string;
  style: string;
  /** 系统样式名（多为中文），优先用于样式下拉展示 */
  styleLabel?: string;
  /** 与 PostScript 对应的常见英文族名，用于旧文档或非中文字体列表匹配 */
  englishFamilyGuess?: string;
};

export type EditorLegacyFontStyle = '' | 'bold' | 'italic' | 'bold italic';

export interface EditorTextAppearanceModel {
  fontFamily: string;
  fontPostScriptName: string;
  fontSize: number;
  fill: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidthPt: number;
  textShadowEnabled: boolean;
  textShadowBlurPt: number;
  textShadowOffsetX: number;
  textShadowOffsetY: number;
  textShadowSpreadPt: number;
  textShadowOpacity: number;
  textShadowColor: string;
  letterSpacingPercent: number;
  opacity: number;
  blurRadius: number;
  /** 文本图层 fontSizeTracksBox / 形状 shapeTextFontSizeTracksBox */
  fontSizeTracksBox: boolean;
}

/** Konva 单阴影：用 blur+spread 合成为半径（扩展的近似） */
export function konvaShadowBlurFromBlurAndSpread(blur: number, spread: number): number {
  return Math.max(0, blur) + Math.max(0, spread);
}

export function familiesEqual(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^['"]+|['"]+$/g, '').trim().toLowerCase();
  return norm(a) === norm(b);
}

/** 字体下拉等：CSS font-family 加引号 + 无衬线回退，便于中文族名正确解析 */
export function cssFontFamilyForPreview(familyName: string): string {
  const t = familyName.replace(/\0/g, '').trim();
  if (!t) return 'sans-serif';
  const inner = t.replace(/^['"]+|['"]+$/g, '').replace(/\\/g, '');
  const safe = inner.replace(/"/g, '\\"');
  return `"${safe}", sans-serif`;
}

export function weightKeywordToNumeric(weight: string): number {
  const m: Record<string, number> = {
    ultralight: 100,
    thin: 200,
    light: 300,
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    heavy: 800,
    black: 900,
  };
  return m[weight] ?? 400;
}

/** 族内字面排序：字重由轻到重，斜体在后 */
export function sortFacesInFamily(faces: EditorFontFaceInfo[]): EditorFontFaceInfo[] {
  return [...faces].sort((x, y) => {
    const wx = weightKeywordToNumeric(x.weight);
    const wy = weightKeywordToNumeric(y.weight);
    if (wx !== wy) return wx - wy;
    const sx = faceLooksItalic(x) ? 1 : 0;
    const sy = faceLooksItalic(y) ? 1 : 0;
    if (sx !== sy) return sx - sy;
    return x.postScriptName.localeCompare(y.postScriptName, 'zh');
  });
}

export function facesForFamily(all: EditorFontFaceInfo[], family: string): EditorFontFaceInfo[] {
  if (!family.trim()) return [];
  const direct = all.filter((f) => familiesEqual(f.familyName, family));
  if (direct.length) return sortFacesInFamily(direct);
  const byEnglish = all.filter((f) => f.englishFamilyGuess && familiesEqual(f.englishFamilyGuess, family));
  return sortFacesInFamily(byEnglish);
}

export function defaultPostScriptForFamily(all: EditorFontFaceInfo[], family: string): string {
  const fam = facesForFamily(all, family);
  if (fam.length === 0) return '';
  const reg = fam.find((f) => f.weight === 'regular' && (f.style === 'normal' || !f.style));
  return (reg ?? fam[0]).postScriptName;
}

/** 下拉展示：优先系统 style 文案（多为中文）；再 PostScript 片段；再 weight 推断 */

/** 是否与斜体相关（含缓存里 style 未写对但 PS/标签可判定的情形），供 Konva fontStyle 与切换字面 */
export function faceLooksItalic(f: EditorFontFaceInfo): boolean {
  if (f.style === 'italic' || f.style === 'oblique') return true;
  if (f.styleLabel && /斜|oblique|\bitalic\b/i.test(f.styleLabel)) return true;
  const ps = (f.postScriptName || '').toLowerCase();
  return /italic|oblique/i.test(ps);
}

function isFaceItalic(f: EditorFontFaceInfo): boolean {
  return faceLooksItalic(f);
}

/** 在指定族内选取最接近目标粗斜体组合的字面 PostScript 名 */
export function nearestPostScriptForBoldItalic(
  all: EditorFontFaceInfo[],
  family: string,
  wantBold: boolean,
  wantItalic: boolean
): string {
  const fam = facesForFamily(all, family);
  if (!fam.length) return '';
  let best: EditorFontFaceInfo | undefined;
  let bestScore = -1e9;
  for (const f of fam) {
    const w = weightKeywordToNumeric(f.weight);
    const bold = w >= 600;
    const it = isFaceItalic(f);
    const boldMatch = bold === wantBold ? 1000 : 200 - Math.abs(w - (wantBold ? 700 : 400));
    const itMatch = it === wantItalic ? 500 : 0;
    const score = boldMatch + itMatch - Math.abs(w - (wantBold ? 700 : 400)) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best?.postScriptName ?? '';
}

/** 粗体快捷：在保留当前是否斜体的前提下切换粗体 */
export function toggleAppearanceBold(all: EditorFontFaceInfo[], family: string, currentPs: string): string {
  const fam = facesForFamily(all, family);
  if (!fam.length) return currentPs;
  const cur = fam.find((f) => f.postScriptName === currentPs) ?? fam[0];
  const wantBold = weightKeywordToNumeric(cur.weight) < 600;
  const wantItalic = isFaceItalic(cur);
  return nearestPostScriptForBoldItalic(all, family, wantBold, wantItalic) || currentPs;
}

/** 斜体快捷：在保留当前粗细分的前提下切换斜体 */
export function toggleAppearanceItalic(all: EditorFontFaceInfo[], family: string, currentPs: string): string {
  const fam = facesForFamily(all, family);
  if (!fam.length) return currentPs;
  const cur = fam.find((f) => f.postScriptName === currentPs) ?? fam[0];
  const wantBold = weightKeywordToNumeric(cur.weight) >= 600;
  const wantItalic = !isFaceItalic(cur);
  return nearestPostScriptForBoldItalic(all, family, wantBold, wantItalic) || currentPs;
}

/** 当前字面是否粗体 / 斜体（用于工具条高亮） */
export function appearanceFaceBoldItalic(
  all: EditorFontFaceInfo[],
  family: string,
  currentPs: string
): { bold: boolean; italic: boolean } {
  const fam = facesForFamily(all, family);
  if (!fam.length) return { bold: false, italic: false };
  const cur = fam.find((f) => f.postScriptName === currentPs) ?? fam[0];
  return {
    bold: weightKeywordToNumeric(cur.weight) >= 600,
    italic: isFaceItalic(cur),
  };
}

export function formatFontVariantLabel(face: EditorFontFaceInfo, family: string): string {
  if (face.styleLabel && face.styleLabel.trim()) return face.styleLabel.trim();
  const ps = (face.postScriptName || '').trim();
  const famCompact = family.replace(/[\s-]/g, '');
  let tail = ps;
  if (famCompact && ps.replace(/[\s-]/g, '').length > famCompact.length) {
    const low = ps.toLowerCase();
    const i = low.indexOf(famCompact.toLowerCase());
    if (i >= 0) tail = ps.slice(i + family.length).replace(/^[\s._-]+/, '').trim();
  }
  if (tail && tail !== ps) {
    const pretty = tail.replace(/[-_]/g, ' ').trim();
    if (pretty) return pretty;
  }
  const w = face.weight || 'regular';
  const s = face.style || 'normal';
  if (s === 'italic' || s === 'oblique' || faceLooksItalic(face)) {
    if (w === 'bold' || w === 'black' || w === 'heavy') return '粗斜体';
    if (w === 'light' || w === 'ultralight') return '细斜体';
    return '斜体';
  }
  if (w === 'bold') return '粗体';
  if (w === 'black' || w === 'heavy') return '黑体';
  if (w === 'light' || w === 'ultralight') return '细体';
  if (w === 'semibold' || w === 'medium') return '中黑体';
  return '常规体';
}

export function konvaFontStyleFromFace(face: EditorFontFaceInfo | undefined): string {
  if (!face) return '400';
  const w = weightKeywordToNumeric(face.weight);
  const parts: string[] = [];
  if (faceLooksItalic(face)) parts.push('italic');
  parts.push(String(w));
  return parts.join(' ');
}

/** 旧版 fontWeight / bold / italic → 选中最接近的字面 */
export function inferPostScriptFromLegacy(
  all: EditorFontFaceInfo[],
  family: string,
  o: Pick<EditorTextObject, 'fontStyle' | 'fontWeight' | 'fontBold' | 'fontItalic'>
): string {
  const fam = facesForFamily(all, family);
  if (fam.length === 0) return '';
  const legacy = o.fontStyle ?? '';
  const bold = o.fontBold ?? legacy.includes('bold');
  const italic = o.fontItalic ?? legacy.includes('italic');
  const wn = o.fontWeight ?? (bold ? 700 : 400);
  const wantBold = bold || wn >= 600;
  const score = (f: EditorFontFaceInfo) => {
    const fw = weightKeywordToNumeric(f.weight);
    const isBold = fw >= 600;
    const isIt = faceLooksItalic(f);
    let s = 0;
    if (wantBold === isBold) s += 2;
    else s -= Math.abs(fw - (wantBold ? 700 : 400)) / 100;
    if (italic === isIt) s += 2;
    else if (italic && !isIt) s -= 1;
    return s;
  };
  const sorted = [...fam].sort((a, b) => score(b) - score(a));
  return sorted[0]?.postScriptName ?? fam[0].postScriptName;
}

export function resolveTextFace(
  all: EditorFontFaceInfo[],
  obj: EditorTextObject
): EditorFontFaceInfo | undefined {
  if (all.length === 0) return undefined;
  let ps = obj.fontPostScriptName ?? '';
  if (!ps && (obj.fontWeight != null || obj.fontBold != null || obj.fontItalic != null || obj.fontStyle)) {
    ps = inferPostScriptFromLegacy(all, obj.fontFamily, obj);
  }
  if (ps) {
    const hit = all.find((f) => f.postScriptName === ps);
    if (hit) return hit;
  }
  const fam = facesForFamily(all, obj.fontFamily);
  return fam[0];
}

export function resolveShapeTextFace(
  all: EditorFontFaceInfo[],
  obj: EditorShapeObject
): EditorFontFaceInfo | undefined {
  if (all.length === 0) return undefined;
  const ps = obj.shapeTextFontPostScriptName ?? '';
  if (ps) {
    const hit = all.find((f) => f.postScriptName === ps);
    if (hit) return hit;
  }
  const fam = facesForFamily(all, obj.shapeTextFontFamily ?? '');
  return fam[0];
}

export function pickBoldishFace(all: EditorFontFaceInfo[], family: string): string {
  const fam = facesForFamily(all, family);
  if (fam.length === 0) return '';
  const pref = ['black', 'heavy', 'bold', 'semibold', 'medium', 'regular'];
  for (const w of pref) {
    const hit = fam.find((f) => f.weight === w && !faceLooksItalic(f));
    if (hit) return hit.postScriptName;
  }
  return fam[0].postScriptName;
}

export function pickRegularFace(all: EditorFontFaceInfo[], family: string): string {
  return defaultPostScriptForFamily(all, family);
}

export function shadowOffsetFromAngle(distance: number, angleDeg: number): { offsetX: number; offsetY: number } {
  const r = (angleDeg * Math.PI) / 180;
  return { offsetX: distance * Math.cos(r), offsetY: distance * Math.sin(r) };
}

function textShadowXYFromTextStorage(
  o: Pick<EditorTextObject, 'textShadowOffsetX' | 'textShadowOffsetY' | 'textShadowOffsetPt' | 'textShadowAngleDeg'>
): { offsetX: number; offsetY: number } {
  if (typeof o.textShadowOffsetX === 'number' && typeof o.textShadowOffsetY === 'number') {
    return { offsetX: o.textShadowOffsetX, offsetY: o.textShadowOffsetY };
  }
  return shadowOffsetFromAngle(o.textShadowOffsetPt ?? 5, o.textShadowAngleDeg ?? 45);
}

function textShadowXYFromShapeStorage(
  o: Pick<
    EditorShapeObject,
    'shapeTextShadowOffsetX' | 'shapeTextShadowOffsetY' | 'shapeTextShadowOffsetPt' | 'shapeTextShadowAngleDeg'
  >
): { offsetX: number; offsetY: number } {
  if (typeof o.shapeTextShadowOffsetX === 'number' && typeof o.shapeTextShadowOffsetY === 'number') {
    return { offsetX: o.shapeTextShadowOffsetX, offsetY: o.shapeTextShadowOffsetY };
  }
  return shadowOffsetFromAngle(o.shapeTextShadowOffsetPt ?? 5, o.shapeTextShadowAngleDeg ?? 45);
}

export function letterSpacingPxFromPercent(percent: number, fontSize: number): number {
  return (percent / 100) * Math.max(1, fontSize);
}

export function textAppearanceFromTextObject(o: EditorTextObject): EditorTextAppearanceModel {
  const xy = textShadowXYFromTextStorage(o);
  return {
    fontFamily: o.fontFamily,
    fontPostScriptName: o.fontPostScriptName ?? '',
    fontSize: o.fontSize,
    fill: o.fill,
    outlineEnabled: o.outlineEnabled ?? false,
    outlineColor: o.outlineColor ?? '#000000',
    outlineWidthPt: o.outlineWidthPt ?? 1,
    textShadowEnabled: o.textShadowEnabled ?? false,
    textShadowBlurPt: o.textShadowBlurPt ?? 1,
    textShadowOffsetX: xy.offsetX,
    textShadowOffsetY: xy.offsetY,
    textShadowSpreadPt: o.textShadowSpreadPt ?? 0,
    textShadowOpacity: o.textShadowOpacity ?? 1,
    textShadowColor: o.textShadowColor ?? 'rgba(0,0,0,0.85)',
    letterSpacingPercent: o.letterSpacingPercent ?? 0,
    opacity: o.opacity,
    blurRadius: o.blurRadius,
    fontSizeTracksBox: o.fontSizeTracksBox ?? false,
  };
}

export function textAppearanceFromShapeObject(o: EditorShapeObject): EditorTextAppearanceModel {
  const xy = textShadowXYFromShapeStorage(o);
  return {
    fontFamily: o.shapeTextFontFamily ?? 'PingFang SC',
    fontPostScriptName: o.shapeTextFontPostScriptName ?? '',
    fontSize: o.shapeTextFontSize,
    fill: o.shapeTextColor,
    outlineEnabled: o.shapeTextOutlineEnabled ?? false,
    outlineColor: o.shapeTextOutlineColor ?? '#000000',
    outlineWidthPt: o.shapeTextOutlineWidthPt ?? 1,
    textShadowEnabled: o.shapeTextShadowEnabled ?? false,
    textShadowBlurPt: o.shapeTextShadowBlurPt ?? 1,
    textShadowOffsetX: xy.offsetX,
    textShadowOffsetY: xy.offsetY,
    textShadowSpreadPt: o.shapeTextShadowSpreadPt ?? 0,
    textShadowOpacity: o.shapeTextShadowOpacity ?? 1,
    textShadowColor: o.shapeTextShadowColor ?? 'rgba(0,0,0,0.85)',
    letterSpacingPercent: o.shapeTextLetterSpacingPercent ?? 0,
    opacity: o.shapeTextOpacity,
    blurRadius: o.shapeTextBlur,
    fontSizeTracksBox: o.shapeTextFontSizeTracksBox ?? false,
  };
}

export function textAppearancePatchForTextObject(
  p: Partial<EditorTextAppearanceModel>
): Partial<EditorTextObject> {
  const out: Partial<EditorTextObject> = {};
  if (p.fontFamily !== undefined) out.fontFamily = p.fontFamily;
  if (p.fontPostScriptName !== undefined) out.fontPostScriptName = p.fontPostScriptName;
  if (p.fontSize !== undefined) out.fontSize = p.fontSize;
  if (p.fill !== undefined) out.fill = p.fill;
  if (p.outlineEnabled !== undefined) out.outlineEnabled = p.outlineEnabled;
  if (p.outlineColor !== undefined) out.outlineColor = p.outlineColor;
  if (p.outlineWidthPt !== undefined) out.outlineWidthPt = p.outlineWidthPt;
  if (p.textShadowEnabled !== undefined) out.textShadowEnabled = p.textShadowEnabled;
  if (p.textShadowBlurPt !== undefined) out.textShadowBlurPt = p.textShadowBlurPt;
  if (p.textShadowOffsetX !== undefined) out.textShadowOffsetX = p.textShadowOffsetX;
  if (p.textShadowOffsetY !== undefined) out.textShadowOffsetY = p.textShadowOffsetY;
  if (p.textShadowSpreadPt !== undefined) out.textShadowSpreadPt = p.textShadowSpreadPt;
  if (p.textShadowOpacity !== undefined) out.textShadowOpacity = p.textShadowOpacity;
  if (p.textShadowColor !== undefined) out.textShadowColor = p.textShadowColor;
  if (p.letterSpacingPercent !== undefined) out.letterSpacingPercent = p.letterSpacingPercent;
  if (p.opacity !== undefined) out.opacity = p.opacity;
  if (p.blurRadius !== undefined) out.blurRadius = p.blurRadius;
  if (p.fontSizeTracksBox !== undefined) out.fontSizeTracksBox = p.fontSizeTracksBox;
  return out;
}

export function textAppearancePatchForShapeObject(
  p: Partial<EditorTextAppearanceModel>
): Partial<EditorShapeObject> {
  const out: Partial<EditorShapeObject> = {};
  if (p.fontFamily !== undefined) out.shapeTextFontFamily = p.fontFamily;
  if (p.fontPostScriptName !== undefined) out.shapeTextFontPostScriptName = p.fontPostScriptName;
  if (p.fontSize !== undefined) out.shapeTextFontSize = p.fontSize;
  if (p.fill !== undefined) out.shapeTextColor = p.fill;
  if (p.outlineEnabled !== undefined) out.shapeTextOutlineEnabled = p.outlineEnabled;
  if (p.outlineColor !== undefined) out.shapeTextOutlineColor = p.outlineColor;
  if (p.outlineWidthPt !== undefined) out.shapeTextOutlineWidthPt = p.outlineWidthPt;
  if (p.textShadowEnabled !== undefined) out.shapeTextShadowEnabled = p.textShadowEnabled;
  if (p.textShadowBlurPt !== undefined) out.shapeTextShadowBlurPt = p.textShadowBlurPt;
  if (p.textShadowOffsetX !== undefined) out.shapeTextShadowOffsetX = p.textShadowOffsetX;
  if (p.textShadowOffsetY !== undefined) out.shapeTextShadowOffsetY = p.textShadowOffsetY;
  if (p.textShadowSpreadPt !== undefined) out.shapeTextShadowSpreadPt = p.textShadowSpreadPt;
  if (p.textShadowOpacity !== undefined) out.shapeTextShadowOpacity = p.textShadowOpacity;
  if (p.textShadowColor !== undefined) out.shapeTextShadowColor = p.textShadowColor;
  if (p.letterSpacingPercent !== undefined) out.shapeTextLetterSpacingPercent = p.letterSpacingPercent;
  if (p.opacity !== undefined) out.shapeTextOpacity = p.opacity;
  if (p.blurRadius !== undefined) out.shapeTextBlur = p.blurRadius;
  if (p.fontSizeTracksBox !== undefined) out.shapeTextFontSizeTracksBox = p.fontSizeTracksBox;
  return out;
}
